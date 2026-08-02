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

const entryTime = new Date("2026-07-28T20:00:00.000Z");
const settlementTime = new Date("2026-07-29T03:01:00.000Z");
const guildOne = "300000000000000001";
const guildTwo = "300000000000000002";
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

const quote = await service.quoteBitebluffEntry(
  alice.userId,
  guildOne,
  entryTime,
);
assert.equal(quote.round.date, "2026-07-28");
assert.equal(quote.round.id, `2026-07-28:guild:${guildOne}`);
assert.equal(quote.balance, 100);
assert.deepEqual(
  { minimum: quote.minimumWager, maximum: quote.maximumWager },
  { minimum: 10, maximum: 66 },
);

const firstAlice = await service.enterBitebluff(
  alice,
  60,
  guildOne,
  entryTime,
);
const firstBob = await service.enterBitebluff(
  bob,
  30,
  guildOne,
  entryTime,
);
assert.equal(firstAlice.created, true);
assert.equal(firstAlice.topUp, 100);
assert.equal(firstAlice.account.balance, 40);
assert.equal(firstBob.account.balance, 70);
assert.equal(firstAlice.entry.revealedHand, null);
assert.equal(JSON.stringify(firstAlice.entry).includes('"rank"'), false);

const aliceBeforeRedraw = await service.bitebluffPrivateState(
  alice.userId,
  guildOne,
  entryTime,
);
assert.equal(aliceBeforeRedraw.round.guildId, guildOne);
assert.equal(aliceBeforeRedraw.pot, 90);
assert.equal(aliceBeforeRedraw.participants.length, 2);
assert.equal(aliceBeforeRedraw.participants.every((entry) => !("hand" in entry)), true);
assert.equal(aliceBeforeRedraw.burnAndDraw.available, true);
assert.equal(aliceBeforeRedraw.burnAndDraw.mode, "selected-cards");

const duplicateAlice = await service.enterBitebluff(
  alice,
  10,
  guildOne,
  entryTime,
);
assert.equal(duplicateAlice.created, false);
assert.equal(duplicateAlice.entry.id, firstAlice.entry.id);
assert.equal(duplicateAlice.entry.wager, 60);
assert.equal(duplicateAlice.account.balance, 40);

const redrawTime = new Date(entryTime.getTime() + 1_000);
await assert.rejects(
  service.redrawBitebluff(
    alice.userId,
    guildOne,
    { positions: [0, 0] },
    redrawTime,
  ),
  /different cards/,
);
assert.equal((await getBitebluffRepository().getAccount(alice.userId)).balance, 40);
const submittedBurnPositions = [3, 0];
const selectedBurnPositions = [0, 3];
const redrawAlice = await service.redrawBitebluff(
  alice.userId,
  guildOne,
  { positions: submittedBurnPositions },
  redrawTime,
);
assert.equal(redrawAlice.applied, true);
assert.equal(redrawAlice.account.balance, 10);
assert.equal(redrawAlice.entry.redrawCount, 2);
assert.equal(redrawAlice.entry.redrawSurcharge, 30);
assert.equal(redrawAlice.entry.revealedHand, null);
const aliceAfterRedraw = await service.bitebluffPrivateState(
  alice.userId,
  guildOne,
  redrawTime,
);
assert.equal(aliceAfterRedraw.pot, 120);
assert.equal(aliceAfterRedraw.entry.committed, 90);
assert.equal(aliceAfterRedraw.entry.redraw.count, 2);
assert.deepEqual(
  aliceAfterRedraw.entry.redraw.positions,
  selectedBurnPositions,
);
assert.deepEqual(
  aliceAfterRedraw.entry.hand
    .map((card, index) =>
      JSON.stringify(card) ===
      JSON.stringify(aliceBeforeRedraw.entry.hand[index])
        ? null
        : index,
    )
    .filter((index) => index !== null),
  selectedBurnPositions,
);
assert.equal(aliceAfterRedraw.burnAndDraw.available, false);
const sealedSpectatorState = await service.bitebluffPrivateState(
  "spectator",
  guildOne,
  redrawTime,
);
assert.equal(sealedSpectatorState.entry, null);
assert.equal(sealedSpectatorState.results, null);
assert.equal(sealedSpectatorState.yesterdayResults, null);
assert.equal(sealedSpectatorState.yesterdayResultsDate, "2026-07-27");
assert.equal(
  sealedSpectatorState.yesterdayResultsUnavailableReason,
  "no-settled-round",
);
assert.equal(JSON.stringify(sealedSpectatorState).includes('"revealedHand"'), false);
const duplicateRedraw = await service.redrawBitebluff(
  alice.userId,
  guildOne,
  { positions: selectedBurnPositions },
  redrawTime,
);
assert.equal(duplicateRedraw.applied, false);
assert.equal(duplicateRedraw.account.balance, 10);
await assert.rejects(
  service.redrawBitebluff(
    alice.userId,
    guildOne,
    { positions: [1, 3] },
    redrawTime,
  ),
  /already been used/,
);

