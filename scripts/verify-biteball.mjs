import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bitedle-biteball-"));
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
    files: [path.join(repoRoot, "src", "lib", "biteball.ts")],
  }),
);

const compile = spawnSync(
  process.execPath,
  [path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"), "-p", tsconfigPath],
  { cwd: repoRoot, encoding: "utf8" },
);
assert.equal(compile.status, 0, `${compile.stdout}\n${compile.stderr}`);

const require = createRequire(import.meta.url);
const biteball = require(path.join(compileDir, "biteball.js"));
const answers = biteball.BITEBALL_ANSWERS;

assert.equal(answers.length, 20);
assert.equal(new Set(answers.map((answer) => answer.id)).size, 20);
assert.equal(new Set(answers.map((answer) => answer.text)).size, 20);
assert.deepEqual(
  answers.reduce((counts, answer) => {
    counts[answer.category] = (counts[answer.category] ?? 0) + 1;
    return counts;
  }, {}),
  { affirmative: 10, "non-committal": 5, negative: 5 },
);

const expectedText = [
  "It is certain",
  "It is decidedly so",
  "Without a doubt",
  "Yes, definitely",
  "You may rely on it",
  "As I see it, yes",
  "Most likely",
  "Outlook good",
  "Yes",
  "Signs point to yes",
  "Reply hazy, try again",
  "Ask again later",
  "Better not tell you now",
  "Cannot predict now",
  "Concentrate and ask again",
  "Don't count on it",
  "My reply is no",
  "My sources say no",
  "Outlook not so good",
  "Very doubtful",
];
assert.deepEqual(answers.map((answer) => answer.text), expectedText);

for (let index = 0; index < answers.length; index += 1) {
  let selections = 0;
  const answer = biteball.selectBiteballAnswer((upperExclusive) => {
    selections += 1;
    assert.equal(upperExclusive, 20);
    return index;
  });
  assert.equal(answer, answers[index]);
  assert.equal(selections, 1);
}

for (const invalidIndex of [-1, 20, 1.2, Number.NaN]) {
  assert.throws(() => biteball.selectBiteballAnswer(() => invalidIndex), RangeError);
}

const types = fs.readFileSync(path.join(repoRoot, "src", "lib", "types.ts"), "utf8");
const tabs = fs.readFileSync(path.join(repoRoot, "src", "components", "GameTabs.tsx"), "utf8");
const nav = fs.readFileSync(path.join(repoRoot, "src", "components", "GameNav.tsx"), "utf8");
const demo = fs.readFileSync(path.join(repoRoot, "src", "components", "BiteballDemo.tsx"), "utf8");
const styles = fs.readFileSync(path.join(repoRoot, "src", "app", "globals.css"), "utf8");

assert.match(types, /\| "biteball";/);
assert.match(nav, /\["biteball", "Biteball"\]/);
assert.match(tabs, /requestedMode === "biteball"/);
assert.match(tabs, /!runtime\.embedded && runtime\.mode === "biteball"/);
assert.doesNotMatch(tabs, /if \(runtime\.embedded && runtime\.mode === "biteball"/);
assert.match(demo, /selectBiteballAnswer\(\)/);
assert.match(demo, /status === "shaking" \|\| status === "revealing"/);
assert.match(demo, /question\.trim\(\)/);
assert.match(demo, /prefers-reduced-motion: reduce/);
assert.match(styles, /@keyframes biteball-shake/);
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
assert.doesNotMatch(demo, /fetch\(|localStorage|sessionStorage/);

console.log("Biteball verification passed.");
