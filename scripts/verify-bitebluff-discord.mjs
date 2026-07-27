import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
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

const aliceBeforeRedraw = await service.bitebluffPrivateState(alice.userId, entryTime);
assert.equal(aliceBeforeRedraw.pot, 90);
assert.equal(aliceBeforeRedraw.participants.length, 2);
assert.equal(aliceBeforeRedraw.participants.every((entry) => !("hand" in entry)), true);
assert.equal(aliceBeforeRedraw.burnAndDraw.available, true);

const duplicateAlice = await service.enterBitebluff(alice, 10, entryTime);
assert.equal(duplicateAlice.created, false);
assert.equal(duplicateAlice.entry.id, firstAlice.entry.id);
assert.equal(duplicateAlice.entry.wager, 60);
assert.equal(duplicateAlice.account.balance, 40);

const redrawTime = new Date(entryTime.getTime() + 1_000);
const redrawAlice = await service.redrawBitebluff(alice.userId, 2, redrawTime);
assert.equal(redrawAlice.applied, true);
assert.equal(redrawAlice.account.balance, 10);
assert.equal(redrawAlice.entry.redrawCount, 2);
assert.equal(redrawAlice.entry.redrawSurcharge, 30);
assert.equal(redrawAlice.entry.revealedHand, null);
const aliceAfterRedraw = await service.bitebluffPrivateState(alice.userId, redrawTime);
assert.equal(aliceAfterRedraw.pot, 120);
assert.equal(aliceAfterRedraw.entry.committed, 90);
assert.equal(aliceAfterRedraw.entry.redraw.count, 2);
assert.equal(aliceAfterRedraw.entry.redraw.positions.length, 2);
assert.equal(
  aliceAfterRedraw.entry.hand.filter(
    (card, index) =>
      JSON.stringify(card) !== JSON.stringify(aliceBeforeRedraw.entry.hand[index]),
  ).length,
  2,
);
assert.equal(aliceAfterRedraw.burnAndDraw.available, false);
const duplicateRedraw = await service.redrawBitebluff(alice.userId, 2, redrawTime);
assert.equal(duplicateRedraw.applied, false);
assert.equal(duplicateRedraw.account.balance, 10);
await assert.rejects(
  service.redrawBitebluff(alice.userId, 1, redrawTime),
  /already been used/,
);

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
const activityUpsert = await service.recordBitebluffDestination({
  roundId: quote.round.id,
  guildId: destination.guildId,
  channelId: destination.channelId,
  applicationId: "",
  webhookToken: "",
  tokenCreatedAt: entryTime.getTime() + 1_000,
  now: entryTime.getTime() + 1_000,
});
assert.equal(activityUpsert.applicationId, destination.applicationId);
assert.equal(activityUpsert.webhookToken, destination.webhookToken);
assert.equal(activityUpsert.tokenCreatedAt, destination.tokenCreatedAt);
assert.equal(await repository.claimPreview(destination.id), true);
assert.equal(await repository.claimPreview(destination.id), false);
await repository.releasePreview(destination.id);
const livePreviewRequests = [];
const livePreviewServer = http.createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    livePreviewRequests.push({
      method: request.method,
      url: request.url,
      body: Buffer.concat(chunks).toString("utf8"),
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: "live-preview-message" }));
  });
});
await new Promise((resolve) => livePreviewServer.listen(0, "127.0.0.1", resolve));
const livePreviewAddress = livePreviewServer.address();
process.env.BITEDLE_DISCORD_API_BASE_URL =
  `http://127.0.0.1:${livePreviewAddress.port}`;