const repository = getBitebluffRepository();
const liveTokenCreatedAt = Date.now();
const destination = await service.recordBitebluffDestination({
  roundId: quote.round.id,
  guildId: guildOne,
  channelId: "400000000000000001",
  applicationId: "500000000000000001",
  webhookToken: "local-token",
  tokenCreatedAt: liveTokenCreatedAt,
  now: entryTime.getTime(),
});
assert.equal((await repository.destinationsForRound(quote.round.id)).length, 1);
const activityUpsert = await service.recordBitebluffDestination({
  roundId: quote.round.id,
  guildId: destination.guildId,
  channelId: destination.channelId,
  applicationId: "",
  webhookToken: "",
  tokenCreatedAt: liveTokenCreatedAt + 1_000,
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
    const botChannelAttempt = request.url?.startsWith("/channels/");
    response.writeHead(botChannelAttempt ? 403 : 200, {
      "Content-Type": "application/json",
    });
    response.end(
      JSON.stringify(
        botChannelAttempt
          ? { message: "Missing Access" }
          : { id: "live-preview-message" },
      ),
    );
  });
});
await new Promise((resolve) => livePreviewServer.listen(0, "127.0.0.1", resolve));
const livePreviewAddress = livePreviewServer.address();
process.env.BITEDLE_DISCORD_API_BASE_URL =
  `http://127.0.0.1:${livePreviewAddress.port}`;
