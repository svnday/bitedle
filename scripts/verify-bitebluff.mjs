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
const royalInsight = poker.bitebluffHandInsight(hands.royal);
const fullHouseInsight = poker.bitebluffHandInsight(hands.fullHouse);
const pairInsight = poker.bitebluffHandInsight(hands.pair);
const highCardInsight = poker.bitebluffHandInsight(hands.high);
const wheelInsight = poker.bitebluffHandInsight(hands.wheel);
assert.equal(royalInsight.label, "Royal Flush");
assert.equal(royalInsight.score, 100);
assert.match(royalInsight.summary, /best possible/);
assert.equal(fullHouseInsight.label, "Full House");
assert.match(fullHouseInsight.summary, /Tens full of Fours/);
assert.equal(fullHouseInsight.score > pairInsight.score, true);
assert.equal(pairInsight.score > highCardInsight.score, true);
assert.equal(highCardInsight.label, "High Card");
assert.match(highCardInsight.summary, /Ace-high.*Kickers: J, 8, 5, 2/);
assert.match(wheelInsight.summary, /Five-high straight/);
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
const selectedPositions = [0, 2, 4];
const redraw = cards.applySelectedBitebluffRedraw({
  hand: firstDeal.hand,
  remaining: firstDeal.remaining,
  positions: selectedPositions,
});
assert.deepEqual(redraw.positions, selectedPositions);
assert.equal(new Set(redraw.hand.map(cards.bitebluffCardKey)).size, 5);
assert.equal(redraw.remaining.length, 44);
assert.deepEqual(redraw.hand[1], firstDeal.hand[1]);
assert.deepEqual(redraw.hand[3], firstDeal.hand[3]);
assert.deepEqual(
  redraw.hand
    .map((card, index) =>
      JSON.stringify(card) === JSON.stringify(firstDeal.hand[index])
        ? null
        : index,
    )
    .filter((index) => index !== null),
  selectedPositions,
);
assert.deepEqual(
  redraw,
  cards.applySelectedBitebluffRedraw({
    hand: firstDeal.hand,
    remaining: firstDeal.remaining,
    positions: [...selectedPositions].reverse(),
  }),
);
assert.deepEqual(cards.normalizeBitebluffBurnPositions([4, 0]), [0, 4]);
assert.throws(() => cards.normalizeBitebluffBurnPositions([]));
assert.throws(() => cards.normalizeBitebluffBurnPositions([0, 0]));
assert.throws(() => cards.normalizeBitebluffBurnPositions([0, 1, 2, 3]));
assert.throws(() => cards.normalizeBitebluffBurnPositions([5]));
assert.equal(cards.normalizeBitebluffRedrawCount(1), 1);
assert.equal(cards.normalizeBitebluffRedrawCount(3), 3);
assert.throws(() => cards.normalizeBitebluffRedrawCount(0));
assert.throws(() => cards.normalizeBitebluffRedrawCount(4));

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
const committedRedraw = bitebluffCrypto.redrawCommittedBitebluffHand({
  secret: roundSecret,
  entrantId: "alice",
  hand: committedHand,
  positions: [1, 3],
});
assert.deepEqual(committedRedraw.positions, [1, 3]);
assert.deepEqual(committedRedraw.hand[0], committedHand[0]);
assert.deepEqual(committedRedraw.hand[2], committedHand[2]);
assert.deepEqual(committedRedraw.hand[4], committedHand[4]);
assert.notDeepEqual(committedRedraw.hand[1], committedHand[1]);
assert.notDeepEqual(committedRedraw.hand[3], committedHand[3]);
const legacyCommittedRedraw =
  bitebluffCrypto.redrawRandomCommittedBitebluffHand({
    secret: roundSecret,
    entrantId: "alice",
    hand: committedHand,
    count: 2,
  });
assert.equal(legacyCommittedRedraw.positions.length, 2);
assert.deepEqual(
  legacyCommittedRedraw,
  bitebluffCrypto.redrawRandomCommittedBitebluffHand({
    secret: roundSecret,
    entrantId: "alice",
    hand: committedHand,
    count: 2,
  }),
);
assert.deepEqual(
  legacyCommittedRedraw.hand
    .map((card, index) =>
      JSON.stringify(card) === JSON.stringify(committedHand[index])
        ? null
        : index,
    )
    .filter((index) => index !== null),
  legacyCommittedRedraw.positions,
);
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
assert.equal(bitebluffTime.bitebluffRedrawMode("2026-07-27"), "random-count");
assert.equal(bitebluffTime.bitebluffRedrawMode("2026-07-28"), "selected-cards");
assert.equal(bitebluffTime.bitebluffUsesGuildRounds("2026-07-27"), false);
assert.equal(bitebluffTime.bitebluffUsesGuildRounds("2026-07-28"), true);