delete process.env.DISCORD_BOT_TOKEN;
const {
  deliverBitebluffFinalResults,
  updateBitebluffPublicPreview,
} = require(
  path.join(repoRoot, "src", "lib", "bitebluff-discord-preview.tsx"),
);
try {
  await updateBitebluffPublicPreview(destination.id);
} finally {
  await new Promise((resolve, reject) =>
    livePreviewServer.close((error) => (error ? reject(error) : resolve())),
  );
}
assert.equal(livePreviewRequests.length, 1);
assert.equal(livePreviewRequests[0].method, "POST");
assert.equal(
  livePreviewRequests[0].url,
  `/webhooks/${destination.applicationId}/${destination.webhookToken}`,
);
assert.equal(livePreviewRequests[0].body.includes('"allowed_mentions"'), true);
assert.equal(livePreviewRequests[0].body.includes('"parse":[]'), true);
assert.equal(await repository.totalCommittedForRound(quote.round.id), 120);
const pendingLeaderboard = await service.bitebluffLeaderboard(alice.userId, redrawTime);
assert.equal(pendingLeaderboard.entries.length, 2);
assert.equal(pendingLeaderboard.entries.every((entry) => entry.bankroll === 100), true);
assert.equal(pendingLeaderboard.entries.every((entry) => entry.rank === null), true);
await assert.rejects(
  service.redrawBitebluff(
    bob.userId,
    1,
    new Date("2026-07-27T02:55:00.000Z"),
  ),
  /closes five minutes/,
);

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
  120,
);
assert.equal(
  settlement.entries.reduce(
    (total, entry) => total + entry.contestedPayout + entry.unmatchedReturn,
    0,
  ),
  120,
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
const settledLeaderboard = await service.bitebluffLeaderboard(
  alice.userId,
  settlementTime,
);
assert.equal(settledLeaderboard.entries.every((entry) => entry.active), true);
assert.equal(settledLeaderboard.entries[0].rank, 1);
assert.equal(
  settledLeaderboard.entries.reduce((total, entry) => total + entry.bankroll, 0),
  200,
);
assert.deepEqual(await repository.roundsNeedingFinalDelivery(), [quote.round.id]);
assert.equal((await repository.previewEntriesForRound(quote.round.id)).length, 2);
assert.equal(
  JSON.stringify(await repository.previewEntriesForRound(quote.round.id)).includes(
    "encryptedHand",
  ),
  false,
);

const discordRequests = [];
const discordServer = http.createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    discordRequests.push({
      method: request.method,
      url: request.url,
      body: Buffer.concat(chunks).toString("utf8"),
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: "live-preview-message" }));
  });
});
await new Promise((resolve) => discordServer.listen(0, "127.0.0.1", resolve));
const discordAddress = discordServer.address();
process.env.BITEDLE_DISCORD_API_BASE_URL =
  `http://127.0.0.1:${discordAddress.port}`;
process.env.DISCORD_BOT_TOKEN = "test-bot-token";
try {
  await deliverBitebluffFinalResults(quote.round.id);
} finally {
  await new Promise((resolve, reject) =>
    discordServer.close((error) => (error ? reject(error) : resolve())),
  );
}
assert.equal(discordRequests.length, 1);
assert.equal(discordRequests[0].method, "PATCH");
assert.equal(
  discordRequests[0].url,
  `/channels/${destination.channelId}/messages/live-preview-message`,
);
assert.equal(discordRequests[0].body.includes('"allowed_mentions"'), true);
assert.equal(discordRequests[0].body.includes('"parse":[]'), true);
assert.deepEqual(await repository.roundsNeedingFinalDelivery(), []);
const deliveredDestination = await repository.getDestination(destination.id);
assert.deepEqual(deliveredDestination.finalMessageIds, ["live-preview-message"]);
assert.equal(deliveredDestination.finalPostedAt > 0, true);

const persisted = JSON.parse(fs.readFileSync(fileDbPath, "utf8"));
assert.equal(
  Object.values(persisted.ledger).filter((event) => event.kind === "wager").length,
  2,
);
assert.equal(
  Object.values(persisted.ledger).filter((event) => event.kind === "daily_top_up").length,
  2,
);
assert.equal(
  Object.values(persisted.ledger).filter((event) => event.kind === "redraw_surcharge").length,
  1,
);

console.log(
  "Bitebluff Discord verification passed: daily top-up and redraw-reserved bounds, atomic one-entry debit, one-time random Burn & Draw, redacted pot roster, settled-snapshot active bankroll leaderboard, encrypted pre-settlement hands, first-launch destination and webhook preview delivery, layered-pot conservation, idempotent settlement, balance conservation, and final reveal replacement of the zero-ping live preview.",
);