process.env.DISCORD_BOT_TOKEN = "configured-but-webhook-must-win";
const {
  BITEBLUFF_PREVIEW_WINDOW_MS,
  deliverBitebluffFinalResults,
  deliverPendingBitebluffFinalResultsFromInteraction,
  updateBitebluffPublicPreview,
} = require(
  path.join(repoRoot, "src", "lib", "bitebluff-discord-preview.tsx"),
);
const { sortBitebluffFinalEntries } = require(
  path.join(repoRoot, "src", "lib", "bitebluff-results.ts"),
);
let firstPreviewCreatedAt;
let refreshedPreviewCreatedAt;
try {
  await updateBitebluffPublicPreview(destination.id);
  firstPreviewCreatedAt = (
    await repository.getDestination(destination.id)
  ).previewMessageCreatedAt;
  await updateBitebluffPublicPreview(destination.id);
  refreshedPreviewCreatedAt = (
    await repository.getDestination(destination.id)
  ).previewMessageCreatedAt;
  await repository.completePreview(
    destination.id,
    "aged-preview-message",
    Date.now() - BITEBLUFF_PREVIEW_WINDOW_MS - 1,
  );
  await updateBitebluffPublicPreview(destination.id);
} finally {
  await new Promise((resolve, reject) =>
    livePreviewServer.close((error) => (error ? reject(error) : resolve())),
  );
}
assert.equal(livePreviewRequests.length, 6);
assert.equal(livePreviewRequests[0].method, "POST");
assert.equal(
  livePreviewRequests[0].url,
  `/channels/${destination.channelId}/messages`,
);
assert.equal(livePreviewRequests[1].method, "POST");
assert.equal(
  livePreviewRequests[1].url,
  `/webhooks/${destination.applicationId}/${destination.webhookToken}`,
);
assert.equal(livePreviewRequests[1].body.includes('"allowed_mentions"'), true);
assert.equal(livePreviewRequests[1].body.includes('"parse":[]'), true);
assert.equal(livePreviewRequests[1].body.includes('"label":"Play now!"'), false);
assert.equal(livePreviewRequests[1].body.includes('"custom_id":"bitebluff-launch"'), false);
assert.equal(typeof firstPreviewCreatedAt, "number");
assert.equal(refreshedPreviewCreatedAt, firstPreviewCreatedAt);
assert.equal(livePreviewRequests[2].method, "PATCH");
assert.equal(
  livePreviewRequests[2].url,
  `/channels/${destination.channelId}/messages/live-preview-message`,
);
assert.equal(livePreviewRequests[3].method, "PATCH");
assert.equal(
  livePreviewRequests[3].url,
  `/webhooks/${destination.applicationId}/${destination.webhookToken}/messages/live-preview-message`,
);
assert.equal(livePreviewRequests[4].method, "POST");
assert.equal(
  livePreviewRequests[4].url,
  `/channels/${destination.channelId}/messages`,
);
assert.equal(livePreviewRequests[5].method, "POST");
assert.equal(
  livePreviewRequests[5].url,
  `/webhooks/${destination.applicationId}/${destination.webhookToken}`,
);
const rolledPreviewDestination = await repository.getDestination(destination.id);
assert.equal(rolledPreviewDestination.previewMessageId, "live-preview-message");
assert.equal(
  rolledPreviewDestination.previewMessageCreatedAt >
    Date.now() - BITEBLUFF_PREVIEW_WINDOW_MS,
  true,
);
assert.equal(await repository.totalCommittedForRound(quote.round.id), 120);
const pendingLeaderboard = await service.bitebluffLeaderboard(
  alice.userId,
  guildOne,
  redrawTime,
);
assert.equal(pendingLeaderboard.entries.length, 2);
assert.equal(pendingLeaderboard.entries.every((entry) => entry.bankroll === 100), true);
assert.equal(pendingLeaderboard.entries.every((entry) => entry.rank === null), true);
await assert.rejects(
  service.redrawBitebluff(
    bob.userId,
    guildOne,
    { positions: [2] },
    new Date("2026-07-29T02:55:00.000Z"),
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
const settledWinner = settlement.entries.find(
  (entry) => entry.contestedPayout > 0,
);
assert.ok(settledWinner);
const rankedFinalEntries = sortBitebluffFinalEntries([
  {
    ...settledWinner,
    id: "weak-loser",
    contestedPayout: 0,
    wonLayers: [],
    payout: 0,
    revealedHand: [
      { rank: 9, suit: "clubs" },
      { rank: 7, suit: "diamonds" },
      { rank: 5, suit: "hearts" },
      { rank: 4, suit: "spades" },
      { rank: 2, suit: "clubs" },
    ],
  },
  {
    ...settledWinner,
    id: "strong-loser",
    contestedPayout: 0,
    wonLayers: [],
    payout: 0,
    revealedHand: [
      { rank: 14, suit: "clubs" },
      { rank: 14, suit: "diamonds" },
      { rank: 12, suit: "hearts" },
      { rank: 8, suit: "spades" },
      { rank: 3, suit: "clubs" },
    ],
  },
  settledWinner,
]);
assert.deepEqual(
  rankedFinalEntries.map((entry) => entry.id),
  [settledWinner.id, "strong-loser", "weak-loser"],
);
const settledSpectatorState = await service.bitebluffPrivateState(
  "spectator",
  guildOne,
  settlementTime,
);
assert.equal(settledSpectatorState.entry, null);
assert.equal(settledSpectatorState.results.length, 2);
assert.equal(
  settledSpectatorState.results.every((result) => result.hand.length === 5),
  true,
);
assert.equal(settledSpectatorState.results[0].winner, true);
assert.equal(settledSpectatorState.results.at(-1).winner, false);
assert.equal(
  settledSpectatorState.results.every((result) => result.me === false),
  true,
);
assert.equal(settledSpectatorState.yesterdayResults, null);
assert.equal(
  settledSpectatorState.yesterdayResultsUnavailableReason,
  "no-settled-round",
);
const nextRoundSpectatorState = await service.bitebluffPrivateState(
  "spectator",
  guildOne,
  new Date("2026-07-29T04:01:00.000Z"),
);
assert.equal(nextRoundSpectatorState.round.date, "2026-07-29");
assert.equal(nextRoundSpectatorState.round.status, "open");
assert.equal(nextRoundSpectatorState.results, null);
assert.equal(nextRoundSpectatorState.yesterdayResults.date, "2026-07-28");
assert.equal(nextRoundSpectatorState.yesterdayResults.totalPool, 120);
assert.equal(nextRoundSpectatorState.yesterdayResults.results.length, 2);
assert.equal(nextRoundSpectatorState.yesterdayResultsUnavailableReason, null);
assert.equal(nextRoundSpectatorState.yesterdayResults.results[0].winner, true);
assert.equal(
  nextRoundSpectatorState.yesterdayResults.results.every(
    (result) => result.hand.length === 5 && result.me === false,
  ),
  true,
);
const otherGuildArchiveState = await service.bitebluffPrivateState(
  "spectator",
  guildTwo,
  new Date("2026-07-29T04:01:00.000Z"),
);
assert.equal(otherGuildArchiveState.yesterdayResults, null);
assert.equal(
  otherGuildArchiveState.yesterdayResultsUnavailableReason,
  "no-settled-round",
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
  guildOne,
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

const interactionFinalRequests = [];
const interactionFinalServer = http.createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    interactionFinalRequests.push({
      method: request.method,
      url: request.url,
      body: Buffer.concat(chunks).toString("utf8"),
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: "interaction-final-message" }));
  });
});
await new Promise((resolve) =>
  interactionFinalServer.listen(0, "127.0.0.1", resolve),
);
const interactionFinalAddress = interactionFinalServer.address();
process.env.BITEDLE_DISCORD_API_BASE_URL =
  `http://127.0.0.1:${interactionFinalAddress.port}`;
