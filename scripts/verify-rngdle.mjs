import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bitedle-rngdle-"));
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
      allowJs: true,
      checkJs: false,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: compileDir,
      rootDir: path.join(repoRoot, "src", "lib"),
      typeRoots: [path.join(repoRoot, "node_modules", "@types")],
      types: ["node"],
    },
    files: [
      path.join(repoRoot, "src", "lib", "rngdle", "types.ts"),
      path.join(repoRoot, "src", "lib", "rngdle", "probabilities.gen.js"),
      path.join(repoRoot, "src", "lib", "rngdle", "reference-engine.js"),
      path.join(repoRoot, "src", "lib", "rngdle", "scoring.ts"),
      path.join(repoRoot, "src", "lib", "rngdle", "reveal.ts"),
      path.join(repoRoot, "src", "lib", "rngdle", "time.ts"),
    ],
  }),
);

const compile = spawnSync(
  process.execPath,
  [path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"), "-p", tsconfigPath],
  { cwd: repoRoot, encoding: "utf8" },
);
assert.equal(compile.status, 0, `${compile.stdout}\n${compile.stderr}`);

const require = createRequire(import.meta.url);
const scoring = require(path.join(compileDir, "rngdle", "scoring.js"));
const reveal = require(path.join(compileDir, "rngdle", "reveal.js"));
const time = require(path.join(compileDir, "rngdle", "time.js"));
const engine = require(path.join(compileDir, "rngdle", "reference-engine.js"));

assert.equal(engine.BADGES.length, 230, "the pinned compatibility catalog must contain 230 badges");
assert.equal(new Set(engine.BADGES.map((badge) => badge[0])).size, 230);
assert.equal(engine.FAMILIES.length, 40);

const exactTotals = new Map([
  [0, 139_927_162],
  [1, 186_186_584],
  [2, 119_610_065],
  [3_125, 25_419_196],
  [455_000, 1_190_406],
  [634_700, 18_194],
  [407_777, 412_805],
]);
for (const [number, expectedEp] of exactTotals) {
  assert.equal(scoring.scoreRngdleNumber(number).rawEp, expectedEp, `${number} EP parity`);
}

assert.equal(scoring.scoreRngdleNumber(69).badges.some((badge) => badge.id === "NICE_EXACT"), true);
assert.equal(scoring.scoreRngdleNumber(1_000_000).badges.some((badge) => badge.id === "ONE_MILLION"), true);
assert.throws(() => scoring.scoreRngdleNumber(-1), RangeError);
assert.throws(() => scoring.scoreRngdleNumber(1_000_001), RangeError);
assert.throws(() => scoring.scoreRngdleNumber(1.5), RangeError);

assert.equal(scoring.selectRngdleNumber((upper) => {
  assert.equal(upper, 1_000_001);
  return 0;
}), 0);
assert.equal(scoring.selectRngdleNumber(() => 1_000_000), 1_000_000);
assert.throws(() => scoring.selectRngdleNumber(() => -1), RangeError);
assert.equal(scoring.selectRngdlePenalty(() => 0), 1);
assert.equal(scoring.selectRngdlePenalty(() => 98), 99);

const unpenalized = scoring.scoreRngdleNumber(69);
assert.equal(unpenalized.creditedEp, unpenalized.rawEp);
assert.equal(scoring.scoreRngdleNumber(69, 1).creditedEp, Math.floor(unpenalized.rawEp * 0.99));
assert.equal(scoring.scoreRngdleNumber(69, 99).creditedEp, Math.floor(unpenalized.rawEp * 0.01));
assert.throws(() => scoring.scoreRngdleNumber(69, 0), RangeError);
assert.throws(() => scoring.scoreRngdleNumber(69, 100), RangeError);

assert.equal(time.rngdleGameDay(new Date("2026-08-19T22:59:59.999Z")), "2026-08-18");
assert.equal(time.rngdleGameDay(new Date("2026-08-19T23:00:00.000Z")), "2026-08-19");
assert.equal(time.rngdleNextResetAt(new Date("2026-08-19T23:00:00.000Z")), Date.parse("2026-08-20T23:00:00.000Z"));
assert.equal(time.rngdleEasternWallClock("2026-03-07"), Date.parse("2026-03-08T00:00:00.000Z"));
assert.equal(time.rngdleEasternWallClock("2026-03-08"), Date.parse("2026-03-08T23:00:00.000Z"));
assert.equal(time.rngdleEasternWallClock("2026-11-01"), Date.parse("2026-11-02T00:00:00.000Z"));
assert.equal(time.canRerollRngdle(1_000, null, 600_999), true);
assert.equal(time.canRerollRngdle(1_000, null, 601_000), false);
assert.equal(time.canRerollRngdle(1_000, 2_000, 3_000), false);

assert.deepEqual(reveal.rngdleDigitRevealOffsets(69), [0, 1_000, 2_040, 3_200, 4_560, 6_200]);
assert.equal(reveal.rngdleNumberRevealTimeline(69, false).spinMs, 2_000);
assert.equal(reveal.rngdleNumberRevealTimeline(69, false).numberRevealMs, 7_200);
assert.equal(reveal.rngdleNumberRevealTimeline(1_000_000, false).slotCount, 7);
assert.deepEqual(reveal.rngdleNumberRevealTimeline(69, true).digitOffsetsMs, [0, 60, 120, 180, 240, 300]);

const types = fs.readFileSync(path.join(repoRoot, "src", "lib", "types.ts"), "utf8");
const tabs = fs.readFileSync(path.join(repoRoot, "src", "components", "GameTabs.tsx"), "utf8");
const nav = fs.readFileSync(path.join(repoRoot, "src", "components", "GameNav.tsx"), "utf8");
const demo = fs.readFileSync(path.join(repoRoot, "src", "components", "RngdleDemo.tsx"), "utf8");
const roll = fs.readFileSync(path.join(repoRoot, "src", "components", "RngdleRoll.tsx"), "utf8");
const styles = fs.readFileSync(path.join(repoRoot, "src", "app", "globals.css"), "utf8");

assert.match(types, /\| "rngdle";/);
assert.match(nav, /\["rngdle", "RNGDLE"\]/);
assert.match(tabs, /requestedMode === "rngdle"/);
assert.match(tabs, /!runtime\.embedded && runtime\.mode === "rngdle"/);
assert.doesNotMatch(tabs, /\n\s*if \(runtime\.embedded && runtime\.mode === "rngdle"/);
assert.doesNotMatch(demo, /fetch\(/);
assert.match(demo, /bitedle:rngdle:website-lab:v1/);
assert.match(demo, /rngdleGameDay/);
assert.match(demo, /rngdleNumberRevealTimeline/);
assert.match(roll, /RNGDLE_REEL_TICK_MS/);
assert.match(roll, /rngdle-digit--spinning/);
assert.match(roll, /rngdle-number-card--finale/);
assert.match(styles, /@keyframes rngdle-digit-scroll/);
assert.match(styles, /@keyframes rngdle-finale-pulse/);
assert.doesNotMatch(styles, /@keyframes rngdle-digit-roll/);

console.log("RNGDLE verification passed.");
