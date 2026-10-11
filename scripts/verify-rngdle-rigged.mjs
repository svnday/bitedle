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
const PINNED_RISK_TARGET = "100000000000000004";
const EXACT_TARGET = "100000000000000005";
const EXACT_NUMBER = 742069;
const LIVE_CONFIG = [
  `${MYTHIC_TARGET}:mythic:2026-10-07`,
  `${TRASH_TARGET}:trash:2026-10-07:reroll`,
  `${PINNED_RISK_TARGET}:trash:2026-10-11:reroll=97`,
  `${EXACT_TARGET}:=${EXACT_NUMBER}:2026-10-11:reroll=93`,
].join(",");
const GUILD = "111222333444555666";
const OTHER_GUILD = "777888999000111222";

// --- Configuration parsing -------------------------------------------------
{
  const rigged = loadRigged(LIVE_CONFIG);
  assert.deepEqual(rigged.riggedRngdleRollFor(MYTHIC_TARGET), {
    userId: MYTHIC_TARGET, band: "mythic", exactNumber: null,
    armedFrom: "2026-10-07", rigReroll: false, rerollPenalty: null,
  });
  assert.deepEqual(rigged.riggedRngdleRollFor(TRASH_TARGET), {
    userId: TRASH_TARGET, band: "trash", exactNumber: null,
    armedFrom: "2026-10-07", rigReroll: true, rerollPenalty: null,
  });
  // `reroll=NN` arms the reroll and pins the risk it draws.
  assert.deepEqual(rigged.riggedRngdleRollFor(PINNED_RISK_TARGET), {
    userId: PINNED_RISK_TARGET, band: "trash", exactNumber: null,
    armedFrom: "2026-10-11", rigReroll: true, rerollPenalty: 97,
  });
  // `=N` in the band's place names the number itself, and leaves no band.
  assert.deepEqual(rigged.riggedRngdleRollFor(EXACT_TARGET), {
    userId: EXACT_TARGET, band: null, exactNumber: EXACT_NUMBER,
    armedFrom: "2026-10-11", rigReroll: true, rerollPenalty: 93,
  });

  // The range ends are both legal numbers, and nothing beyond them is.
  const edges = loadRigged([
    `${MYTHIC_TARGET}:=0:2026-10-11`,
    `${TRASH_TARGET}:=1000000:2026-10-11`,
  ].join(","));
  assert.equal(edges.riggedRngdleRollFor(MYTHIC_TARGET).exactNumber, 0);
  assert.equal(edges.riggedRngdleRollFor(TRASH_TARGET).exactNumber, 1_000_000);

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
  `${MYTHIC_TARGET}:mythic:2026-10-07:reroll=`,    // risk promised, none given
  `${MYTHIC_TARGET}:mythic:2026-10-07:reroll=0`,   // below the honest 1-99 draw
  `${MYTHIC_TARGET}:mythic:2026-10-07:reroll=100`, // above it
  `${MYTHIC_TARGET}:mythic:2026-10-07:reroll=97%`, // not a bare number
  `${MYTHIC_TARGET}:mythic:2026-10-07:reroll=1.5`, // nor a fractional one
  `${MYTHIC_TARGET}:mythic:2026-10-07:reroll:97`,  // risk is one flag, not two
  `${MYTHIC_TARGET}:=1000001:2026-10-11`,    // one past the top of the range
  `${MYTHIC_TARGET}:=9999999:2026-10-11`,    // and well past it
  `${MYTHIC_TARGET}:=:2026-10-11`,           // number promised, none given
  `${MYTHIC_TARGET}:=-1:2026-10-11`,         // no negatives
  `${MYTHIC_TARGET}:=742069.5:2026-10-11`,   // nor fractions
  `${MYTHIC_TARGET}:742069:2026-10-11`,      // the `=` is not optional
  `${MYTHIC_TARGET}:=mythic:2026-10-11`,     // and a band is not a number
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

  const penaltyFor = (userId) => rigged.riggedRngdleRerollPenalty(rigged.riggedRngdleRollFor(userId));
  assert.equal(penaltyFor(TRASH_TARGET), 99, "trash defaults to the maximum loss");
  assert.equal(penaltyFor(MYTHIC_TARGET), 1, "mythic defaults to the minimum loss");
  // A pinned risk wins over the band default, which is the whole point of it.
  assert.equal(penaltyFor(PINNED_RISK_TARGET), 97, "a pinned risk is used as written");
  // Every one of them is a value the honest 1-99 draw also produces, so the risk
  // animation shows nothing a player could not have drawn themselves.
  for (const userId of [TRASH_TARGET, MYTHIC_TARGET, PINNED_RISK_TARGET]) {
    const penalty = penaltyFor(userId);
    assert.equal(penalty, scoring.selectRngdlePenalty(() => penalty - 1));
  }

  // A trash rig at a pinned 97%: still trash on the number the card prints, and
  // still a varied draw rather than a recognisable value.
  const pinnedDraws = new Set();
  for (let i = 0; i < 200; i += 1) {
    const number = rigged.selectRngdleNumberInBand("trash", 97);
    const result = scoring.scoreRngdleNumber(number, 97);
    assert.equal(result.rarity, "trash", `${number} at 97% must stay trash`);
    assert.equal(result.penaltyPercent, 97);
    pinnedDraws.add(number);
  }
  assert.ok(pinnedDraws.size > 190, `97% draws must vary (${pinnedDraws.size} distinct of 200)`);

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

// --- An exact-number rig hands over exactly that number --------------------
{
  const rigged = loadRigged(LIVE_CONFIG);
  const exactRig = rigged.riggedRngdleRollFor(EXACT_TARGET);

  // Every call, at any risk, with no randomness consulted at all.
  for (const penalty of [null, 1, 50, 93, 99]) {
    assert.equal(
      rigged.riggedRngdleNumber(exactRig, penalty, () => {
        throw new Error("an exact-number rig must not draw");
      }),
      EXACT_NUMBER,
    );
  }

  // The number is the number whatever the risk does to its EP: only the
  // credited value moves, and the card still prints 742069.
  const full = scoring.scoreRngdleNumber(EXACT_NUMBER);
  const taxed = scoring.scoreRngdleNumber(EXACT_NUMBER, 93);
  assert.equal(taxed.number, EXACT_NUMBER);
  assert.equal(taxed.rawEp, full.rawEp, "the risk never touches raw EP");
  assert.equal(taxed.creditedEp, Math.floor((full.rawEp * 7) / 100));
  assert.equal(taxed.penaltyPercent, 93);
  assert.deepEqual(taxed.badges, full.badges, "nor the badges the number carries");

  // A band rig still resolves through the same door, by drawing.
  const bandRig = rigged.riggedRngdleRollFor(MYTHIC_TARGET);
  assert.equal(rigged.riggedRngdleNumber(bandRig, null, () => 69), 69);

  // An exact rig needs no `reroll=NN` to be servable: with a bare `:reroll` it
  // keeps as much of its own EP as the honest draw allows.
  const bare = loadRigged(`${EXACT_TARGET}:=${EXACT_NUMBER}:2026-10-11:reroll`);
  assert.equal(bare.riggedRngdleRerollPenalty(bare.riggedRngdleRollFor(EXACT_TARGET)), 1);

  // This is the reason to reach for this form at a steep risk. A *band* at 93%
  // is served by whatever numbers still score there afterwards - only 456 of
  // the million for mythic, 89 at 99% - so the draw-and-reject loop usually
  // runs dry and falls through to the exhaustive sweep, which costs ~50s. An
  // exact number is handed over in constant time at any risk, as asserted
  // above. (Deliberately not exercised here: the assertion would be the slow
  // path itself.)
  assert.equal(
    rigged.riggedRngdleNumber(rigged.riggedRngdleRollFor(EXACT_TARGET), 93),
    EXACT_NUMBER,
  );
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
    const number = rig ? rigged.riggedRngdleNumber(rig) : scoring.selectRngdleNumber();
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
  const rerollPenalty = rigged.riggedRngdleRerollPenalty(rerollRig);
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

  // The pinned-risk rig: trash on the roll, trash again on the reroll, and the
  // 97% loss its entry asked for on the risk animation.
  const pinnedRoll = await rollAs(PINNED_RISK_TARGET, "2026-10-11");
  assert.ok(pinnedRoll.rig, "the pinned-risk rig must fire on its armed day");
  assert.equal(pinnedRoll.result.rarity, "trash");
  const pinnedRerollRig = await armed(PINNED_RISK_TARGET, "2026-10-11");
  assert.ok(pinnedRerollRig?.rigReroll, "its reroll must be covered too");
  const pinnedPenalty = rigged.riggedRngdleRerollPenalty(pinnedRerollRig);
  assert.equal(pinnedPenalty, 97);
  const pinnedReroll = scoring.scoreRngdleNumber(
    rigged.selectRngdleNumberInBand(pinnedRerollRig.band, pinnedPenalty), pinnedPenalty,
  );
  assert.equal(pinnedReroll.rarity, "trash", "the pinned-risk reroll must stay trash");
  assert.equal(pinnedReroll.penaltyPercent, 97, "and must take the 97% risk");
  assert.equal(await armed(PINNED_RISK_TARGET, "2026-10-12"), null, "then it is spent");

  // An exact-number rig armed on a day the target has *already* rolled: the
  // roll it fires on is that one, so the rig still covers the day's reroll.
  // This is the "already rolled, about to reroll" case the route has to serve.
  const exactPre = await rollAs(EXACT_TARGET, "2026-10-11");
  assert.equal(exactPre.rig?.exactNumber, EXACT_NUMBER,
    "the rig must still be live on the day of an existing roll");
  const exactRerollRig = await armed(EXACT_TARGET, "2026-10-11");
  assert.ok(exactRerollRig, "the reroll after an existing roll must still be covered");
  const exactPenalty = rigged.riggedRngdleRerollPenalty(exactRerollRig);
  assert.equal(exactPenalty, 93);
  const exactReroll = scoring.scoreRngdleNumber(
    rigged.riggedRngdleNumber(exactRerollRig, exactPenalty), exactPenalty,
  );
  assert.equal(exactReroll.number, EXACT_NUMBER, "the reroll must print the chosen number");
  assert.equal(exactReroll.penaltyPercent, 93, "at the chosen risk");
  assert.equal(await armed(EXACT_TARGET, "2026-10-12"), null, "and then it is spent");

  // An unrigged player is never touched, on any day.
  for (const day of ["2026-10-07", "2026-10-08", "2026-11-01"]) {
    assert.equal(await armed(UNRIGGED, day), null);
  }
}

fs.rmSync(tempDir, { recursive: true, force: true });
console.log("RNGDLE rigged-roll verification passed.");