const postMidnightInteractionAt = new Date("2026-07-29T04:01:00.000Z").getTime();
let interactionDeliveredRoundIds;
try {
  interactionDeliveredRoundIds =
    await deliverPendingBitebluffFinalResultsFromInteraction({
      guildId: guildOne,
      channelId: "400000000000000077",
      applicationId: destination.applicationId,
      webhookToken: "fresh-post-midnight-token",
      now: postMidnightInteractionAt,
    });
  assert.deepEqual(
    await deliverPendingBitebluffFinalResultsFromInteraction({
      guildId: guildOne,
      channelId: "400000000000000077",
      applicationId: destination.applicationId,
      webhookToken: "fresh-post-midnight-token",
      now: postMidnightInteractionAt + 1,
    }),
    [],
  );
} finally {
  await new Promise((resolve, reject) =>
    interactionFinalServer.close((error) =>
      error ? reject(error) : resolve(),
    ),
  );
}
assert.deepEqual(interactionDeliveredRoundIds, [quote.round.id]);
assert.equal(interactionFinalRequests.length, 1);
assert.equal(interactionFinalRequests[0].method, "POST");
assert.equal(
  interactionFinalRequests[0].url,
  `/webhooks/${destination.applicationId}/fresh-post-midnight-token`,
);
assert.equal(
  interactionFinalRequests[0].body.includes('"allowed_mentions"'),
  true,
);
assert.equal(interactionFinalRequests[0].body.includes('"parse":[]'), true);
assert.equal(
  interactionFinalRequests[0].body.includes('"custom_id":"bitebluff-launch"'),
  false,
);
const interactionDeliveredDestination = await repository.getDestination(
  destination.id,
);
assert.deepEqual(
  interactionDeliveredDestination.finalMessageIds,
  ["interaction-final-message"],
);
assert.notEqual(
  interactionDeliveredDestination.finalMessageIds[0],
  interactionDeliveredDestination.previewMessageId,
);
assert.deepEqual(await repository.roundsNeedingFinalDelivery(), []);

