import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bitedle-rngdle-rigged-"));
const compileDir = path.join(tempDir, "compiled");
const tsconfigPath = path.join(tempDir, "tsconfig.json");

fs.writeFileSync(tsconfigPath, JSON.stringify({
  compilerOptions: {
    target: "ES2020", module: "CommonJS", moduleResolution: "Node", strict: true,
    allowJs: true, checkJs: false, esModuleInterop: true, skipLibCheck: true,
    outDir: compileDir, rootDir: path.join(repoRoot, "src", "lib"),
    typeRoots: [path.join(repoRoot, "node_modules", "@types")], types: ["node"],
  },
  files: [
    path.join(repoRoot, "src", "lib", "rngdle", "types.ts"),
    path.join(repoRoot, "src", "lib", "rngdle", "probabilities.gen.js"),
    path.join(repoRoot, "src", "lib", "rngdle", "reference-engine.js"),
    path.join(repoRoot, "src", "lib", "rngdle", "scoring.ts"),
    path.join(repoRoot, "src", "lib", "rngdle", "time.ts"),
    path.join(repoRoot, "src", "lib", "rngdle", "rigged.ts"),
    path.join(repoRoot, "src", "lib", "rngdle-discord-store.ts"),
  ],
}, null, 2));

const compile = spawnSync(process.execPath, [
  path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"), "-p", tsconfigPath,
], { cwd: repoRoot, encoding: "utf8" });
assert.equal(compile.status, 0, `${compile.stdout}\n${compile.stderr}`);

process.env.NODE_PATH = path.join(repoRoot, "node_modules");
Module._initPaths();
process.env.NODE_ENV = "test";

const require = createRequire(import.meta.url);
const riggedPath = path.join(compileDir, "rngdle", "rigged.js");
const scoring = require(path.join(compileDir, "rngdle", "scoring.js"));
const store = require(path.join(compileDir, "rngdle-discord-store.js"));

// rigged.js parses the env var once at module load, the same as it does on a
// cold serverless instance, so each configuration needs a fresh require.
function loadRigged(config) {
  if (config === null) delete process.env.RNGDLE_RIGGED_ROLLS;
  else process.env.RNGDLE_RIGGED_ROLLS = config;
  delete require.cache[riggedPath];
  return require(riggedPath);
}

const MYTHIC_TARGET = "100000000000000001";
const TRASH_TARGET = "100000000000000002";
const UNRIGGED = "100000000000000003";
const LIVE_CONFIG = `${MYTHIC_TARGET}:mythic:2026-10-07,${TRASH_TARGET}:trash:2026-10-07:reroll`;
const GUILD = "111222333444555666";
const OTHER_GUILD = "777888999000111222";

// --- Configuration parsing -------------------------------------------------
{
  const rigged = loadRigged(LIVE_CONFIG);
  assert.deepEqual(rigged.riggedRngdleRollFor(MYTHIC_TARGET), {
    userId: MYTHIC_TARGET, band: "mythic", armedFrom: "2026-10-07", rigReroll: false,
  });
  assert.deepEqual(rigged.riggedRngdleRollFor(TRASH_TARGET), {
    userId: TRASH_TARGET, band: "trash", armedFrom: "2026-10-07", rigReroll: true,
  });

  // Nobody else is touched, and a missing or odd id never throws.
  assert.equal(rigged.riggedRngdleRollFor(UNRIGGED), null);
  assert.equal(rigged.riggedRngdleRollFor(null), null);
  assert.equal(rigged.riggedRngdleRollFor(undefined), null);
  assert.equal(rigged.riggedRngdleRollFor(""), null);

  // Whitespace separates entries as well as commas.
  const spaced = loadRigged(`${MYTHIC_TARGET}:mythic:2026-10-07  ${TRASH_TARGET}:trash:2026-10-07`);
  assert.equal(spaced.riggedRngdleRollFor(MYTHIC_TARGET).band, "mythic");
  assert.equal(spaced.riggedRngdleRollFor(TRASH_TARGET).band, "trash");

  // Unset or empty rigs nobody, which is every other deployment.
  assert.equal(loadRigged(null).riggedRngdleRollFor(MYTHIC_TARGET), null);
  assert.equal(loadRigged("").riggedRngdleRollFor(MYTHIC_TARGET), null);
}

// --- Malformed entries are dropped, never half-applied ----------------------
for (const bad of [
  `${MYTHIC_TARGET}`,                        // no band, no day
  `${MYTHIC_TARGET}:mythic`,                 // no armed-from day
  `${MYTHIC_TARGET}:legendary:2026-10-07`,   // not a real band
  `${MYTHIC_TARGET}:mythic:10-07-2026`,      // wrong date order
  `${MYTHIC_TARGET}:mythic:2026-10-07:oops`, // unknown flag
  `${MYTHIC_TARGET}:MYTHIC:2026-10-07`,      // bands are lower case
  `not-an-id:mythic:2026-10-07`,             // not a snowflake
]) {
  assert.equal(loadRigged(bad).riggedRngdleRollFor(MYTHIC_TARGET), null, `must reject "${bad}"`);
}

