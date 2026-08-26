import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import Module, { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bitedle-rngdle-discord-"));
const compileDir = path.join(tempDir, "compiled");
const tsconfigPath = path.join(tempDir, "tsconfig.json");
const localDbPath = path.join(tempDir, "rolls.json");

fs.writeFileSync(tsconfigPath, JSON.stringify({
  compilerOptions: {
    target: "ES2020",
    module: "CommonJS",
    moduleResolution: "Node",
    jsx: "react-jsx",
    strict: true,
    allowJs: true,
    checkJs: false,
    esModuleInterop: true,
    skipLibCheck: true,
    outDir: compileDir,
    rootDir: path.join(repoRoot, "src", "lib"),
    typeRoots: [path.join(repoRoot, "node_modules", "@types")],
    types: ["node", "react"],
  },
  files: [
    path.join(repoRoot, "src", "lib", "rngdle", "types.ts"),
    path.join(repoRoot, "src", "lib", "rngdle", "probabilities.gen.js"),
    path.join(repoRoot, "src", "lib", "rngdle", "reference-engine.js"),
    path.join(repoRoot, "src", "lib", "rngdle", "scoring.ts"),
    path.join(repoRoot, "src", "lib", "rngdle", "reveal.ts"),
    path.join(repoRoot, "src", "lib", "rngdle", "time.ts"),
    path.join(repoRoot, "src", "lib", "rngdle-discord-store.ts"),
    path.join(repoRoot, "src", "lib", "rngdle-discord-renderer.tsx"),
    path.join(repoRoot, "src", "lib", "rngdle-discord.ts"),
  ],
}, null, 2));

const compile = spawnSync(process.execPath, [
  path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"), "-p", tsconfigPath,
], { cwd: repoRoot, encoding: "utf8" });
assert.equal(compile.status, 0, `${compile.stdout}\n${compile.stderr}`);

process.env.NODE_PATH = path.join(repoRoot, "node_modules");
Module._initPaths();
process.env.NODE_ENV = "test";
process.env.BITEDLE_RNGDLE_FILE_DB_PATH = localDbPath;
process.env.BITEDLE_RNGDLE_FINAL_EDIT_DELAY_MS = "0";

const require = createRequire(import.meta.url);

// Every suite here runs against the FileStore, so the Neon repository has never
// been executed by a test - which is how a hardcoded reroll window once shipped.
// Stubbing the driver lets its query path be exercised without a database. No
// test wants the real driver; if one ever does, it must load before this point.
const neonStatements = [];
let neonTableExists = false;
let neonDailyRows = [];
const neonModuleId = require.resolve("@neondatabase/serverless");
require.cache[neonModuleId] = {
  id: neonModuleId,
  filename: neonModuleId,
  loaded: true,
  exports: {
    neon: () => (strings) => {
      const text = strings.join("?").replace(/\s+/g, " ").trim();
      neonStatements.push(text);
      if (/^CREATE TABLE/i.test(text)) { neonTableExists = true; return Promise.resolve([]); }
      if (/^CREATE INDEX/i.test(text)) return Promise.resolve([]);
      if (!neonTableExists) {
        return Promise.reject(Object.assign(new Error('relation "rngdle_rolls" does not exist'), { code: "42P01" }));
      }
      // Postgres hands numerics back as strings over the wire, and a missing
      // penalty as NULL. The daily projection is recognisable by its badge
      // count, and returning a row for it is what exercises the mapping.
      if (text.includes("jsonb_array_length(current_result")) return Promise.resolve(neonDailyRows);
      return Promise.resolve([]);
    },
  },
};

const sharp = require("sharp");
const scoring = require(path.join(compileDir, "rngdle", "scoring.js"));
const storeModule = require(path.join(compileDir, "rngdle-discord-store.js"));
const renderer = require(path.join(compileDir, "rngdle-discord-renderer.js"));
const delivery = require(path.join(compileDir, "rngdle-discord.js"));

const guildA = "500000000000000001";
const guildB = "500000000000000002";
const userA = "600000000000000001";
const userB = "600000000000000002";
const dayOne = "2026-08-20";
const baseTime = Date.parse("2026-08-21T00:00:00.000Z");
const repository = new storeModule.FileRngdleDiscordRepository(localDbPath);
const firstResult = scoring.scoreRngdleNumber(569354);
const secondResult = scoring.scoreRngdleNumber(563190);

function roll(overrides = {}) {
  return {
    guildId: guildA,
    userId: userA,
    displayName: "RNG Tester",
    avatar: null,
    gameDay: dayOne,
    initial: firstResult,
    current: firstResult,
    initialRolledAt: baseTime,
    rerolledAt: null,
    ...overrides,
  };
}

const firstCreate = await repository.createInitial(roll());
assert.equal(firstCreate.created, true);
const duplicate = await repository.createInitial(roll({ initial: secondResult, current: secondResult }));
assert.equal(duplicate.created, false, "one initial roll per guild/user/game day");
assert.equal(duplicate.roll.current.number, firstResult.number);
await repository.createInitial(roll({ userId: userB, displayName: "Second Player", initial: secondResult, current: secondResult }));
await repository.createInitial(roll({ guildId: guildB }));
let standings = await repository.dailyStandings(guildA, dayOne);
assert.equal(standings.length, 2);
assert.equal(standings.some((entry) => entry.userId === userA), true);
assert.equal((await repository.dailyStandings(guildB, dayOne)).length, 1, "daily ranks are guild-isolated");

const rerolledResult = scoring.scoreRngdleNumber(491955, 37);
const reroll = await repository.reroll({
  guildId: guildA, userId: userA, gameDay: dayOne,
  displayName: "RNG Tester", avatar: null, result: rerolledResult,
  now: baseTime + 9 * 60 * 1000,
});
assert.equal(reroll.status, "updated");
assert.equal(reroll.roll.current.penaltyPercent, 37);
assert.equal(reroll.roll.current.creditedEp, Math.floor(reroll.roll.current.rawEp * 0.63));
assert.equal((await repository.reroll({
  guildId: guildA, userId: userA, gameDay: dayOne,
  displayName: "RNG Tester", avatar: null, result: secondResult, now: baseTime + 9 * 60 * 1000,
})).status, "already-used", "the reroll is one-time and atomic");

await repository.createInitial(roll({ gameDay: "2026-08-21", initialRolledAt: baseTime + 86400000 }));
const leaderboard = await repository.leaderboard(guildA);
const leaderA = leaderboard.find((entry) => entry.userId === userA);
assert.ok(leaderA);
assert.equal(leaderA.rolls, 2);
assert.equal(leaderA.totalEp, rerolledResult.creditedEp + firstResult.creditedEp);
assert.equal(leaderA.bestEp, Math.max(rerolledResult.creditedEp, firstResult.creditedEp));
assert.equal(leaderA.bestRarity, leaderA.bestEp === firstResult.creditedEp ? firstResult.rarity : rerolledResult.rarity);
assert.equal(leaderA.worstEp, Math.min(rerolledResult.creditedEp, firstResult.creditedEp));
assert.equal(leaderA.worstNumber, leaderA.worstEp === firstResult.creditedEp ? firstResult.number : rerolledResult.number);
assert.equal(
  leaderA.worstPenaltyPercent,
  leaderA.worstEp === firstResult.creditedEp ? firstResult.penaltyPercent : rerolledResult.penaltyPercent,
  "the penalty must follow its own roll, not the best one",
);
assert.ok(leaderA.worstEp < leaderA.bestEp, "the two ends of this career must not be the same roll");
assert.equal((await repository.leaderboard(guildB)).length, 1, "historical leaderboard is guild-isolated");

const profile = await repository.userProfile(guildA, userA, "2026-08-21");
assert.ok(profile);
assert.equal(profile.games, 2);
assert.equal(profile.currentStreak, 2);
assert.equal(profile.careerEp, leaderA.totalEp);
assert.equal(profile.allTimeRank, leaderboard.findIndex((entry) => entry.userId === userA) + 1);
assert.equal(profile.totalPlayers, leaderboard.length);
assert.equal(profile.today.result.number, firstResult.number);
assert.equal(profile.rerollDeltaEp, rerolledResult.creditedEp - firstResult.creditedEp);
assert.ok(profile.uniqueBadges > 0);
assert.ok(profile.rarestBadges.length > 0);
assert.equal(profile.todayNewBadges, firstResult.badges.filter((badge) => (
  !rerolledResult.badges.some((olderBadge) => olderBadge.id === badge.id)
)).length);

const resultStats = {
  gameDay: "2026-08-21",
  nextResetAt: baseTime + 2 * 86400000,
  now: baseTime + 86400000,
  currentStreak: profile.currentStreak,
  careerEp: profile.careerEp,
  newBadges: profile.todayNewBadges,
  rerollDeltaEp: null,
};

const assets = await renderer.renderRngdleDiscordAssets(firstResult, "RNG Tester", 1, 2, resultStats);
assert.equal(assets.animation.subarray(0, 6).toString("ascii"), "GIF89a");
assert.deepEqual([...assets.still.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
assert.ok(assets.durationMs >= 10000, "the number and badges need a readable sequential reveal");
const gifMetadata = await sharp(assets.animation, { animated: true }).metadata();
assert.ok(
  (gifMetadata.pages ?? 0) > firstResult.badges.length,
  "the GIF must retain the sequential badge frames plus the number reel",
);
assert.equal(gifMetadata.width, renderer.GIF_WIDTH);
assert.equal(gifMetadata.pageHeight, renderer.GIF_HEIGHT);
// The animation must keep the still's aspect ratio or the embed reflows when
// the GIF is replaced by the final card.
assert.equal(
  (renderer.GIF_WIDTH / renderer.GIF_HEIGHT).toFixed(3),
  (renderer.RNGDLE_DISCORD_RESULT_WIDTH / renderer.RNGDLE_DISCORD_RESULT_HEIGHT).toFixed(3),
);
assert.equal(gifMetadata.delay.reduce((sum, delay) => sum + delay, 0), assets.durationMs);
// The reveal plays more than once before it settles. Looping is what puts extra
// animation on screen without adding a frame, so nothing is paid in render time
// or download size. It must be a finite count: an infinite loop would encode as
// a Netscape count of 0 and the card would never settle at all.
assert.ok(assets.loops >= 2, "the reveal should replay before settling");
assert.equal(gifPlayCount(assets.animation), assets.loops, "encoded play count must match the reported one");
assert.notEqual(gifPlayCount(assets.animation), Infinity, "the reveal must stop, not loop forever");
assert.equal(gifMetadata.delay.slice(0, 10).every((delay) => delay === 120), true, "the reel should spin with smooth 120ms ticks");
const pngMetadata = await sharp(assets.still).metadata();
assert.deepEqual({ width: pngMetadata.width, height: pngMetadata.height }, {
  width: renderer.RNGDLE_DISCORD_RESULT_WIDTH,
  height: renderer.RNGDLE_DISCORD_RESULT_HEIGHT,
});
const gifPath = path.join(tempDir, renderer.RNGDLE_DISCORD_GIF_FILENAME);
const pngPath = path.join(tempDir, renderer.RNGDLE_DISCORD_PNG_FILENAME);
const leaderboardPath = path.join(tempDir, renderer.RNGDLE_DISCORD_LEADERBOARD_FILENAME);
const leaderboardStyleReferencePath = path.join(tempDir, "rngdle-leaderboard-style-reference.png");
const profilePath = path.join(tempDir, renderer.RNGDLE_DISCORD_PROFILE_FILENAME);
const commonResultPath = path.join(tempDir, "rngdle-result-common-reference.png");
const trashResultPath = path.join(tempDir, "rngdle-result-trash-reference.png");
const epicResultPath = path.join(tempDir, "rngdle-result-epic.png");
const mythicProfilePath = path.join(tempDir, "rngdle-profile-mythic.png");
const riskPath = path.join(tempDir, renderer.RNGDLE_DISCORD_RISK_GIF_FILENAME);
const riskFinalPath = path.join(tempDir, "rngdle-reroll-risk-final.png");
const dailyBoardPath = path.join(tempDir, "rngdle-daily-board.png");
const badgeFramePath = path.join(tempDir, "rngdle-badge-frame.png");
fs.writeFileSync(gifPath, assets.animation);
fs.writeFileSync(pngPath, assets.still);
fs.writeFileSync(leaderboardPath, await renderer.renderRngdleDiscordLeaderboard(leaderboard));
// The widest strings the board can be handed, so the reference image shows
// whether every column still fits: the longest names, a 9-digit rarest badge,
// and a worst roll whose EP and penalty are both present.
const leaderboardStyleReference = [
  ["Kippie Hagridstein", 26, 19, 4551163, null, 4742902, "mythic", 218043, 1204, null],
  ["sundei", 27, 628315, 700727, 86, 1006722, "mythic", 511390, 318, 74],
  ["139rerka", 26, 693141, 339717, null, 992402, "mythic", 104778, 2960, null],
  ["Dini", 27, 777714, 416343, null, 761549, "mythic", 350021, 1877, null],
  ["iteman", 26, 10005, 186603, null, 701218, "mythic", 660431, 903, 41],
  ["Coconut (free Jadey)", 23, 446969, 353766, null, 682588, "mythic", 128806, 2415, null],
  ["Wyay (official)", 24, 557788, 199038, null, 607792, "mythic", 903112, 640, 63],
  ["regress", 24, 620156, 79568, 26, 461930, "anomaly", 274509, 1188, null],
  ["Hueqi", 26, 692077, 89641, null, 447167, "anomaly", 480263, 2074, null],
  ["Fixlation", 27, 773469, 142388, 58, 407094, "anomaly", 615930, 355, 92],
].map(([displayName, rolls, bestNumber, bestEp, bestPenaltyPercent, totalEp, bestRarity,
  worstNumber, worstEp, worstPenaltyPercent], index) => ({
  userId: `legacy-${index}`,
  displayName,
  avatar: null,
  rolls,
  bestNumber,
  bestEp,
  bestPenaltyPercent,
  totalEp,
  bestRarity,
  worstNumber,
  worstEp,
  worstPenaltyPercent,
  rarestBadgeLabel: ["Very Very Nice", "Strobogrammatic", "Palindrome", "2 Consecutive Numbers Repeated", "Zipper",
    "Binary Soul", "Fibonacci Number", "Lucky Seven (Divisible)", "Feather", "Nice"][index],
  rarestBadgeEp: [100000100, 502513, 50025, 1659, 246914, 1538463, 3333337, 700, 2667, 2024][index],
}));
fs.writeFileSync(leaderboardStyleReferencePath, await renderer.renderRngdleDiscordLeaderboard(leaderboardStyleReference, 39));
fs.writeFileSync(profilePath, await renderer.renderRngdleDiscordProfile(profile));
const epicResult = scoring.scoreRngdleNumber(271394);
const mythicResult = scoring.scoreRngdleNumber(69);
const commonResult = scoring.scoreRngdleNumber(266143);
const trashResult = scoring.scoreRngdleNumber(219986, 71);
assert.equal(epicResult.rarity, "epic", "reference roll 271394 must exercise the Epic palette");
assert.equal(mythicResult.rarity, "mythic", "reference roll 69 must exercise the Mythic palette");
assert.deepEqual([commonResult.rarity, commonResult.creditedEp], ["common", 3159]);
assert.deepEqual([trashResult.rarity, trashResult.rawEp, trashResult.creditedEp], ["trash", 4290, 1244]);
fs.writeFileSync(commonResultPath, await renderer.renderRngdleDiscordStill(commonResult, "sundei", 1, 1, resultStats));
fs.writeFileSync(trashResultPath, await renderer.renderRngdleDiscordStill(trashResult, "SlyVII", 8, 8, {
  ...resultStats,
  careerEp: 11118,
  rerollDeltaEp: -6218,
}));
fs.writeFileSync(epicResultPath, await renderer.renderRngdleDiscordStill(epicResult, "Epic Tester", 2, 8, resultStats));

// A rerolled card states the roll twice - what it was worth before the risk and
// what it is worth after, either side of an arrow - because the drop is the part
// a player actually feels. 219986 falls COMMON -> TRASH at 71%, so it exercises
// both the tier arrow and the EP one.
assert.equal(scoring.classifyRngdleScore(trashResult.rawEp).label, "COMMON");
assert.equal(trashResult.rarityLabel, "TRASH");
const rendererSource = fs.readFileSync(path.join(repoRoot, "src", "lib", "rngdle-discord-renderer.tsx"), "utf8");
assert.match(rendererSource, /classifyRngdleScore\(result\.rawEp\)/, "the pre-penalty tier must be read off the pre-penalty EP");
assert.match(rendererSource, /DowngradeArrow/, "the was -> is arrow is drawn, not typed");

// The panel animates as one shared base plus a per-frame EP layer, and only the
// EP layer is re-rendered per frame. Put the counting total on the base by
// mistake and every settled frame freezes on whichever value the shared base
// happened to be built from - the reveal still "plays", so nothing about
// dimensions, duration or payloads notices. Count how many distinct renderings
// the EP row actually takes across the reveal.
{
  const pages = gifMetadata.pages ?? 1;
  const row = { left: 55, top: 340, width: 1090, height: 52 };
  const seen = new Set();
  for (let page = 0; page < pages; page += 1) {
    const strip = await sharp(assets.animation, { page })
      .extract(row)
      .raw()
      .toBuffer();
    seen.add(createHash("sha1").update(strip).digest("hex"));
  }
  assert.ok(
    seen.size >= 5,
    `the EP total must climb through the reveal, but its row takes only ${seen.size} distinct forms across ${pages} frames`,
  );
}

const riskAsset = await renderer.renderRngdleRiskAnimation(37);
assert.equal(riskAsset.animation.subarray(0, 6).toString("ascii"), "GIF89a");
fs.writeFileSync(riskPath, riskAsset.animation);
const riskMetadata = await sharp(riskAsset.animation, { animated: true }).metadata();
assert.equal(
  riskMetadata.delay.reduce((sum, delay) => sum + delay, 0),
  riskAsset.durationMs,
  "encoded risk duration must match the reported one",
);
assert.equal(
  riskMetadata.delay.every((delay) => delay % 10 === 0),
  true,
  "GIF delays are centiseconds, so every risk delay must be a multiple of 10",
);

// The readout is only believable if it is the dot's position. Rebuild the
// frames and assert the two can never disagree, that the sweep actually
// oscillates rather than marching once, and that it ends on the real penalty.
for (const target of [1, 37, 99]) {
  const sweep = renderer.rngdleRiskSweepForTest(target);
  for (const frame of sweep) {
    assert.equal(
      frame.percent,
      Math.min(99, Math.max(1, Math.round(1 + frame.position * 98))),
      `risk readout must equal its dot position (target ${target}%)`,
    );
    assert.ok(frame.position >= 0 && frame.position <= 1, "dot must stay on the track");
  }
  const last = sweep[sweep.length - 1];
  assert.equal(last.percent, target, "the sweep must land on the real penalty");
  assert.equal(last.locked, true, "the final risk frame must be the locked one");

  let reversals = 0;
  for (let i = 2; i < sweep.length; i += 1) {
    const before = sweep[i - 1].position - sweep[i - 2].position;
    const after = sweep[i].position - sweep[i - 1].position;
    if (before !== 0 && after !== 0 && Math.sign(before) !== Math.sign(after)) reversals += 1;
  }
  assert.ok(reversals >= 4, `the dot must sweep back and forth, saw ${reversals} reversals at ${target}%`);
}
await sharp(riskAsset.animation, { page: riskMetadata.pages - 1 }).png().toFile(riskFinalPath);
const profileMetadata = await sharp(profilePath).metadata();
assert.deepEqual({ width: profileMetadata.width, height: profileMetadata.height }, {
  width: renderer.RNGDLE_DISCORD_PROFILE_WIDTH,
  height: renderer.RNGDLE_DISCORD_PROFILE_HEIGHT,
});
const leaderboardMetadata = await sharp(leaderboardPath).metadata();
assert.deepEqual({ width: leaderboardMetadata.width, height: leaderboardMetadata.height }, {
  width: renderer.RNGDLE_DISCORD_LEADERBOARD_WIDTH,
  height: renderer.RNGDLE_DISCORD_LEADERBOARD_HEIGHT,
});
await sharp(assets.animation, { page: Math.max(0, Math.floor((gifMetadata.pages ?? 1) * 0.7)) })
  .png()
  .toFile(badgeFramePath);

const requests = [];
const server = http.createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    requests.push({
      method: request.method,
      url: request.url,
      contentType: request.headers["content-type"] ?? "",
      body: Buffer.concat(chunks),
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: "original-interaction-message" }));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
process.env.BITEDLE_DISCORD_API_BASE_URL = `http://127.0.0.1:${address.port}`;

function multipartPayload(request) {
  const boundary = /boundary=(.+)$/i.exec(request.contentType)?.[1];
  assert.ok(boundary);
  const body = request.body.toString("utf8");
  const nameIndex = body.indexOf('name="payload_json"');
  const valueStart = body.indexOf("\r\n\r\n", nameIndex) + 4;
  const valueEnd = body.indexOf(`\r\n--${boundary}`, valueStart);
  return JSON.parse(body.slice(valueStart, valueEnd));
}

function multipartFile(request, filename) {
  const boundary = /boundary=(.+)$/i.exec(request.contentType)?.[1];
  assert.ok(boundary);
  const CRLF = String.fromCharCode(13, 10);
  const body = request.body;
  const marker = body.indexOf(Buffer.from(`filename="${filename}"`));
  assert.ok(marker > 0, `${filename} must be in the multipart body`);
  const start = body.indexOf(Buffer.from(CRLF + CRLF), marker) + 4;
  const end = body.indexOf(Buffer.from(CRLF + "--" + boundary), start);
  return body.subarray(start, end);
}

/** Total plays encoded in the GIF: the Netscape block holds one fewer. */
function gifPlayCount(gif) {
  const marker = gif.indexOf(Buffer.from("NETSCAPE2.0"));
  if (marker < 0) return 1;
  return gif.readUInt16LE(marker + 13) === 0 ? Infinity : gif.readUInt16LE(marker + 13) + 1;
}

function v2Container(payload) {
  assert.equal(payload.flags, 32768);
  assert.equal(payload.content, null);
  assert.deepEqual(payload.embeds, []);
  assert.equal(payload.components[0].type, 17);
  return payload.components[0];
}

function v2Buttons(payload) {
  const actionRow = payload.components.find((component) => component.type === 1);
  return actionRow?.components ?? [];
}

function v2Text(payload) {
  return v2Container(payload).components
    .filter((component) => component.type === 10)
    .map((component) => component.content)
    .join("\n");
}

function assertV2Attachment(payload, filename) {
  const gallery = v2Container(payload).components.find((component) => component.type === 12);
  assert.equal(gallery.items[0].media.url, `attachment://${filename}`);
  assert.equal(payload.attachments[0].filename, filename);
}

const unrerolled = roll();
await delivery.deliverRngdleRoll({
  applicationId: guildA,
  token: "rngdle-delivery-test",
  roll: unrerolled,
  rank: 1,
  playerCount: 2,
  animate: true,
  stats: resultStats,
  now: () => baseTime + 1000,
  sleep: async () => {},
});
assert.equal(requests.length, 3, "roll flow must post opener, animation, then the static result");
assert.match(requests[0].contentType, /application\/json/, "the first edit must be the lightweight opener");
const openerPayload = JSON.parse(requests[0].body.toString("utf8"));
assert.match(v2Text(openerPayload), /is rolling…/);
assert.equal(v2Buttons(openerPayload).length, 0, "the opener must not carry buttons");
const animatedPayload = multipartPayload(requests[1]);
const finalPayload = multipartPayload(requests[2]);
for (const payload of [animatedPayload, finalPayload]) {
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  v2Container(payload);
  const buttons = v2Buttons(payload);
  assert.deepEqual(buttons.map((button) => button.label), ["Today", "Leaderboard", "My Profile", "Reroll 1-99% Risk"]);
  assert.equal(buttons[0].custom_id, "rngdle-today:v1");
  assert.equal(buttons[1].style, 2);
  assert.equal(buttons[2].style, 1);
  assert.equal(buttons[3].style, 4);
  assert.match(buttons[3].custom_id, /^rngdle-reroll:v1:/);
  assert.ok(buttons.length <= 5, "Discord allows five buttons to an action row");
}
// The container's accent stripe is up from the moment the message posts, well
// before the GIF reaches the number. It must not be the roll's rarity until the
// card on screen has settled, or a gold bar announces a mythic before a single
// digit lands. 569354 is common; the fixture only proves this if the two
// accents actually differ, which is asserted rather than assumed.
{
  const accentOf = (payload) => v2Container(payload).accent_color;
  assert.notEqual(accentOf(openerPayload), accentOf(finalPayload), "the pre-reveal accent must not be the result's");
  assert.equal(accentOf(openerPayload), accentOf(animatedPayload), "opener and reveal are both pre-reveal");
}
assertV2Attachment(animatedPayload, "rngdle-roll.gif");
assertV2Attachment(finalPayload, "rngdle-result.png");
assert.match(v2Text(finalPayload), /risk window closes <t:\d+:R>/);
assert.match(v2Text(finalPayload), /new badges discovered/);

requests.length = 0;
await delivery.deliverRngdleRoll({
  applicationId: guildA,
  token: "rngdle-reroll-test",
  roll: reroll.roll,
  rank: 2,
  playerCount: 2,
  animate: false,
  riskAnimationPercent: 37,
  renderRiskAnimation: async () => riskAsset,
  stats: { ...resultStats, rerollDeltaEp: rerolledResult.creditedEp - firstResult.creditedEp },
  now: () => baseTime + 9 * 60 * 1000,
});
assert.equal(requests.length, 3, "a reroll with no reveal GIF still posts opener, risk animation, then the final result");
assert.match(requests[0].contentType, /application\/json/, "the first reroll edit must be the lightweight opener");
const rerollOpenerPayload = JSON.parse(requests[0].body.toString("utf8"));
assert.match(v2Text(rerollOpenerPayload), /is rerolling…/);
assert.equal(v2Buttons(rerollOpenerPayload).length, 0, "the reroll opener must clear the buttons immediately");
const riskPayload = multipartPayload(requests[1]);
const rerolledPayload = multipartPayload(requests[2]);
assertV2Attachment(riskPayload, "rngdle-reroll-risk.gif");
assert.equal(v2Buttons(riskPayload).length, 0, "risk animation must not expose buttons while it is running");
assertV2Attachment(rerolledPayload, "rngdle-result.png");
assert.deepEqual(v2Buttons(rerolledPayload).map((button) => button.label), ["Replay", "Today", "Leaderboard", "My Profile"]);
assert.match(v2Buttons(rerolledPayload)[0].custom_id, /^rngdle-replay:v1:/);
assert.equal(v2Buttons(rerolledPayload).some((button) => button.label === "Reroll 1-99% Risk"), false);
assert.equal(v2Text(rerolledPayload), delivery.rngdleResultContent(reroll.roll, 2, 2, resultStats.newBadges, baseTime + 9 * 60 * 1000));
// The penalty and the swing against the first roll are different numbers, so
// the footer has to name both rather than stacking them and hoping.
assert.match(
  v2Text(rerolledPayload),
  /^\*\*Reroll locked · -37% \(-[\d,]+ EP\) from [\d,]+ base EP · [+-][\d,]+ EP vs first roll\*\*$/,
);
{
  const penaltyEp = rerolledResult.rawEp - rerolledResult.creditedEp;
  const swingEp = rerolledResult.creditedEp - firstResult.creditedEp;
  assert.notEqual(penaltyEp, Math.abs(swingEp), "fixture must keep the two figures distinct to be worth asserting");
  assert.match(v2Text(rerolledPayload), new RegExp(`\\(-${penaltyEp.toLocaleString("en-US")} EP\\)`));
  assert.match(v2Text(rerolledPayload), new RegExp(`${Math.abs(swingEp).toLocaleString("en-US")} EP vs first roll`));
}

// The reveal shows the new number at full value, so everything around it has to
// agree. Career EP and today's rank are both read after the reroll is committed
// and therefore already carry the penalised total - a player who knows what
// their career stood at a minute ago could read the loss straight off the
// reveal, before the risk animation had drawn a thing.
{
  const penalised = scoring.scoreRngdleNumber(752, 87);
  const fullValue = scoring.scoreRngdleNumber(752);
  assert.equal(penalised.creditedEp, 31_779);
  assert.equal(fullValue.creditedEp, 244_456);

  const careerBefore = 500_000;
  const committed = { ...resultStats, careerEp: careerBefore + penalised.creditedEp, rerollDeltaEp: -1_000 };
  const reveal = delivery.rngdleRevealStats(committed, penalised.creditedEp, fullValue.creditedEp);
  assert.equal(reveal.careerEp, careerBefore + fullValue.creditedEp, "career must read as if the risk took nothing");
  assert.notEqual(reveal.careerEp, committed.careerEp, "the committed total would give the outcome away");
  assert.equal(reveal.rerollDeltaEp, null, "there is no swing to report until the risk has run");
  assert.equal(reveal.currentStreak, committed.currentStreak, "everything else is left alone");

  // A player whose only roll is today: the reveal must show the full value, not
  // the penalised one, which is the starkest version of the same leak.
  const firstEver = delivery.rngdleRevealStats(
    { ...resultStats, careerEp: penalised.creditedEp },
    penalised.creditedEp,
    fullValue.creditedEp,
  );
  assert.equal(firstEver.careerEp, fullValue.creditedEp);

  // Rank, same idea: where the roll would sit before the risk took anything.
  const standings = [
    { userId: "rival-high", creditedEp: 900_000 },
    { userId: "me", creditedEp: penalised.creditedEp },
    { userId: "rival-mid", creditedEp: 100_000 },
    { userId: "rival-low", creditedEp: 1_000 },
  ];
  assert.equal(delivery.rngdleRevealRank(standings, "me", fullValue.creditedEp), 2, "244,456 is behind 900,000 but ahead of 100,000");
  assert.equal(delivery.rngdleRevealRank(standings, "me", 950_000), 1, "a full-value roll that leads must show first");
  assert.equal(delivery.rngdleRevealRank(standings, "me", 500), 4);
  assert.equal(delivery.rngdleRevealRank([], "me", 10), 1, "an empty board still ranks first");

  // The helpers being right is only half of it - delivery has to actually use
  // them for the reveal, and the route has to supply the pre-risk rank.
  const deliverySource = fs.readFileSync(path.join(repoRoot, "src", "lib", "rngdle-discord.ts"), "utf8");
  assert.match(deliverySource, /revealStats = isReroll[\s\S]{0,120}rngdleRevealStats\(/);
  assert.match(deliverySource, /const revealRank = isReroll \? input\.revealRank \?\? input\.rank : input\.rank;/);
  assert.match(deliverySource, /renderRngdleDiscordAnimation\([\s\S]{0,80}revealRank,/, "the reveal must render at the pre-risk rank");
  const routeSourceForReveal = fs.readFileSync(path.join(repoRoot, "src", "app", "api", "discord", "interactions", "route.ts"), "utf8");
  assert.match(routeSourceForReveal, /revealRank: rngdleRevealRank\(standings, user\.id, outcome\.roll\.current\.rawEp\)/);
}

// The reroll plays as four beats: opener, the new number at full value, the
// risk drawn against it, then the settled card. 10,531 scores 9,817 EP (rare)
// and lands at 6,184 (uncommon) once 37% is taken off, so the container accent
// is proof of which result each phase was drawn from - a reveal rendered from
// the penalised score would already be wearing the uncommon accent.
const revealBase = scoring.scoreRngdleNumber(10531);
const revealPenalised = scoring.scoreRngdleNumber(10531, 37);
assert.equal(revealBase.rarity, "rare");
assert.equal(revealPenalised.rarity, "uncommon");

requests.length = 0;
const rerollSleeps = [];
// Holds collapse to zero under the delivery-timing override, so drop it here
// and record what delivery asks for instead. The sleep itself stays a no-op.
delete process.env.BITEDLE_RNGDLE_FINAL_EDIT_DELAY_MS;
await delivery.deliverRngdleRoll({
  applicationId: guildA,
  token: "rngdle-reroll-sequence-test",
  roll: roll({ current: revealPenalised, rerolledAt: baseTime + 9 * 60 * 1000 }),
  rank: 1,
  playerCount: 2,
  animate: true,
  riskAnimationPercent: 37,
  renderRiskAnimation: async () => riskAsset,
  stats: { ...resultStats, rerollDeltaEp: revealPenalised.creditedEp - firstResult.creditedEp },
  now: () => baseTime + 9 * 60 * 1000,
  sleep: async (milliseconds) => { rerollSleeps.push(milliseconds); },
});
process.env.BITEDLE_RNGDLE_FINAL_EDIT_DELAY_MS = "0";

assert.equal(requests.length, 4, "rerolls must post opener, the number reveal, the risk animation, then the result");
const sequenceOpener = JSON.parse(requests[0].body.toString("utf8"));
const revealPayload = multipartPayload(requests[1]);
const sequenceRiskPayload = multipartPayload(requests[2]);
const sequenceFinalPayload = multipartPayload(requests[3]);
assertV2Attachment(revealPayload, "rngdle-roll.gif");
assertV2Attachment(sequenceRiskPayload, "rngdle-reroll-risk.gif");
assertV2Attachment(sequenceFinalPayload, "rngdle-result.png");
assert.match(v2Text(revealPayload), /rerolled number is landing/);
assert.equal(v2Buttons(revealPayload).length, 0, "the reveal must not expose buttons mid-reroll");
assert.equal(v2Buttons(sequenceRiskPayload).length, 0, "risk animation must not expose buttons while it is running");

const accentOf = (payload) => v2Container(payload).accent_color;
assert.equal(accentOf(revealPayload), accentOf(sequenceOpener), "opener and reveal are both pre-reveal");
assert.notEqual(accentOf(revealPayload), accentOf(sequenceRiskPayload), "the accent stays neutral until the number lands");
assert.notEqual(accentOf(revealPayload), accentOf(sequenceFinalPayload));
// Once the reveal has played, the number and its pre-penalty tier are on
// screen, so the risk phase wears that tier - and only the post-penalty tier is
// still to come. rare -> uncommon, so those two accents must differ.
assert.notEqual(
  accentOf(sequenceRiskPayload),
  accentOf(sequenceFinalPayload),
  "the risk phase wears the unpenalised tier, the final card the penalised one",
);

// Playback, hold, playback, hold - the two holds are what let a player read the
// number before the risk starts, and the locked risk before the card settles.
assert.equal(rerollSleeps.length, 4, `expected reveal playback, hold, risk playback, hold; got ${rerollSleeps.join(", ")}`);
{
  // Read the reveal back off the wire: delivery has to sit through every pass,
  // or the final card lands on top of a GIF that is still playing.
  const revealGif = multipartFile(requests[1], "rngdle-roll.gif");
  const revealMeta = await sharp(revealGif, { animated: true }).metadata();
  const onePass = revealMeta.delay.reduce((sum, delay) => sum + delay, 0);
  const plays = gifPlayCount(revealGif);
  assert.ok(plays >= 2);
  assert.ok(
    rerollSleeps[0] >= onePass * plays,
    `delivery waited ${rerollSleeps[0]}ms for ${plays} plays of ${onePass}ms`,
  );
}
assert.ok(rerollSleeps[1] >= 1_000, "a hold must separate the number reveal from the risk animation");
assert.ok(rerollSleeps[2] >= riskAsset.durationMs, "the risk animation must play out before the card settles");
assert.ok(rerollSleeps[3] >= 1_000, "a hold must separate the locked risk from the final card");

assert.deepEqual(delivery.parseRngdleReplayCustomId(delivery.rngdleReplayCustomId(dayOne, userA)), { gameDay: dayOne, userId: userA });
assert.equal(delivery.parseRngdleReplayCustomId("rngdle-replay:v1:bad"), null);

requests.length = 0;
await delivery.deliverRngdleProfile({
  applicationId: guildA,
  token: "rngdle-profile-test",
  profile,
});
assert.equal(multipartPayload(requests[0]).attachments[0].filename, "rngdle-profile.png");

// Daily board delivery, while the stub webhook is still listening.
{
  requests.length = 0;
  await delivery.deliverRngdleDailyLeaderboard({
    applicationId: guildA,
    token: "rngdle-daily-test",
    standings,
    gameDay: dayOne,
    totalPlayers: 19,
  });
  assert.equal(requests.length, 1);
  const dailyPayload = multipartPayload(requests[0]);
  assert.match(dailyPayload.content, /RNGDLE today/);
  assert.match(dailyPayload.content, new RegExp(dayOne));
  assert.equal(dailyPayload.attachments[0].filename, "rngdle-leaderboard.png");

  // An empty day must say so rather than rendering a board of nothing.
  requests.length = 0;
  await delivery.deliverRngdleDailyLeaderboard({
    applicationId: guildA,
    token: "rngdle-daily-empty",
    standings: [],
    gameDay: dayOne,
  });
  assert.equal(requests.length, 1);
  assert.match(JSON.parse(requests[0].body.toString("utf8")).content, /No one has rolled RNGDLE yet today/);
}

await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

const commandSource = fs.readFileSync(path.join(repoRoot, "scripts", "register-discord-commands.mjs"), "utf8");
const routeSource = fs.readFileSync(path.join(repoRoot, "src", "app", "api", "discord", "interactions", "route.ts"), "utf8");
assert.match(commandSource, /name: "rngdle"[\s\S]*?name: "roll"[\s\S]*?name: "leaderboard"[\s\S]*?name: "user"[\s\S]*?name: "player"/);
assert.match(commandSource, /name: "rngdle"[\s\S]*?integration_types: \[0\][\s\S]*?contexts: \[0\]/);
// These suites drive the file-backed store, so the Neon SQL never runs here.
// A hardcoded reroll window in that UPDATE silently blocked every production
// reroll past ten minutes while every test stayed green, so assert on it.
// RNGDLE is played once a day, so nearly every interaction lands on a cold
// instance. Confirming the schema before the first query therefore cost three
// DDL round trips on almost every roll, not rarely. The query itself is the
// cheapest existence check there is, so it goes first and the schema is only
// built if Postgres says the table is missing.
{
  const repository = new storeModule.NeonRngdleDiscordRepository("postgres://stub");

  neonStatements.length = 0;
  await repository.getRoll("guild", "user", dayOne);
  assert.match(neonStatements[0], /^SELECT/, "the query must go first - no schema pre-flight");
  assert.match(neonStatements[1], /^CREATE TABLE/, "a missing table is built on the failure path");
  assert.match(neonStatements[4], /^SELECT/, "and the query is retried once it exists");
  assert.equal(neonStatements.length, 5);

  // Every suite above ran on the FileStore, so this projection had never been
  // executed. It is the half that reaches production.
  neonDailyRows = [
    { user_id: "a", display_name: "Rerolled", credited_ep: "1244", number: "219986",
      rarity: "trash", rarity_label: "TRASH", penalty_percent: "71", badge_count: "9",
      rarest_badge_label: "Blackjack", rarest_badge_desc: "Digits sum exactly to 21.", rarest_badge_ep: "2521" },
    { user_id: "b", display_name: "Clean", credited_ep: "5219", number: "569354",
      rarity: "common", rarity_label: "COMMON", penalty_percent: null, badge_count: "13",
      rarest_badge_label: null, rarest_badge_desc: null, rarest_badge_ep: null },
  ];
  const neonStandings = await repository.dailyStandings("guild", dayOne);
  assert.deepEqual(neonStandings.map((entry) => entry.displayName), ["Clean", "Rerolled"], "ordered by credited EP");
  assert.deepEqual(neonStandings.map((entry) => entry.rank), [1, 2]);
  assert.deepEqual(
    neonStandings.map((entry) => [entry.number, entry.rarityLabel, entry.penaltyPercent, entry.badgeCount]),
    [[569354, "COMMON", null, 13], [219986, "TRASH", 71, 9]],
    "Postgres strings must come back as numbers, and a missing penalty as null",
  );
  assert.deepEqual(
    neonStandings.map((entry) => [entry.rarestBadgeLabel, entry.rarestBadgeEp]),
    [[null, null], ["Blackjack", 2521]],
    "the badge EP is a bigint over the wire, and a badgeless roll must stay null",
  );
  neonDailyRows = [];

  // The case that actually matters: every request after the table exists.
  neonStatements.length = 0;
  await repository.getRoll("guild", "user", dayOne);
  await repository.dailyStandings("guild", dayOne);
  assert.equal(neonStatements.filter((text) => /^CREATE/i.test(text)).length, 0, "no DDL on the hot path");
  assert.equal(neonStatements.length, 2, "one round trip per query and nothing else");

  // Only undefined_table means "build the schema". Asserting the rejection is
  // not enough - a blanket retry rejects with the same error - so what is
  // checked is that no DDL was attempted in response to it.
  neonStatements.length = 0;
  require.cache[neonModuleId].exports.neon = () => (strings) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    neonStatements.push(text);
    if (/^CREATE/i.test(text)) return Promise.resolve([]);
    return Promise.reject(Object.assign(new Error("syntax error at or near"), { code: "42601" }));
  };
  await assert.rejects(
    () => new storeModule.NeonRngdleDiscordRepository("postgres://stub").getRoll("g", "u", dayOne),
    /syntax error/,
  );
  assert.deepEqual(
    neonStatements.filter((text) => /^CREATE/i.test(text)),
    [],
    "a non-42P01 failure must not be mistaken for a missing table",
  );
}

// The rarest-badge column has to be each player's own best badge ever, which is
// not the same as the badge on their best roll. 713579 scores 1,458,510 with a
// +1,449,277 badge; 0 taken at 99% risk scores less, 1,399,271, but carries Zero
// at +100,000,100. A column that tracked the best roll's badge would show
// Straight Flush here. It must show Zero.
{
  const boardGuild = "guild-rarest-badge";
  const highScore = scoring.scoreRngdleNumber(713579);
  const rareBadge = scoring.scoreRngdleNumber(0, 99);
  assert.ok(highScore.creditedEp > rareBadge.creditedEp, "the fixture must keep the better score off the rarer badge");
  assert.ok(rareBadge.badges[0].ep > highScore.badges[0].ep);

  for (const [gameDay, result] of [["2026-09-01", highScore], ["2026-09-02", rareBadge]]) {
    await repository.createInitial({
      guildId: boardGuild, userId: "player-one", displayName: "Player One", avatar: null,
      gameDay, initial: result, current: result, initialRolledAt: Date.parse(`${gameDay}T00:00:00Z`), rerolledAt: null,
    });
  }
  // A second player, so a leaked badge from someone else would be visible.
  const otherResult = scoring.scoreRngdleNumber(569354);
  await repository.createInitial({
    guildId: boardGuild, userId: "player-two", displayName: "Player Two", avatar: null,
    gameDay: "2026-09-01", initial: otherResult, current: otherResult,
    initialRolledAt: Date.parse("2026-09-01T00:00:00Z"), rerolledAt: null,
  });

  const board = await repository.leaderboard(boardGuild, 10);
  const one = board.find((entry) => entry.userId === "player-one");
  const two = board.find((entry) => entry.userId === "player-two");
  assert.ok(one && two);
  assert.equal(one.bestNumber, highScore.number, "best roll is still the highest-scoring one");
  assert.equal(one.worstNumber, rareBadge.number, "and the worst is the other end of the same pair");
  assert.equal(one.worstEp, rareBadge.creditedEp);
  assert.equal(two.worstEp, otherResult.creditedEp, "a single roll is a player's best and worst at once");
  assert.equal(one.rarestBadgeLabel, rareBadge.badges[0].label, "but the badge comes from the lower-scoring roll");
  assert.equal(one.rarestBadgeEp, rareBadge.badges[0].ep);
  assert.equal(one.rarestBadgeDesc, rareBadge.badges[0].desc, "the description must follow its own badge");
  assert.notEqual(one.rarestBadgeLabel, highScore.badges[0].label, "the best roll's badge must not win by default");

  // Per player, not per guild: Player Two keeps their own, far weaker badge.
  assert.equal(two.rarestBadgeLabel, otherResult.badges[0].label);
  assert.equal(two.rarestBadgeEp, otherResult.badges[0].ep);
  assert.ok(two.rarestBadgeEp < one.rarestBadgeEp, "one player's badge must not leak into another's row");

  // Separate array_agg calls over the same rows can disagree when the sort key
  // ties, pairing a label from one roll with an EP from another. Every ordering
  // in that query is made total with game_day, which is unique per player.
  const storeSourceForBoard = fs.readFileSync(path.join(repoRoot, "src", "lib", "rngdle-discord-store.ts"), "utf8");
  const leaderboardQuery = /async leaderboard\([\s\S]*?GROUP BY user_id/.exec(storeSourceForBoard)?.[0] ?? "";
  assert.ok(leaderboardQuery, "the Neon leaderboard query should be findable");
  const aggregates = leaderboardQuery.split("array_agg(").slice(1);
  assert.ok(aggregates.length >= 8, `expected every column to be aggregated, found ${aggregates.length}`);
  for (const aggregate of aggregates) {
    const clause = aggregate.slice(0, aggregate.indexOf("[1]"));
    assert.match(clause, /ORDER BY/);
    assert.match(clause, /game_day DESC/, `aggregate ordering without a tiebreaker: ${clause.slice(0, 90)}`);
  }
}

// The daily board reads the standings the game already computes for the rank on
// every card, so it costs no extra storage - but those rows had to carry more
// than an EP total to be worth showing. Both stores must agree on that shape.
{
  const standings = await repository.dailyStandings(guildA, dayOne);
  assert.ok(standings.length >= 2);
  const mine = standings.find((entry) => entry.userId === userA);
  assert.ok(mine, "the rerolled player must appear in the day's standings");
  assert.equal(mine.number, rerolledResult.number);
  assert.equal(mine.creditedEp, rerolledResult.creditedEp);
  assert.equal(mine.rarityLabel, rerolledResult.rarityLabel);
  assert.equal(mine.penaltyPercent, 37, "a rerolled row has to say so");
  assert.equal(mine.badgeCount, rerolledResult.badges.length);
  // The board shows the rarest badge, which is the roll's top-EP one: the
  // engine returns badges sorted by EP descending and the leader is always the
  // rarest that actually scored.
  assert.equal(mine.rarestBadgeLabel, rerolledResult.badges[0].label);
  assert.equal(mine.rarestBadgeEp, rerolledResult.badges[0].ep);
  // The board states the badge in its own words, as the roll card's chips do.
  assert.equal(mine.rarestBadgeDesc, rerolledResult.badges[0].desc);
  assert.ok(mine.rarestBadgeDesc.length > 0);
  assert.ok(
    rerolledResult.badges.every((badge) => badge.ep <= rerolledResult.badges[0].ep),
    "badges[0] must really be the highest-EP badge on the roll",
  );
  // Ranks come from the shared helper, so ties share a place rather than
  // being split by row order.
  assert.deepEqual(
    standings.map((entry) => entry.rank),
    [...standings].sort((a, b) => b.creditedEp - a.creditedEp).map((entry) => entry.rank),
    "standings must arrive already ordered by credited EP",
  );

  // One renderer serves both boards, so they cannot drift apart. Same canvas.
  const rendererSourceForBoards = fs.readFileSync(path.join(repoRoot, "src", "lib", "rngdle-discord-renderer.tsx"), "utf8");
  assert.match(rendererSourceForBoards, /rarestBadgeLabel/, "both boards must show the rarest badge");
  assert.doesNotMatch(rendererSourceForBoards, /GAMES`/, "the games count column is gone");
  // Every column is named in a header row, and each board names its own.
  for (const heading of ["PLAYER", "BEST ROLL", "RAREST BADGE EVER", "CAREER EP", "TODAY'S ROLL", "TODAY'S EP"]) {
    assert.ok(rendererSourceForBoards.includes(heading), `missing column heading: ${heading}`);
  }
  assert.match(rendererSourceForBoards, /board\.columns\.player/);
  assert.match(rendererSourceForBoards, /board\.columns\.badge/);

  const dailyImage = await renderer.renderRngdleDiscordDailyLeaderboard(standings, dayOne, 19);
  const dailyMeta = await sharp(dailyImage).metadata();
  assert.equal(dailyMeta.width, renderer.RNGDLE_DISCORD_LEADERBOARD_WIDTH);
  assert.equal(dailyMeta.height, renderer.RNGDLE_DISCORD_LEADERBOARD_HEIGHT);
  fs.writeFileSync(dailyBoardPath, dailyImage);

}

// /rngdle today has to be registered, or the subcommand the button shares a
// code path with cannot be reached by command at all.
assert.match(commandSource, /name: "today"/);
assert.match(routeSource, /subcommand === "today"/);
assert.match(routeSource, /RNGDLE_TODAY_BUTTON_ID/);

const storeSource = fs.readFileSync(path.join(repoRoot, "src", "lib", "rngdle-discord-store.ts"), "utf8");
const rerollUpdate = /UPDATE rngdle_rolls SET[\s\S]*?RETURNING \*/.exec(storeSource)?.[0] ?? "";
assert.ok(rerollUpdate, "the Neon reroll UPDATE should be findable");
assert.doesNotMatch(
  rerollUpdate,
  /initial_rolled_at\s*\+\s*\d/,
  "the reroll UPDATE must not restate the window as an offset from the roll time",
);
assert.match(
  rerollUpdate,
  /rngdleGameDayDeadline\(input\.gameDay\)/,
  "the reroll UPDATE must take its deadline from the shared game-day helper",
);

assert.match(routeSource, /body\?\.data\?\.name === "rngdle"/);
assert.match(routeSource, /RNGDLE_REROLL_CUSTOM_ID_PREFIX/);
assert.match(routeSource, /RNGDLE_REPLAY_CUSTOM_ID_PREFIX/);
assert.match(routeSource, /RNGDLE_LEADERBOARD_BUTTON_ID/);
assert.match(routeSource, /RNGDLE_PROFILE_BUTTON_ID/);
assert.match(routeSource, /riskAnimationPercent: penalty/);
// A reroll is irreversible, so the button must only ask - and it asks in a
// modal, which Discord shows to the presser alone. That privacy is the whole
// point of the change, so these pin the shape of the dialog and, just as
// importantly, that nothing about it lands on the public card.
{
  const gameDay = "2026-08-20";
  const player = "600000000000000001";
  const modal = delivery.rngdleRerollModal(gameDay, player);

  assert.match(modal.custom_id, /^rngdle-reroll-modal:v1:/);
  assert.deepEqual(
    delivery.parseRngdleRerollModalCustomId(modal.custom_id),
    { gameDay, userId: player },
    "the submit has to say whose reroll it is",
  );
  assert.ok(modal.title.length <= 45, "Discord caps a modal title at 45 characters");

  const warning = modal.components.find((component) => component.type === 10);
  assert.ok(warning, "the dialog must state the terms");
  for (const phrase of ["1-99% risk", "one reroll per day"]) {
    assert.ok(warning.content.includes(phrase), `the warning should mention ${phrase}`);
  }

  // Modals cannot hold buttons, so the gesture is a checkbox group Discord
  // refuses to submit until it is ticked. A plain checkbox cannot be required.
  const label = modal.components.find((component) => component.type === 18);
  assert.ok(label, "the confirming component must be wrapped in a Label");
  assert.ok(label.label.length <= 45, "Discord caps a Label at 45 characters");
  assert.ok(label.description.length <= 100, "Discord caps a Label description at 100 characters");
  assert.equal(label.component.type, 22, "a required tick needs a checkbox group, not a checkbox");
  assert.equal(label.component.required, true);
  assert.equal(label.component.custom_id, delivery.RNGDLE_REROLL_ACK_CUSTOM_ID);
  assert.equal(label.component.options.length, 1);

  // Buttons are not valid in a modal, and a container would make it a message.
  for (const component of modal.components) {
    assert.ok([10, 18].includes(component.type), `component type ${component.type} is not valid in a modal`);
  }

  // The submit is only honoured when the box actually came back ticked.
  const submitted = (values) => ({
    data: { components: [{ type: 18, component: { type: 22, custom_id: delivery.RNGDLE_REROLL_ACK_CUSTOM_ID, values } }] },
  });
  assert.equal(delivery.rngdleRerollAcknowledged(submitted(["reroll"])), true);
  assert.equal(delivery.rngdleRerollAcknowledged(submitted([])), false, "an unticked box must not reroll");
  assert.equal(delivery.rngdleRerollAcknowledged({ data: { components: [] } }), false);
  assert.equal(delivery.rngdleRerollAcknowledged({}), false);
}

// The confirmation must never touch the public card again.
assert.doesNotMatch(routeSource, /rngdleRerollConfirmUpdate|rngdleRerollCancelUpdate/);
assert.equal(typeof delivery.rngdleRerollConfirmUpdate, "undefined", "the in-channel confirmation is gone");
assert.equal(typeof delivery.rngdleRerollCancelUpdate, "undefined", "cancelling is closing the dialog now");
// Opening it is a MODAL response; the submit comes back as interaction type 5.
assert.match(routeSource, /type: 9, data: rngdleRerollModal\(/);
assert.match(routeSource, /body\?\.type === 5 && body\?\.data\?\.custom_id\?\.startsWith\(RNGDLE_REROLL_MODAL_CUSTOM_ID_PREFIX\)/);
// Skipping the guild_channels write keys off this, so type 5 has to be in it.
assert.match(routeSource, /if \(body\.type === 5\) return customId\.startsWith\(RNGDLE_REROLL_MODAL_CUSTOM_ID_PREFIX\)/);
// Cards posted before the change still carry the old confirm button.
assert.deepEqual(
  delivery.parseRngdleRerollOpenCustomId(`${delivery.RNGDLE_REROLL_LEGACY_CONFIRM_PREFIX}2026-08-20:600000000000000001`),
  { gameDay: "2026-08-20", userId: "600000000000000001" },
  "a stale confirm button must still open the dialog rather than reroll outright",
);
assert.deepEqual(
  delivery.parseRngdleRerollOpenCustomId(delivery.rngdleRerollCustomId("2026-08-20", "600000000000000001")),
  { gameDay: "2026-08-20", userId: "600000000000000001" },
);
assert.equal(delivery.parseRngdleRerollOpenCustomId("rngdle-reroll-no:v1:2026-08-20:1"), null);

assert.match(routeSource, /handleRngdleRerollConfirm/);
assert.match(routeSource, /handleRngdleReplay/);
assert.match(routeSource, /NextResponse\.json\(\{ type: 6 \}\)/);

console.log("RNGDLE Discord verification passed.");
console.log(`Rendered GIF: ${gifPath}`);
console.log(`Rendered badge frame: ${badgeFramePath}`);
console.log(`Rendered final still: ${pngPath}`);
console.log(`Rendered leaderboard: ${leaderboardPath}`);
console.log(`Rendered leaderboard style reference: ${leaderboardStyleReferencePath}`);
console.log(`Rendered profile: ${profilePath}`);
console.log(`Rendered Common reference result: ${commonResultPath}`);
console.log(`Rendered Trash reference result: ${trashResultPath}`);
console.log(`Rendered Epic result: ${epicResultPath}`);
console.log(`Rendered Mythic profile: ${mythicProfilePath}`);
console.log(`Rendered reroll risk GIF: ${riskPath}`);
console.log(`Rendered reroll risk final frame: ${riskFinalPath}`);
console.log(`Rendered daily board: ${dailyBoardPath}`);