const inaccessibleDestination = await service.recordBitebluffDestination({
  roundId: quote.round.id,
  guildId: guildOne,
  channelId: "400000000000000099",
  applicationId: destination.applicationId,
  webhookToken: "expired-token",
  tokenCreatedAt: Date.now() - BITEBLUFF_PREVIEW_WINDOW_MS - 1,
  now: settlementTime.getTime(),
});
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
    const botChannelAttempt = request.url?.startsWith("/channels/");
    const failedWebhookPatch =
      request.method === "PATCH" && request.url?.startsWith("/webhooks/");
    response.writeHead(botChannelAttempt || failedWebhookPatch ? 403 : 200, {
      "Content-Type": "application/json",
    });
    response.end(
      JSON.stringify(
        botChannelAttempt || failedWebhookPatch
          ? { message: "Missing Access" }
          : { id: "final-message" },
      ),
    );
  });
});
await new Promise((resolve) => discordServer.listen(0, "127.0.0.1", resolve));
const discordAddress = discordServer.address();
process.env.BITEDLE_DISCORD_API_BASE_URL =
  `http://127.0.0.1:${discordAddress.port}`;
process.env.DISCORD_BOT_TOKEN = "test-bot-token";
let finalDeliveryError;
try {
  await deliverBitebluffFinalResults(quote.round.id).catch((error) => {
    finalDeliveryError = error;
  });
} finally {
  await new Promise((resolve, reject) =>
    discordServer.close((error) => (error ? reject(error) : resolve())),
  );
}
assert.equal(finalDeliveryError instanceof AggregateError, true);
assert.equal(finalDeliveryError.errors.length, 1);
assert.equal(discordRequests.length, 1);
assert.equal(discordRequests[0].method, "POST");
assert.equal(
  discordRequests[0].url,
  `/channels/${inaccessibleDestination.channelId}/messages`,
);
assert.deepEqual(await repository.roundsNeedingFinalDelivery(), [quote.round.id]);
const stillPendingDestination = await repository.getDestination(
  inaccessibleDestination.id,
);
assert.equal(stillPendingDestination.finalPostedAt, null);
await repository.completeFinalDelivery(
  inaccessibleDestination.id,
  [],
  Date.now(),
);
assert.deepEqual(await repository.roundsNeedingFinalDelivery(), []);

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

const guildFileDbPath = path.join(tempDir, "bitebluff-guilds.json");
process.env.BITEBLUFF_FILE_DB_PATH = guildFileDbPath;
delete globalThis.__bitebluffRepository;
const guildOneEntry = await service.enterBitebluff(
  alice,
  20,
  guildOne,
  entryTime,
);
const guildTwoEntry = await service.enterBitebluff(
  bob,
  20,
  guildTwo,
  entryTime,
);
assert.notEqual(guildOneEntry.entry.roundId, guildTwoEntry.entry.roundId);
const guildOneState = await service.bitebluffPrivateState(
  alice.userId,
  guildOne,
  entryTime,
);
const guildTwoState = await service.bitebluffPrivateState(
  bob.userId,
  guildTwo,
  entryTime,
);
assert.equal(guildOneState.round.guildId, guildOne);
assert.equal(guildTwoState.round.guildId, guildTwo);
assert.deepEqual(
  guildOneState.participants.map((participant) => participant.userId),
  [alice.userId],
);
assert.deepEqual(
  guildTwoState.participants.map((participant) => participant.userId),
  [bob.userId],
);
assert.equal(guildOneState.pot, 20);
assert.equal(guildTwoState.pot, 20);
const guildOneLeaderboard = await service.bitebluffLeaderboard(
  alice.userId,
  guildOne,
  entryTime,
);
const guildTwoLeaderboard = await service.bitebluffLeaderboard(
  bob.userId,
  guildTwo,
  entryTime,
);
assert.deepEqual(
  guildOneLeaderboard.entries.map((entry) => entry.userId),
  [alice.userId],
);
assert.deepEqual(
  guildTwoLeaderboard.entries.map((entry) => entry.userId),
  [bob.userId],
);
await assert.rejects(
  service.recordBitebluffDestination({
    roundId: guildOneEntry.entry.roundId,
    guildId: guildTwo,
    channelId: "400000000000000002",
    applicationId: "500000000000000001",
    webhookToken: "wrong-guild-token",
    tokenCreatedAt: entryTime.getTime(),
    now: entryTime.getTime(),
  }),
  /does not match/,
);

