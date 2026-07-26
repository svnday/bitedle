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
    },
    files: [
      "bitebluff-constants.ts",
      "bitebluff-cards.ts",
      "bitebluff-poker.ts",
      "bitebluff-economy.ts",
      "bitebluff-payout.ts",
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
assert.deepEqual(economy.bitebluffWagerBounds(500), { minimum: 25, maximum: 125 });
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

const demoSource = fs.readFileSync(
  path.join(repoRoot, "src", "components", "BitebluffDemo.tsx"),
  "utf8",
);
assert.equal(demoSource.includes("/api/bitebluff"), false);
assert.equal(demoSource.includes("bitebluffPublicPreview"), true);
assert.equal(demoSource.includes("Lock wagers &amp; deal"), true);
assert.equal(demoSource.includes("Randomly burn"), true);

console.log(
  "Bitebluff verification passed: poker categories and kickers, exclusive seeded decks, random Burn & Draw, safety-net economy, active eligibility, layered pots, tied remainders, unmatched returns, and redacted public preview.",
);