const demoSource = fs.readFileSync(
  path.join(repoRoot, "src", "components", "BitebluffDemo.tsx"),
  "utf8",
);
assert.equal(demoSource.includes("/api/bitebluff"), false);
assert.equal(demoSource.includes("bitebluffPublicPreview"), true);
assert.equal(demoSource.includes("Lock wagers &amp; deal"), true);
assert.equal(demoSource.includes("Lock selected cards &amp; redraw"), true);
assert.equal(demoSource.includes("applySelectedBitebluffRedraw"), true);
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
assert.equal(tableSource.includes("bitebluff-card-burning"), true);
assert.equal(tableSource.includes("bitebluff-card-choice"), true);
assert.equal(tableSource.includes("replacementOrder < 0"), true);
const redrawAnimationSource = fs.readFileSync(
  path.join(
    repoRoot,
    "src",
    "components",
    "useBitebluffRedrawAnimation.ts",
  ),
  "utf8",
);
assert.equal(redrawAnimationSource.includes('phase: "burning"'), true);
assert.equal(redrawAnimationSource.includes('phase: "drawing"'), true);
assert.equal(redrawAnimationSource.includes('phase: "flipping"'), true);
const globalCssSource = fs.readFileSync(
  path.join(repoRoot, "src", "app", "globals.css"),
  "utf8",
);
assert.equal(globalCssSource.includes("@keyframes bitebluff-burn-card"), true);
assert.equal(globalCssSource.includes("@keyframes bitebluff-burn-flare"), true);
assert.equal(
  globalCssSource.includes(
    "@media (prefers-reduced-motion: reduce)",
  ),
  true,
);