const legacyFileDbPath = path.join(tempDir, "bitebluff-legacy.json");
process.env.BITEBLUFF_FILE_DB_PATH = legacyFileDbPath;
delete globalThis.__bitebluffRepository;
const legacyTime = new Date("2026-07-27T20:00:00.000Z");
const legacyRedrawTime = new Date(legacyTime.getTime() + 1_000);
await service.enterBitebluff(alice, 60, guildOne, legacyTime);
const legacyBeforeRedraw = await service.bitebluffPrivateState(
  alice.userId,
  guildOne,
  legacyTime,
);
assert.equal(legacyBeforeRedraw.round.date, "2026-07-27");
assert.equal(legacyBeforeRedraw.round.guildId, null);
assert.equal(legacyBeforeRedraw.burnAndDraw.mode, "random-count");
await assert.rejects(
  service.redrawBitebluff(
    alice.userId,
    guildOne,
    { positions: [0, 1] },
    legacyRedrawTime,
  ),
  /random cards/,
);
const legacyRedraw = await service.redrawBitebluff(
  alice.userId,
  guildOne,
  { count: 2 },
  legacyRedrawTime,
);
assert.equal(legacyRedraw.applied, true);
const legacyAfterRedraw = await service.bitebluffPrivateState(
  alice.userId,
  guildOne,
  legacyRedrawTime,
);
assert.equal(legacyAfterRedraw.entry.redraw.count, 2);
assert.equal(legacyAfterRedraw.entry.redraw.positions.length, 2);
assert.deepEqual(
  legacyAfterRedraw.entry.hand
    .map((card, index) =>
      JSON.stringify(card) ===
      JSON.stringify(legacyBeforeRedraw.entry.hand[index])
        ? null
        : index,
    )
    .filter((index) => index !== null),
  legacyAfterRedraw.entry.redraw.positions,
);
const legacyRetry = await service.redrawBitebluff(
  alice.userId,
  guildOne,
  { count: 2 },
  legacyRedrawTime,
);
assert.equal(legacyRetry.applied, false);
const legacySettlementTime = new Date("2026-07-28T03:01:00.000Z");
await service.settleBitebluffRound(
  legacyAfterRedraw.round.id,
  legacySettlementTime,
);
const legacyArchiveExceptionState = await service.bitebluffPrivateState(
  "legacy-spectator",
  guildTwo,
  new Date("2026-07-28T04:01:00.000Z"),
);
assert.equal(legacyArchiveExceptionState.yesterdayResults.date, "2026-07-27");
assert.equal(legacyArchiveExceptionState.yesterdayResults.results.length, 1);
assert.equal(
  legacyArchiveExceptionState.yesterdayResults.results[0].userId,
  alice.userId,
);
assert.equal(
  legacyArchiveExceptionState.yesterdayResultsUnavailableReason,
  null,
);
const legacyArchiveExpiredState = await service.bitebluffPrivateState(
  "legacy-spectator",
  guildOne,
  new Date("2026-07-29T04:01:00.000Z"),
);
assert.equal(legacyArchiveExpiredState.yesterdayResults, null);
assert.equal(
  legacyArchiveExpiredState.yesterdayResultsUnavailableReason,
  "no-settled-round",
);
await assert.rejects(
  service.redrawBitebluff(
    alice.userId,
    guildOne,
    { count: 3 },
    legacyRedrawTime,
  ),
  /already been used/,
);

console.log(
  "Bitebluff legacy Discord verification passed: July 27 legacy global-round preservation, July 28 guild-specific rounds with isolated entrants, pots, leaderboard membership, and destinations, exact-card redraw cutover with untouched-card preservation, daily top-up and redraw-reserved bounds, atomic one-entry debit, redacted pot roster, encrypted pre-settlement hands, guild-wide post-settlement hand review, isolated yesterday archives with a midnight rollover, exactly-once post-midnight interaction settlement delivery, retired launch components, rolling 13-minute preview windows, layered-pot conservation, idempotent settlement, and balance conservation.",
);