// A malformed neighbour must not take a valid entry down with it.
assert.equal(
  loadRigged(`garbage:::,${TRASH_TARGET}:trash:2026-10-07:reroll`).riggedRngdleRollFor(TRASH_TARGET).band,
  "trash",
);

// --- Day coverage ----------------------------------------------------------
{
  const rigged = loadRigged(LIVE_CONFIG);
  const rig = rigged.riggedRngdleRollFor(MYTHIC_TARGET);
  assert.equal(rigged.rngdleRigCoversDay(rig, "2026-10-06"), false, "the day before must not fire");
  assert.equal(rigged.rngdleRigCoversDay(rig, "2026-10-07"), true, "the armed day fires");
  assert.equal(rigged.rngdleRigCoversDay(rig, "2026-11-02"), true, "a later month is still covered");
  assert.equal(rigged.rngdleRigCoversDay(rig, "2027-01-01"), true, "and so is a later year");
}

// --- The band draw lands in the band, every time ---------------------------
{
  const rigged = loadRigged(LIVE_CONFIG);
  for (const band of ["trash", "mythic"]) {
    const drawn = new Set();
    for (let i = 0; i < 300; i += 1) {
      const number = rigged.selectRngdleNumberInBand(band);
      assert.ok(Number.isSafeInteger(number) && number >= 0 && number <= 1_000_000);
      const result = scoring.scoreRngdleNumber(number);
      assert.equal(result.rarity, band, `${number} must score ${band}, got ${result.rarity}`);
      drawn.add(number);
    }
    // The whole point of drawing rather than hardcoding: no recognisable value.
    // 300 draws from a ~10k band collide rarely, so near-300 distinct results is
    // the signature of a real uniform draw.
    assert.ok(drawn.size > 280, `${band} draws must vary (${drawn.size} distinct of 300)`);
  }
}

// --- Rigged rerolls are judged on credited EP, after the penalty ------------
{
  const rigged = loadRigged(LIVE_CONFIG);

  assert.equal(rigged.riggedRngdleRerollPenalty("trash"), 99, "trash takes the maximum loss");
  assert.equal(rigged.riggedRngdleRerollPenalty("mythic"), 1, "mythic takes the minimum loss");
  // Both are values the honest 1-99 draw also produces, so the risk animation
  // shows nothing a player could not have drawn themselves.
  for (const band of ["trash", "mythic"]) {
    const penalty = rigged.riggedRngdleRerollPenalty(band);
    assert.equal(penalty, scoring.selectRngdlePenalty(() => penalty - 1));
  }

  // A trash rig's reroll: 99% risk, judged on what the card will actually print.
  for (let i = 0; i < 200; i += 1) {
    const number = rigged.selectRngdleNumberInBand("trash", 99);
    const result = scoring.scoreRngdleNumber(number, 99);
    assert.equal(result.rarity, "trash", `${number} at 99% must stay trash`);
    assert.equal(result.penaltyPercent, 99);
    assert.ok(result.creditedEp <= result.rawEp);
  }

  // A mythic rig would have to survive its own penalty, not just the full value.
  for (let i = 0; i < 50; i += 1) {
    const number = rigged.selectRngdleNumberInBand("mythic", 1);
    assert.equal(scoring.scoreRngdleNumber(number, 1).rarity, "mythic");
  }
}

// --- The draw honours an injected source, so callers can pin it -------------
{
  const rigged = loadRigged(LIVE_CONFIG);
  // A source that only ever offers 69 - a mythic - is taken on the first draw.
  assert.equal(rigged.selectRngdleNumberInBand("mythic", null, () => 69), 69);
  // Offered a common first and a mythic second, it must reject exactly once.
  const offers = [266143, 69];
  let index = 0;
  assert.equal(rigged.selectRngdleNumberInBand("mythic", null, () => offers[index++]), 69);
  assert.equal(index, 2, "the common offer must have been rejected");
}