const interactionSource = fs.readFileSync(
  path.join(repoRoot, "src", "app", "api", "discord", "interactions", "route.ts"),
  "utf8",
);
assert.equal(interactionSource.includes('body?.data?.name === "bitebluff"'), true);
assert.equal(interactionSource.includes("BITEBLUFF_CONFIRM_PREFIX"), false);
assert.equal(interactionSource.includes('recordIntent(body, "bitebluff", false)'), true);
assert.equal(interactionSource.includes("ensureBitebluffRound("), true);
assert.equal(interactionSource.includes("guildId,"), true);
assert.equal(
  interactionSource.indexOf("recordBitebluffDestination({") <
    interactionSource.indexOf("getUserIdByDiscordId(discordUserId)"),
  true,
);
assert.equal(interactionSource.includes("updateBitebluffPublicPreview(destination.id)"), true);
assert.equal(
  interactionSource.includes(
    "body?.data?.custom_id === BITEBLUFF_LAUNCH_BUTTON_ID",
  ),
  true,
);
assert.equal(interactionSource.includes("allowed_mentions: { parse: [] }"), true);
const registrationSource = fs.readFileSync(
  path.join(repoRoot, "scripts", "register-discord-commands.mjs"),
  "utf8",
);
assert.equal(registrationSource.includes('name: "bitebluff"'), true);
assert.equal(registrationSource.includes('name: "wager"'), false);
assert.equal(
  registrationSource.includes('const scope = "applications.commands bot"'),
  true,
);
assert.equal(registrationSource.includes('permissions: "35840"'), true);
const bitebluffGameSource = fs.readFileSync(
  path.join(repoRoot, "src", "components", "BitebluffGame.tsx"),
  "utf8",
);
assert.equal(bitebluffGameSource.includes("api.bitebluffEnter(selectedWager)"), true);
assert.equal(
  bitebluffGameSource.includes('{ positions: lockedPositions }'),
  true,
);
assert.equal(bitebluffGameSource.includes("{ count: redrawCount }"), true);
assert.equal(bitebluffGameSource.includes('=== "selected-cards"'), true);
assert.equal(bitebluffGameSource.includes("selectedBurnPositions"), true);
assert.equal(bitebluffGameSource.includes("startRedrawAnimation"), true);
assert.equal(bitebluffGameSource.includes("randomly selected cards"), true);
assert.equal(bitebluffGameSource.includes("api.bitebluffLeaderboard()"), true);
assert.equal(bitebluffGameSource.includes("Review wager"), true);
assert.equal(bitebluffGameSource.includes("Final confirmation"), true);
assert.equal(bitebluffGameSource.includes("Current bankroll"), true);
assert.equal(bitebluffGameSource.includes("BitebluffPotRoster"), true);
assert.equal(bitebluffGameSource.includes("BitebluffHandStrength"), true);
const handStrengthSource = fs.readFileSync(
  path.join(repoRoot, "src", "components", "BitebluffHandStrength.tsx"),
  "utf8",
);
assert.equal(handStrengthSource.includes("Hand strength"), true);
assert.equal(handStrengthSource.includes("not your odds of winning"), true);
const entryRouteSource = fs.readFileSync(
  path.join(repoRoot, "src", "app", "api", "bitebluff", "entry", "route.ts"),
  "utf8",
);
assert.equal(entryRouteSource.includes("enterBitebluff("), true);
assert.equal(entryRouteSource.includes("discordChannelIdFromRequest"), true);
assert.equal(entryRouteSource.includes("guildIdFromRequest"), true);
const redrawRouteSource = fs.readFileSync(
  path.join(repoRoot, "src", "app", "api", "bitebluff", "redraw", "route.ts"),
  "utf8",
);
assert.equal(redrawRouteSource.includes("redrawBitebluff("), true);
assert.equal(redrawRouteSource.includes("body?.positions"), true);
assert.equal(redrawRouteSource.includes("body?.count"), true);
assert.equal(redrawRouteSource.includes("bitebluffRedrawMode"), true);
assert.equal(redrawRouteSource.includes("guildIdFromRequest"), true);
assert.equal(redrawRouteSource.includes("updateBitebluffPublicPreview"), true);
const clientApiSource = fs.readFileSync(
  path.join(repoRoot, "src", "lib", "client-api.ts"),
  "utf8",
);
assert.equal(clientApiSource.includes("JSON.stringify(selection)"), true);
const leaderboardRouteSource = fs.readFileSync(
  path.join(repoRoot, "src", "app", "api", "bitebluff", "leaderboard", "route.ts"),
  "utf8",
);
assert.equal(leaderboardRouteSource.includes("bitebluffLeaderboard("), true);
assert.equal(leaderboardRouteSource.includes("guildIdFromRequest"), true);
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
assert.equal(
  discordPreviewSource.includes("const deliveryErrors: Error[] = []"),
  true,
);
assert.equal(
  discordPreviewSource.includes("if ((!result.ok || !result.messageId) && webhookIsFresh)"),
  true,
);
assert.equal(
  discordPreviewSource.includes("messageId: targetMessageId ?? undefined"),
  true,
);
assert.equal(discordPreviewSource.includes("FINAL_PAGE_SIZE"), false);
const bitebluffStoreSource = fs.readFileSync(
  path.join(repoRoot, "src", "lib", "bitebluff-store.ts"),
  "utf8",
);
assert.equal(
  bitebluffStoreSource.includes("ELSE bitebluff_destinations.webhook_token"),
  true,
);
assert.equal(
  bitebluffStoreSource.includes("bitebluff_rounds_date_guild_idx"),
  true,
);
assert.equal(
  bitebluffStoreSource.includes("member_round.guild_id"),
  true,
);
assert.equal(
  discordPreviewSource.includes(
    "if ((!result.ok || !result.messageId) && webhookIsFresh)",
  ),
  true,
);
assert.equal(
  discordPreviewSource.includes(
    "(result.status === 403 || result.status === 404)",
  ),
  true,
);
assert.equal(
  discordPreviewSource.includes(
    'export const BITEBLUFF_LAUNCH_BUTTON_ID = "bitebluff-launch"',
  ),
  true,
);
assert.equal(discordPreviewSource.includes('label: "Play now!"'), true);
assert.deepEqual(
  cronConfig.crons.map((cron) => cron.path),
  ["/api/bitebluff/settle", "/api/bitebluff/settle-est"],
);

console.log(
  "Bitebluff verification passed: poker categories and kickers, private percentile hand insights, exclusive seeded decks, exact-card Burn & Draw with untouched-card preservation, safety-net economy, active eligibility, layered pots, tied remainders, unmatched returns, and redacted public preview.",
  " Bitebluff final preview includes every hand, layer winners, payouts, and loser wager/loss amounts. The private deal places five face-down cards before the separate sequential flip pass. Discord production checks cover committed encrypted hands, DST-safe 11 PM ET settlement, launch-only command routing, in-Activity blind-wager confirmation, zero-ping payloads, and both UTC scheduler slots.",
);
