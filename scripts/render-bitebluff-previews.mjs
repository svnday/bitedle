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
const outputDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, ".tmp", "bitebluff-previews");
fs.mkdirSync(outputDir, { recursive: true });

const {
  renderBitebluffFinalImage,
  renderBitebluffPublicPreviewImage,
} = require(path.join(repoRoot, "src", "lib", "bitebluff-discord-preview.tsx"));

const c = (rank, suit) => ({ rank, suit });
const hands = [
  [c(14, "hearts"), c(13, "hearts"), c(12, "hearts"), c(11, "hearts"), c(10, "hearts")],
  [c(12, "clubs"), c(12, "diamonds"), c(12, "hearts"), c(12, "spades"), c(3, "clubs")],
  [c(10, "clubs"), c(10, "diamonds"), c(10, "spades"), c(4, "hearts"), c(4, "clubs")],
  [c(14, "spades"), c(11, "spades"), c(8, "spades"), c(5, "spades"), c(2, "spades")],
];
const labels = ["Royal Flush", "Four of a Kind", "Full House", "Flush"];
const players = ["Avery", "Mika", "Jordan", "Riley"];
const wagers = [120, 80, 50, 25];
const payouts = [275, 0, 0, 0];
const entries = players.map((displayName, index) => ({
  id: `entry-${index}`,
  roundId: "2026-07-26",
  userId: `user-${index}`,
  discordUserId: String(100000000000000000n + BigInt(index)),
  displayName,
  avatarHash: null,
  wager: wagers[index],
  encryptedHand: "sealed",
  revealedHand: hands[index],
  handCategory: null,
  handLabel: labels[index],
  handComparison: [],
  wonLayers: index === 0 ? [0] : [],
  payout: payouts[index],
  contestedPayout: payouts[index],
  unmatchedReturn: 0,
  settlementApplied: true,
  enteredAt: index,
  settledAt: Date.now(),
}));
const round = {
  id: "2026-07-26",
  date: "2026-07-26",
  status: "settled",
  opensAt: 0,
  revealAt: 0,
  secretCommitment: "demo",
  encryptedSecret: "demo",
  publishedSecret: "demo",
  settlingStartedAt: null,
  settledAt: Date.now(),
  createdAt: 0,
};

const publicImage = renderBitebluffPublicPreviewImage(
  { ...round, status: "open", settledAt: null, publishedSecret: null },
  entries.map((entry) => ({
    ...entry,
    revealedHand: null,
    handLabel: null,
    payout: 0,
    contestedPayout: 0,
    settlementApplied: false,
    settledAt: null,
  })),
);
const finalImage = renderBitebluffFinalImage(round, entries, 0, 1, 275);
await Promise.all([
  publicImage.arrayBuffer().then((buffer) =>
    fs.writeFileSync(path.join(outputDir, "public-preview.png"), Buffer.from(buffer)),
  ),
  finalImage.arrayBuffer().then((buffer) =>
    fs.writeFileSync(path.join(outputDir, "final-results.png"), Buffer.from(buffer)),
  ),
]);
console.log(outputDir);
