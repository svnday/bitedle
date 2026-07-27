import fs from "node:fs";
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
const outputDir = path.join(repoRoot, ".bitedle-plans", "bitebluff-samples");
fs.mkdirSync(outputDir, { recursive: true });

const {
  renderBitebluffFinalImage,
  renderBitebluffPublicPreviewImage,
} = require(path.join(repoRoot, "src", "lib", "bitebluff-discord-preview.tsx"));

const round = {
  id: "2026-07-27",
  date: "2026-07-27",
  status: "settled",
  opensAt: Date.parse("2026-07-27T04:00:00.000Z"),
  revealAt: Date.parse("2026-07-28T03:00:00.000Z"),
  secretCommitment: "sample",
  encryptedSecret: "sample",
  publishedSecret: "sample",
  settlingStartedAt: null,
  settledAt: Date.parse("2026-07-28T03:00:01.000Z"),
  createdAt: Date.parse("2026-07-27T04:00:00.000Z"),
};

const players = [
  {
    id: "nova",
    userId: "nova",
    discordUserId: "",
    displayName: "Nova",
    avatarHash: null,
    wager: 80,
    redrawSurcharge: 40,
    hand: [
      { rank: 14, suit: "hearts" },
      { rank: 13, suit: "hearts" },
      { rank: 12, suit: "hearts" },
      { rank: 11, suit: "hearts" },
      { rank: 10, suit: "hearts" },
    ],
    handCategory: "royal-flush",
    handLabel: "Royal Flush",
    wonLayers: [0, 1, 2, 3],
    payout: 310,
    contestedPayout: 310,
    unmatchedReturn: 0,
  },
  {
    id: "moss",
    userId: "moss",
    discordUserId: "",
    displayName: "Moss",
    avatarHash: null,
    wager: 90,
    redrawSurcharge: 0,
    hand: [
      { rank: 10, suit: "clubs" },
      { rank: 10, suit: "diamonds" },
      { rank: 10, suit: "spades" },
      { rank: 4, suit: "hearts" },
      { rank: 4, suit: "clubs" },
    ],
    handCategory: "full-house",
    handLabel: "Full House",
    wonLayers: [],
    payout: 0,
    contestedPayout: 0,
    unmatchedReturn: 0,
  },
  {
    id: "juno",
    userId: "juno",
    discordUserId: "",
    displayName: "Juno",
    avatarHash: null,
    wager: 60,
    redrawSurcharge: 0,
    hand: [
      { rank: 9, suit: "clubs" },
      { rank: 8, suit: "diamonds" },
      { rank: 7, suit: "hearts" },
      { rank: 6, suit: "spades" },
      { rank: 5, suit: "clubs" },
    ],
    handCategory: "straight",
    handLabel: "Nine-high Straight",
    wonLayers: [],
    payout: 0,
    contestedPayout: 0,
    unmatchedReturn: 0,
  },
  {
    id: "riley",
    userId: "riley",
    discordUserId: "",
    displayName: "Riley",
    avatarHash: null,
    wager: 40,
    redrawSurcharge: 0,
    hand: [
      { rank: 14, suit: "clubs" },
      { rank: 14, suit: "diamonds" },
      { rank: 8, suit: "hearts" },
      { rank: 5, suit: "spades" },
      { rank: 2, suit: "clubs" },
    ],
    handCategory: "pair",
    handLabel: "Pair of Aces",
    wonLayers: [],
    payout: 0,
    contestedPayout: 0,
    unmatchedReturn: 0,
  },
];

const previewEntries = players.map((player, index) => ({
  id: player.id,
  roundId: round.id,
  userId: player.userId,
  discordUserId: player.discordUserId,
  displayName: player.displayName,
  avatarHash: player.avatarHash,
  wager: player.wager,
  enteredAt: round.opensAt + index * 60_000,
}));

const finalEntries = players.map((player, index) => ({
  id: player.id,
  roundId: round.id,
  userId: player.userId,
  discordUserId: player.discordUserId,
  displayName: player.displayName,
  avatarHash: player.avatarHash,
  wager: player.wager,
  redrawSurcharge: player.redrawSurcharge,
  encryptedDiscardedCards: null,
  encryptedBurnPositions: null,
  redrawCount: player.redrawSurcharge > 0 ? 2 : null,
  redrawAt: player.redrawSurcharge > 0 ? round.revealAt - 60 * 60_000 : null,
  encryptedHand: "sample",
  revealedHand: player.hand,
  handCategory: player.handCategory,
  handLabel: player.handLabel,
  handComparison: [],
  wonLayers: player.wonLayers,
  payout: player.payout,
  contestedPayout: player.contestedPayout,
  unmatchedReturn: player.unmatchedReturn,
  settlementApplied: true,
  enteredAt: round.opensAt + index * 60_000,
  settledAt: round.settledAt,
}));

const totalPool = players.reduce(
  (total, player) => total + player.wager + player.redrawSurcharge,
  0,
);
const preview = await renderBitebluffPublicPreviewImage(
  { ...round, status: "open", publishedSecret: null, settledAt: null },
  previewEntries,
  totalPool,
).arrayBuffer();
const final = await renderBitebluffFinalImage(
  round,
  finalEntries,
  0,
  1,
  totalPool,
).arrayBuffer();

const previewPath = path.join(outputDir, "bitebluff-pre-reveal.png");
const finalPath = path.join(outputDir, "bitebluff-final-reveal.png");
fs.writeFileSync(previewPath, Buffer.from(preview));
fs.writeFileSync(finalPath, Buffer.from(final));

console.log(`Pre-reveal sample: ${previewPath}`);
console.log(`Final-reveal sample: ${finalPath}`);
