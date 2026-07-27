import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bitebluff-discord-"));
const fileDbPath = path.join(tempDir, "bitebluff.json");
process.env.NODE_ENV = "test";
process.env.BITEDLE_FORCE_FILE_STORE = "1";
process.env.BITEBLUFF_FILE_DB_PATH = fileDbPath;
process.env.BITEBLUFF_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
delete globalThis.__bitebluffRepository;

const service = require(path.join(repoRoot, "src", "lib", "bitebluff-service.ts"));
const { getBitebluffRepository } = require(
  path.join(repoRoot, "src", "lib", "bitebluff-store.ts"),
);

const entryTime = new Date("2026-07-26T20:00:00.000Z");
const settlementTime = new Date("2026-07-27T03:01:00.000Z");
const alice = {
  userId: "11111111-1111-4111-8111-111111111111",
  discordUserId: "100000000000000001",
  displayName: "Alice",
  avatarHash: null,
};
const bob = {
  userId: "22222222-2222-4222-8222-222222222222",
  discordUserId: "100000000000000002",
  displayName: "Bob",
  avatarHash: null,
};

const quote = await service.quoteBitebluffEntry(alice.userId, entryTime);
assert.equal(quote.round.date, "2026-07-26");
assert.equal(quote.balance, 100);
assert.deepEqual(
  { minimum: quote.minimumWager, maximum: quote.maximumWager },
  { minimum: 10, maximum: 66 },
);

const firstAlice = await service.enterBitebluff(alice, 60, entryTime);
const firstBob = await service.enterBitebluff(bob, 30, entryTime);
assert.equal(firstAlice.created, true);
assert.equal(firstAlice.topUp, 100);
assert.equal(firstAlice.account.balance, 40);
assert.equal(firstBob.account.balance, 70);
assert.equal(firstAlice.entry.revealedHand, null);
assert.equal(JSON.stringify(firstAlice.entry).includes('"rank"'), false);

const duplicateAlice = await service.enterBitebluff(alice, 10, entryTime);
assert.equal(duplicateAlice.created, false);
assert.equal(duplicateAlice.entry.id, firstAlice.entry.id);
assert.equal(duplicateAlice.entry.wager, 60);
assert.equal(duplicateAlice.account.balance, 40);

const repository = getBitebluffRepository();
const destination = await service.recordBitebluffDestination({
  roundId: quote.round.id,
  guildId: "300000000000000001",
  channelId: "400000000000000001",
  applicationId: "500000000000000001",
  webhookToken: "local-token",
  tokenCreatedAt: entryTime.getTime(),
  now: entryTime.getTime(),
});
assert.equal((await repository.destinationsForRound(quote.round.id)).length, 1);
assert.equal(await repository.claimPreview(destination.id), true);
assert.equal(await repository.claimPreview(destination.id), false);
await repository.releasePreview(destination.id);

const settlement = await service.settleBitebluffRound(quote.round.id, settlementTime);
assert.ok(settlement);
assert.equal(settlement.round.status, "settled");
assert.equal(settlement.entries.length, 2);
assert.equal(settlement.entries.every((entry) => entry.revealedHand?.length === 5), true);
assert.equal(
  settlement.entries.some((entry) => entry.wonLayers.includes(0)),
  true,
);
assert.equal(
  settlement.entries.reduce((total, entry) => total + entry.payout, 0),
  90,
);
assert.equal(
  settlement.entries.reduce(
    (total, entry) => total + entry.contestedPayout + entry.unmatchedReturn,
    0,
  ),
  90,
);

const balancesAfterSettlement = await Promise.all([
  repository.getAccount(alice.userId),
  repository.getAccount(bob.userId),
]);
const totalBalance = balancesAfterSettlement.reduce(
  (total, account) => total + (account?.balance ?? 0),
  0,
);
assert.equal(totalBalance, 200);
const retry = await service.settleBitebluffRound(quote.round.id, settlementTime);
assert.equal(retry?.alreadySettled, true);
const balancesAfterRetry = await Promise.all([
  repository.getAccount(alice.userId),
  repository.getAccount(bob.userId),
]);
assert.deepEqual(
  balancesAfterRetry.map((account) => account?.balance),
  balancesAfterSettlement.map((account) => account?.balance),
);
assert.deepEqual(await repository.roundsNeedingFinalDelivery(), [quote.round.id]);
assert.equal((await repository.previewEntriesForRound(quote.round.id)).length, 2);
assert.equal(
  JSON.stringify(await repository.previewEntriesForRound(quote.round.id)).includes(
    "encryptedHand",
  ),
  false,
);

const persisted = JSON.parse(fs.readFileSync(fileDbPath, "utf8"));
assert.equal(
  Object.values(persisted.ledger).filter((event) => event.kind === "wager").length,
  2,
);
assert.equal(
  Object.values(persisted.ledger).filter((event) => event.kind === "daily_top_up").length,
  2,
);

console.log(
  "Bitebluff Discord verification passed: daily top-up and redraw-reserved bounds, atomic one-entry debit, encrypted pre-settlement hands, destination claims, layered-pot conservation, idempotent settlement, balance conservation, and retryable final delivery.",
);