// --- firstRollDaySince, the signal that makes a rig fire once ---------------
{
  const dbPath = path.join(tempDir, "rngdle-rigged.json");
  const repository = new store.FileRngdleDiscordRepository(dbPath);

  const roll = (gameDay, userId = TRASH_TARGET, guildId = GUILD) => {
    const result = scoring.scoreRngdleNumber(266143);
    return repository.createInitial({
      guildId, userId, gameDay, displayName: "Player", avatar: null,
      initial: result, current: result,
      initialRolledAt: Date.parse(`${gameDay}T23:30:00Z`), rerolledAt: null,
    });
  };

  // Armed with nothing rolled yet: unspent.
  assert.equal(await repository.firstRollDaySince(GUILD, TRASH_TARGET, "2026-10-07"), null);

  // A roll from before the armed day neither fires nor spends it.
  await roll("2026-10-05");
  assert.equal(await repository.firstRollDaySince(GUILD, TRASH_TARGET, "2026-10-07"), null,
    "an older roll must not consume the rig");

  // The roll that fires it reports itself as the first since arming.
  await roll("2026-10-09");
  assert.equal(await repository.firstRollDaySince(GUILD, TRASH_TARGET, "2026-10-07"), "2026-10-09");

  // Later rolls keep pointing at the day it fired, so it stays spent.
  await roll("2026-10-10");
  assert.equal(await repository.firstRollDaySince(GUILD, TRASH_TARGET, "2026-10-07"), "2026-10-09");

  // Other players and other guilds are unaffected.
  assert.equal(await repository.firstRollDaySince(GUILD, MYTHIC_TARGET, "2026-10-07"), null);
  assert.equal(await repository.firstRollDaySince(OTHER_GUILD, TRASH_TARGET, "2026-10-07"), null);
  await roll("2026-10-11", TRASH_TARGET, OTHER_GUILD);
  assert.equal(await repository.firstRollDaySince(OTHER_GUILD, TRASH_TARGET, "2026-10-07"), "2026-10-11");
  assert.equal(await repository.firstRollDaySince(GUILD, TRASH_TARGET, "2026-10-07"), "2026-10-09",
    "a roll in another guild must not move this guild's answer");

  // Comparing game days as text must behave as comparing them as dates.
  assert.equal(await repository.firstRollDaySince(GUILD, TRASH_TARGET, "2026-09-30"), "2026-10-05");
  assert.equal(await repository.firstRollDaySince(GUILD, TRASH_TARGET, "2027-01-01"), null);
}

// --- The lifecycle, resolved exactly as the route resolves it ---------------
{
  const rigged = loadRigged(LIVE_CONFIG);
  const repository = new store.FileRngdleDiscordRepository(path.join(tempDir, "rngdle-lifecycle.json"));

  // Mirrors armedRngdleRig in the interactions route.
  const armed = async (userId, gameDay) => {
    const rig = rigged.riggedRngdleRollFor(userId);
    if (!rig || !rigged.rngdleRigCoversDay(rig, gameDay)) return null;
    const firstRollDay = await repository.firstRollDaySince(GUILD, userId, rig.armedFrom);
    if (firstRollDay !== null && firstRollDay !== gameDay) return null;
    return rig;
  };

  const rollAs = async (userId, gameDay) => {
    const rig = await armed(userId, gameDay);
    const number = rig ? rigged.selectRngdleNumberInBand(rig.band) : scoring.selectRngdleNumber();
    const result = scoring.scoreRngdleNumber(number);
    await repository.createInitial({
      guildId: GUILD, userId, gameDay, displayName: userId, avatar: null,
      initial: result, current: result,
      initialRolledAt: Date.parse(`${gameDay}T23:30:00Z`), rerolledAt: null,
    });
    return { rig, result };
  };

  // Before the armed day: an ordinary roll that leaves the rig loaded.
  assert.equal((await rollAs(TRASH_TARGET, "2026-10-06")).rig, null,
    "a roll before the armed day must not be rigged");

  // The armed day: it fires.
  const fired = await rollAs(TRASH_TARGET, "2026-10-07");
  assert.ok(fired.rig, "the rig must fire on the armed day");
  assert.equal(fired.result.rarity, "trash");

  // Still inside that day, the reroll is covered - no escape hatch.
  const rerollRig = await armed(TRASH_TARGET, "2026-10-07");
  assert.ok(rerollRig?.rigReroll, "the reroll must still be covered on the day it fired");
  const rerollPenalty = rigged.riggedRngdleRerollPenalty(rerollRig.band);
  const rerolled = scoring.scoreRngdleNumber(
    rigged.selectRngdleNumberInBand(rerollRig.band, rerollPenalty), rerollPenalty,
  );
  assert.equal(rerolled.rarity, "trash", "the rigged reroll must stay trash");
  assert.equal(rerolled.penaltyPercent, 99, "and must take the 99% risk");

  // Every later day is honest again, entry left in place or not.
  for (const day of ["2026-10-08", "2026-10-09", "2026-11-01"]) {
    assert.equal(await armed(TRASH_TARGET, day), null, `${day} must be honest again`);
    assert.equal(await armed(TRASH_TARGET, day), null, `${day} must stay honest on re-check`);
  }

  // The two rigs are independent: this one is still loaded after the other fired.
  const secondRig = await rollAs(MYTHIC_TARGET, "2026-10-08");
  assert.ok(secondRig.rig, "the second rig fires on its own target's first roll since arming");
  assert.equal(secondRig.result.rarity, "mythic");
  assert.equal(secondRig.result.penaltyPercent, null, "an initial roll takes no penalty");
  assert.equal(await armed(MYTHIC_TARGET, "2026-10-09"), null, "and is spent afterwards");

  // An unrigged player is never touched, on any day.
  for (const day of ["2026-10-07", "2026-10-08", "2026-11-01"]) {
    assert.equal(await armed(UNRIGGED, day), null);
  }
}

fs.rmSync(tempDir, { recursive: true, force: true });
console.log("RNGDLE rigged-roll verification passed.");
