import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bitedle-bitebluff-"));
const compileDir = path.join(tempDir, "compiled");
const tsconfigPath = path.join(tempDir, "tsconfig.json");

fs.writeFileSync(
  tsconfigPath,
  JSON.stringify({
    compilerOptions: {
      target: "ES2020",
      module: "CommonJS",
      moduleResolution: "Node",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: compileDir,
      rootDir: path.join(repoRoot, "src", "lib"),
      typeRoots: [path.join(repoRoot, "node_modules", "@types")],
      types: ["node"],
    },
    files: [
      "bitebluff-constants.ts",
      "bitebluff-cards.ts",
      "bitebluff-poker.ts",
      "bitebluff-economy.ts",
      "bitebluff-payout.ts",
      "time.ts",
      "bitebluff-time.ts",
      "bitebluff-crypto.ts",
    ].map((file) => path.join(repoRoot, "src", "lib", file)),
  }),
);

const compile = spawnSync(
  process.execPath,
  [path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"), "-p", tsconfigPath],
  { cwd: repoRoot, encoding: "utf8" },
);
assert.equal(compile.status, 0, `${compile.stdout}\n${compile.stderr}`);

const require = createRequire(import.meta.url);
const cards = require(path.join(compileDir, "bitebluff-cards.js"));
const poker = require(path.join(compileDir, "bitebluff-poker.js"));
const economy = require(path.join(compileDir, "bitebluff-economy.js"));
const payout = require(path.join(compileDir, "bitebluff-payout.js"));
const bitebluffTime = require(path.join(compileDir, "bitebluff-time.js"));
const bitebluffCrypto = require(path.join(compileDir, "bitebluff-crypto.js"));

const c = (rank, suit) => ({ rank, suit });
const hands = {
  royal: [c(14, "hearts"), c(13, "hearts"), c(12, "hearts"), c(11, "hearts"), c(10, "hearts")],
  straightFlush: [c(9, "clubs"), c(8, "clubs"), c(7, "clubs"), c(6, "clubs"), c(5, "clubs")],
  quads: [c(12, "clubs"), c(12, "diamonds"), c(12, "hearts"), c(12, "spades"), c(3, "clubs")],
  fullHouse: [c(10, "clubs"), c(10, "diamonds"), c(10, "spades"), c(4, "hearts"), c(4, "clubs")],
  flush: [c(14, "spades"), c(11, "spades"), c(8, "spades"), c(5, "spades"), c(2, "spades")],
  straight: [c(8, "clubs"), c(7, "diamonds"), c(6, "hearts"), c(5, "spades"), c(4, "clubs")],
  trips: [c(7, "clubs"), c(7, "diamonds"), c(7, "spades"), c(13, "hearts"), c(2, "clubs")],
  twoPair: [c(11, "clubs"), c(11, "diamonds"), c(5, "hearts"), c(5, "spades"), c(14, "clubs")],
  pair: [c(9, "clubs"), c(9, "hearts"), c(14, "diamonds"), c(6, "spades"), c(3, "clubs")],
  high: [c(14, "clubs"), c(11, "diamonds"), c(8, "hearts"), c(5, "spades"), c(2, "clubs")],
  wheel: [c(14, "clubs"), c(2, "diamonds"), c(3, "hearts"), c(4, "spades"), c(5, "clubs")],
};

assert.deepEqual(
  Object.values(hands)
    .slice(0, 10)
    .map((hand) => poker.evaluateBitebluffHand(hand).category),
  [
    "royal-flush",
    "straight-flush",
    "four-of-a-kind",
    "full-house",
    "flush",
    "straight",
    "three-of-a-kind",
    "two-pair",
    "pair",
    "high-card",
  ],
);
assert.equal(poker.evaluateBitebluffHand(hands.wheel).comparison[0], 5);
assert.equal(
  poker.compareBitebluffHands(
    poker.evaluateBitebluffHand(hands.royal),
    poker.evaluateBitebluffHand(hands.straightFlush),
  ),
  1,
);
assert.deepEqual(
  poker.evaluateBitebluffHand([...hands.twoPair].reverse()),
  poker.evaluateBitebluffHand(hands.twoPair),
);
assert.throws(() => poker.evaluateBitebluffHand([hands.high[0], ...hands.high.slice(0, 4)]));

const firstDeal = cards.dealBitebluffHand("repeatable", "alice");
const secondDeal = cards.dealBitebluffHand("repeatable", "alice");
assert.deepEqual(firstDeal, secondDeal);
assert.equal(new Set(firstDeal.hand.map(cards.bitebluffCardKey)).size, 5);
assert.equal(firstDeal.remaining.length, 47);
const redraw = cards.applyRandomBitebluffRedraw({
  hand: firstDeal.hand,
  remaining: firstDeal.remaining,
  seed: "redraw-a",
  count: 3,
});
assert.equal(redraw.positions.length, 3);
assert.equal(new Set(redraw.positions).size, 3);
assert.equal(new Set(redraw.hand.map(cards.bitebluffCardKey)).size, 5);
assert.deepEqual(
  redraw,
  cards.applyRandomBitebluffRedraw({
    hand: firstDeal.hand,
    remaining: firstDeal.remaining,
    seed: "redraw-a",
    count: 3,
  }),
);
assert.throws(() => cards.randomBurnPositions("bad", 0));
assert.throws(() => cards.randomBurnPositions("bad", 4));

assert.equal(economy.bitebluffTopUp(0), 100);
assert.equal(economy.bitebluffTopUp(70), 30);
assert.equal(economy.bitebluffTopUp(100), 0);
assert.deepEqual(economy.bitebluffWagerBounds(100), { minimum: 10, maximum: 66 });
assert.deepEqual(economy.bitebluffWagerBounds(500), { minimum: 25, maximum: 333 });
assert.deepEqual(economy.bitebluffWagerBounds(1_000), { minimum: 50, maximum: 666 });
for (const balance of [100, 500, 1_000, 10_000]) {
  const maximum = economy.bitebluffWagerBounds(balance).maximum;
  assert.ok(maximum + economy.bitebluffRedrawSurcharge(maximum) <= balance);
  assert.ok(
    maximum + 1 + economy.bitebluffRedrawSurcharge(maximum + 1) > balance,
    "the next Bite must exceed the redraw-reserved cap",
  );
}
assert.equal(economy.bitebluffRedrawSurcharge(25), 13);
assert.equal(economy.isBitebluffActive(0, 6), true);
assert.equal(economy.isBitebluffActive(0, 7), false);
assert.equal(economy.bitebluffSeasonNet({ payouts: 80, wagers: 50, redrawSurcharges: 10 }), 20);

const layered = payout.settleBitebluffLayers([
  { id: "alice", committed: 10, hand: hands.straightFlush },
  { id: "bob", committed: 50, hand: hands.quads },
  { id: "charlie", committed: 100, hand: hands.fullHouse },
]);
assert.equal(layered.totalPool, 160);
assert.deepEqual(layered.payouts, { alice: 30, bob: 80, charlie: 50 });
assert.deepEqual(layered.unmatchedReturns, { alice: 0, bob: 0, charlie: 50 });
assert.equal(layered.layers.length, 3);
assert.equal(
  Object.values(layered.payouts).reduce((sum, amount) => sum + amount, 0),
  layered.totalPool,
);

const tie = payout.settleBitebluffLayers([
  { id: "alpha", committed: 25, hand: hands.royal },
  {
    id: "beta",
    committed: 25,
    hand: [c(14, "spades"), c(13, "spades"), c(12, "spades"), c(11, "spades"), c(10, "spades")],
  },
  { id: "gamma", committed: 25, hand: hands.quads },
]);
assert.deepEqual(tie.payouts, { alpha: 38, beta: 37, gamma: 0 });

const preview = payout.bitebluffPublicPreview([
  {
    id: "alpha",
    name: "Alpha",
    avatar: "A",
    wager: 25,
    redrawSurcharge: 13,
    hand: hands.royal,
    category: "royal-flush",
    seed: "secret",
  },
]);
assert.deepEqual(Object.keys(preview.participants[0]).sort(), ["avatar", "id", "name", "wager"]);
const serializedPreview = JSON.stringify(preview);
for (const forbidden of ["royal-flush", "secret", '"hand"', '"category"', '"seed"']) {
  assert.equal(serializedPreview.includes(forbidden), false);
}
assert.equal(preview.participants[0].wager, 38);

const finalPreview = payout.bitebluffFinalPreview(
  [
    { id: "alice", name: "Alice", avatar: "A", wager: 10, hand: hands.straightFlush },
    { id: "bob", name: "Bob", avatar: "B", wager: 50, hand: hands.quads },
    { id: "charlie", name: "Charlie", avatar: "C", wager: 100, hand: hands.fullHouse },
  ],
  layered,
);
assert.equal(finalPreview.participants.length, 3);
assert.equal(finalPreview.participants[0].winner, true);
assert.deepEqual(finalPreview.participants[0].layerWins, ["Main pot"]);
assert.equal(finalPreview.participants[0].payout, 30);
assert.equal(finalPreview.participants[0].net, 20);
assert.equal(finalPreview.participants[2].winner, false);
assert.equal(finalPreview.participants[2].committed, 100);
assert.equal(finalPreview.participants[2].amountLost, 50);
assert.equal(finalPreview.participants[2].unmatchedReturn, 50);
assert.equal(finalPreview.participants.every((participant) => participant.hand.length === 5), true);

process.env.BITEBLUFF_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const roundSecret = "committed-round-secret";
const committedHand = bitebluffCrypto.dealCommittedBitebluffHand(roundSecret, "alice");
assert.deepEqual(
  committedHand,
  bitebluffCrypto.dealCommittedBitebluffHand(roundSecret, "alice"),
);
assert.notDeepEqual(
  committedHand,
  bitebluffCrypto.dealCommittedBitebluffHand(roundSecret, "bob"),
);
assert.equal(new Set(committedHand.map(cards.bitebluffCardKey)).size, 5);
const encryptedHand = bitebluffCrypto.encryptBitebluffValue(committedHand);
assert.deepEqual(bitebluffCrypto.decryptBitebluffValue(encryptedHand), committedHand);
assert.equal(encryptedHand.includes(JSON.stringify(committedHand)), false);
assert.equal(
  bitebluffCrypto.bitebluffSecretCommitment(roundSecret),
  bitebluffCrypto.bitebluffSecretCommitment(roundSecret),
);
assert.equal(
  new Date(bitebluffTime.bitebluffRoundWindow("2026-01-15").revealAt).toISOString(),
  "2026-01-16T04:00:00.000Z",
);
assert.equal(
  new Date(bitebluffTime.bitebluffRoundWindow("2026-07-15").revealAt).toISOString(),
  "2026-07-16T03:00:00.000Z",
);

const demoSource = fs.readFileSync(
  path.join(repoRoot, "src", "components", "BitebluffDemo.tsx"),
  "utf8",
);
assert.equal(demoSource.includes("/api/bitebluff"), false);
assert.equal(demoSource.includes("bitebluffPublicPreview"), true);
assert.equal(demoSource.includes("Lock wagers &amp; deal"), true);
assert.equal(demoSource.includes("Randomly burn"), true);
assert.equal(demoSource.includes('setStatus(placing ? "placed" : "sealed")'), true);
assert.equal(demoSource.includes('setStatus("flipping")'), true);

const tableSource = fs.readFileSync(
  path.join(repoRoot, "src", "components", "BitebluffTable.tsx"),
  "utf8",
);
assert.equal(tableSource.includes("index >= placedCount"), true);
assert.equal(tableSource.includes("bitebluff-card-placeholder"), true);
assert.equal(tableSource.includes("dealing={dealing && index === placedCount - 1}"), true);
assert.equal(tableSource.includes("flipping={flipping && index === revealedCount - 1}"), true);

const interactionSource = fs.readFileSync(
  path.join(repoRoot, "src", "app", "api", "discord", "interactions", "route.ts"),
  "utf8",
);
assert.equal(interactionSource.includes('body?.data?.name === "bitebluff"'), true);
assert.equal(interactionSource.includes("BITEBLUFF_CONFIRM_PREFIX"), false);
assert.equal(interactionSource.includes('recordIntent(body, "bitebluff", false)'), true);
assert.equal(interactionSource.includes("ensureBitebluffRound(new Date(launchedAt))"), true);
assert.equal(
  interactionSource.indexOf("recordBitebluffDestination({") <
    interactionSource.indexOf("getUserIdByDiscordId(discordUserId)"),
  true,
);
assert.equal(interactionSource.includes("updateBitebluffPublicPreview(destination.id)"), true);
assert.equal(interactionSource.includes("allowed_mentions: { parse: [] }"), true);
const registrationSource = fs.readFileSync(
  path.join(repoRoot, "scripts", "register-discord-commands.mjs"),
  "utf8",
);
assert.equal(registrationSource.includes('name: "bitebluff"'), true);
assert.equal(registrationSource.includes('name: "wager"'), false);
const bitebluffGameSource = fs.readFileSync(
  path.join(repoRoot, "src", "components", "BitebluffGame.tsx"),
  "utf8",
);
assert.equal(bitebluffGameSource.includes("api.bitebluffEnter(selectedWager)"), true);
assert.equal(bitebluffGameSource.includes("api.bitebluffRedraw(redrawCount)"), true);
assert.equal(bitebluffGameSource.includes("api.bitebluffLeaderboard()"), true);
assert.equal(bitebluffGameSource.includes("Review wager"), true);
assert.equal(bitebluffGameSource.includes("Final confirmation"), true);
assert.equal(bitebluffGameSource.includes("Current bankroll"), true);
assert.equal(bitebluffGameSource.includes("BitebluffPotRoster"), true);
const entryRouteSource = fs.readFileSync(
  path.join(repoRoot, "src", "app", "api", "bitebluff", "entry", "route.ts"),
  "utf8",
);
assert.equal(entryRouteSource.includes("enterBitebluff("), true);
assert.equal(entryRouteSource.includes("discordChannelIdFromRequest"), true);
const redrawRouteSource = fs.readFileSync(
  path.join(repoRoot, "src", "app", "api", "bitebluff", "redraw", "route.ts"),
  "utf8",
);
assert.equal(redrawRouteSource.includes("redrawBitebluff("), true);
assert.equal(redrawRouteSource.includes("updateBitebluffPublicPreview"), true);
const leaderboardRouteSource = fs.readFileSync(
  path.join(repoRoot, "src", "app", "api", "bitebluff", "leaderboard", "route.ts"),
  "utf8",
);
assert.equal(leaderboardRouteSource.includes("bitebluffLeaderboard("), true);
const cronConfig = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "vercel.json"), "utf8"),
);
assert.deepEqual(
  cronConfig.crons.map((cron) => cron.schedule),
  ["0 3 * * *", "0 4 * * *"],
);
const discordPreviewSource = fs.readFileSync(
  path.join(repoRoot, "src", "lib", "bitebluff-discord-preview.tsx"),
  "utf8",
);
assert.equal(
  discordPreviewSource.includes("repository.previewEntriesForRound(destination.roundId)"),
  true,
);
assert.equal(
  discordPreviewSource.includes("repository.totalCommittedForRound(destination.roundId)"),
  true,
);
assert.equal(discordPreviewSource.includes("messageId: previewMessageId ?? undefined"), true);
const bitebluffStoreSource = fs.readFileSync(
  path.join(repoRoot, "src", "lib", "bitebluff-store.ts"),
  "utf8",
);
assert.equal(
  bitebluffStoreSource.includes("ELSE bitebluff_destinations.webhook_token"),
  true,
);
assert.deepEqual(
  cronConfig.crons.map((cron) => cron.path),
  ["/api/bitebluff/settle", "/api/bitebluff/settle-est"],
);

console.log(
  "Bitebluff verification passed: poker categories and kickers, exclusive seeded decks, random Burn & Draw, safety-net economy, active eligibility, layered pots, tied remainders, unmatched returns, and redacted public preview.",
  " Bitebluff final preview includes every hand, layer winners, payouts, and loser wager/loss amounts. The private deal places five face-down cards before the separate sequential flip pass. Discord production checks cover committed encrypted hands, DST-safe 11 PM ET settlement, launch-only command routing, in-Activity blind-wager confirmation, zero-ping payloads, and both UTC scheduler slots.",
);
