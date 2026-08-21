import assert from "node:assert/strict";
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
assert.equal(gifMetadata.width, renderer.RNGDLE_DISCORD_WIDTH);
assert.equal(gifMetadata.pageHeight, renderer.RNGDLE_DISCORD_HEIGHT);
assert.equal(gifMetadata.delay.reduce((sum, delay) => sum + delay, 0), assets.durationMs);
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
const badgeFramePath = path.join(tempDir, "rngdle-badge-frame.png");
fs.writeFileSync(gifPath, assets.animation);
fs.writeFileSync(pngPath, assets.still);
fs.writeFileSync(leaderboardPath, await renderer.renderRngdleDiscordLeaderboard(leaderboard));
const leaderboardStyleReference = [
  ["Kippie Hagridstein", 26, 19, 4551163, null, 4742902, "mythic"],
  ["sundei", 27, 628315, 700727, 86, 1006722, "mythic"],
  ["139rerka", 26, 693141, 339717, null, 992402, "mythic"],
  ["Dini", 27, 777714, 416343, null, 761549, "mythic"],
  ["iteman", 26, 10005, 186603, null, 701218, "mythic"],
  ["Coconut (free Jadey)", 23, 446969, 353766, null, 682588, "mythic"],
  ["Wyay (official)", 24, 557788, 199038, null, 607792, "mythic"],
  ["regress", 24, 620156, 79568, 26, 461930, "anomaly"],
  ["Hueqi", 26, 692077, 89641, null, 447167, "anomaly"],
  ["Fixlation", 27, 773469, 142388, 58, 407094, "anomaly"],
].map(([displayName, rolls, bestNumber, bestEp, bestPenaltyPercent, totalEp, bestRarity], index) => ({
  userId: `legacy-${index}`,
  displayName,
  avatar: null,
  rolls,
  bestNumber,
  bestEp,
  bestPenaltyPercent,
  totalEp,
  bestRarity,
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
fs.writeFileSync(mythicProfilePath, await renderer.renderRngdleDiscordProfile({
  ...profile,
  displayName: "Mythic Theme Tester",
  top: { gameDay: "2026-08-16", result: mythicResult },
}));
const riskAsset = await renderer.renderRngdleRiskAnimation(37);
assert.equal(riskAsset.durationMs, 15000, "reroll risk selection should run for about fifteen seconds");
assert.equal(riskAsset.animation.subarray(0, 6).toString("ascii"), "GIF89a");
fs.writeFileSync(riskPath, riskAsset.animation);
const riskMetadata = await sharp(riskAsset.animation, { animated: true }).metadata();
assert.equal(riskMetadata.pages, 29);
assert.equal(riskMetadata.delay.reduce((sum, delay) => sum + delay, 0), 15000);
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
assert.equal(requests.length, 2, "animated roll must be replaced by a static result");
const animatedPayload = multipartPayload(requests[0]);
const finalPayload = multipartPayload(requests[1]);
for (const payload of [animatedPayload, finalPayload]) {
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  v2Container(payload);
  const buttons = v2Buttons(payload);
  assert.equal(buttons[0].label, "Leaderboard");
  assert.equal(buttons[0].style, 2);
  assert.equal(buttons[1].label, "My Profile");
  assert.equal(buttons[1].style, 1);
  assert.equal(buttons[2].style, 4);
  assert.equal(buttons[2].label, "Reroll 1-99% Risk");
  assert.match(buttons[2].custom_id, /^rngdle-reroll:v1:/);
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
assert.equal(requests.length, 2, "rerolls must show the risk animation before the final result");
const riskPayload = multipartPayload(requests[0]);
const rerolledPayload = multipartPayload(requests[1]);
assertV2Attachment(riskPayload, "rngdle-reroll-risk.gif");
assert.equal(v2Buttons(riskPayload).length, 0, "risk animation must not expose buttons while it is running");
assertV2Attachment(rerolledPayload, "rngdle-result.png");
assert.deepEqual(v2Buttons(rerolledPayload).map((button) => button.label), ["Replay", "Leaderboard", "My Profile"]);
assert.match(v2Buttons(rerolledPayload)[0].custom_id, /^rngdle-replay:v1:/);
assert.equal(v2Buttons(rerolledPayload).some((button) => button.label === "Reroll 1-99% Risk"), false);
assert.equal(v2Text(rerolledPayload), delivery.rngdleResultContent(reroll.roll, 2, 2, resultStats.newBadges, baseTime + 9 * 60 * 1000));
assert.match(v2Text(rerolledPayload), /^\*\*Reroll locked · -37% from [\d,]+ base points · [+-][\d,]+ points\*\*$/);
assert.deepEqual(delivery.parseRngdleReplayCustomId(delivery.rngdleReplayCustomId(dayOne, userA)), { gameDay: dayOne, userId: userA });
assert.equal(delivery.parseRngdleReplayCustomId("rngdle-replay:v1:bad"), null);

requests.length = 0;
await delivery.deliverRngdleProfile({
  applicationId: guildA,
  token: "rngdle-profile-test",
  profile,
});
assert.equal(multipartPayload(requests[0]).attachments[0].filename, "rngdle-profile.png");

await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

const commandSource = fs.readFileSync(path.join(repoRoot, "scripts", "register-discord-commands.mjs"), "utf8");
const routeSource = fs.readFileSync(path.join(repoRoot, "src", "app", "api", "discord", "interactions", "route.ts"), "utf8");
assert.match(commandSource, /name: "rngdle"[\s\S]*?name: "roll"[\s\S]*?name: "leaderboard"[\s\S]*?name: "user"[\s\S]*?name: "player"/);
assert.match(commandSource, /name: "rngdle"[\s\S]*?integration_types: \[0\][\s\S]*?contexts: \[0\]/);
assert.match(routeSource, /body\?\.data\?\.name === "rngdle"/);
assert.match(routeSource, /RNGDLE_REROLL_CUSTOM_ID_PREFIX/);
assert.match(routeSource, /RNGDLE_REPLAY_CUSTOM_ID_PREFIX/);
assert.match(routeSource, /RNGDLE_LEADERBOARD_BUTTON_ID/);
assert.match(routeSource, /RNGDLE_PROFILE_BUTTON_ID/);
assert.match(routeSource, /riskAnimationPercent: penalty/);
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
