import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const verifyDistDir = ".next-verify-bitefight";
const verifyTsconfigName = `.tsconfig-bitefight-verify-${process.pid}.json`;
const verifyTsconfigPath = path.join(repoRoot, verifyTsconfigName);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bitedle-bitefight-"));
const dbPath = path.join(tempDir, "db.json");
const previewPath = path.join(tempDir, "bitefight-preview.png");
const finalPreviewPath = path.join(tempDir, "bitefight-rematch-preview.png");
const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}`;
const webhookRequests = [];
const webhook = await startWebhookServer(webhookRequests);
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const publicKeyHex = publicKey
  .export({ type: "spki", format: "der" })
  .subarray(-32)
  .toString("hex");

const guildId = "333333333333333333";
const channelId = "444444444444444444";
const appId = "555555555555555555";
const players = {
  alpha: identity("11111111-1111-4111-8111-111111111111", "111111111111111111", "Alpha"),
  beta: identity("22222222-2222-4222-8222-222222222222", "222222222222222222", "Beta"),
  sweeper: identity("33333333-3333-4333-8333-333333333333", "333333333333333333", "Sweeper"),
  knockout: identity("44444444-4444-4444-8444-444444444444", "444444444444444444", "Knockout"),
  target: identity("55555555-5555-4555-8555-555555555555", "555555555555555555", "Target"),
  timer: identity("66666666-6666-4666-8666-666666666666", "666666666666666666", "Timer"),
  behind: identity("77777777-7777-4777-8777-777777777777", "777777777777777777", "Behind"),
};
const knockoutId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const timeoutId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const expiredId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const now = Date.now();

fs.writeFileSync(
  verifyTsconfigPath,
  JSON.stringify({ extends: "./tsconfig.json" }, null, 2),
);
fs.writeFileSync(
  dbPath,
  JSON.stringify({
    users: Object.fromEntries(
      Object.values(players).map((player) => [
        player.userId,
        {
          name: player.name,
          named: true,
          createdAt: now,
          discordUserId: player.discordUserId,
          discordAvatar: null,
        },
      ]),
    ),
    games: {},
    launches: {},
    megaGames: {},
    biteracerGames: {},
    biteracerRaces: {},
    biteracerRaceLaunches: {},
    bitefights: {
      [knockoutId]: fightFixture({
        id: knockoutId,
        first: players.knockout,
        second: players.target,
        startedAt: now - 1_000,
        secondHealth: 1,
      }),
      [timeoutId]: fightFixture({
        id: timeoutId,
        first: players.timer,
        second: players.behind,
        startedAt: now - 5 * 60_000 - 1_000,
        firstHealth: 80,
        secondHealth: 62,
      }),
      [expiredId]: pendingFightFixture({
        id: expiredId,
        first: players.alpha,
        second: players.beta,
        createdAt: now - 60_001,
      }),
    },
    bitefightLaunches: {},
    bitesweeperLaunches: {},
    activityModes: {},
    launchIntents: {
      [players.sweeper.discordUserId]: {
        mode: "mega",
        viaEntryPoint: false,
        createdAt: now,
      },
    },
    activityUserModes: {},
    bitesweeperPresence: {},
    guildChannels: {},
  }),
);

let output = "";
const server = spawn(
  process.execPath,
  [path.join(repoRoot, "node_modules", "next", "dist", "bin", "next"), "dev"],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      BITEDLE_NEXT_DIST_DIR: verifyDistDir,
      BITEDLE_TSCONFIG_PATH: verifyTsconfigName,
      BITEDLE_FORCE_FILE_STORE: "1",
      BITEDLE_FILE_DB_PATH: dbPath,
      DISCORD_PUBLIC_KEY: publicKeyHex,
      BITEDLE_DISCORD_API_BASE_URL: webhook.baseUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
server.stdout.on("data", (chunk) => (output += chunk.toString()));
server.stderr.on("data", (chunk) => (output += chunk.toString()));

try {
  await waitForServer();

  const expiredAccept = await signedInteraction(
    buttonInteraction(`bitefight-join:${expiredId}`, players.beta),
  );
  const expiredPayload = await expiredAccept.json();
  assert.equal(expiredPayload.data.flags, 64);
  assert.match(expiredPayload.data.content, /challenge expired/i);
  const expiredState = await fightRequest(players.alpha, expiredId);
  assert.equal(expiredState.status, "expired");
  assert.ok(expiredState.finishedAt >= expiredState.createdAt + 60_000);
  assert.equal(
    (await modeRequest(players.beta, "expired-beta-instance")).mode,
    "classic",
    "an expired challenge must not create an Activity launch",
  );

  const timedOut = await fightRequest(players.timer, timeoutId);
  assert.equal(timedOut.status, "finished");
  assert.equal(timedOut.finishReason, "timeout");
  assert.equal(timedOut.winnerDiscordUserId, players.timer.discordUserId);

  const challenge = await signedInteraction({
    type: 2,
    data: {
      name: "bitefight",
      options: [{ name: "opponent", value: players.beta.discordUserId }],
      resolved: {
        users: {
          [players.beta.discordUserId]: {
            id: players.beta.discordUserId,
            username: players.beta.name,
            avatar: null,
          },
        },
      },
    },
    guild_id: guildId,
    channel_id: channelId,
    application_id: appId,
    token: "BITEFIGHT_VERIFY_TOKEN",
    member: {
      user: {
        id: players.alpha.discordUserId,
        username: players.alpha.name,
        avatar: null,
      },
    },
  });
  assert.equal(challenge.status, 200);
  const challengePayload = await challenge.json();
  assert.equal(challengePayload.type, 4);
  assert.deepEqual(challengePayload.data.allowed_mentions, {
    users: [players.beta.discordUserId],
  });
  const joinId = challengePayload.data.components[0].components[0].custom_id;
  const declineId = challengePayload.data.components[0].components[1].custom_id;
  assert.match(joinId, /^bitefight-join:/);
  assert.match(declineId, /^bitefight-decline:/);
  const fightId = joinId.slice("bitefight-join:".length);

  const outsiderJoin = await signedInteraction(buttonInteraction(joinId, players.sweeper));
  const outsiderPayload = await outsiderJoin.json();
  assert.equal(outsiderPayload.data.flags, 64);
  assert.match(outsiderPayload.data.content, /Only the two fighters/);

  const duplicate = await signedInteraction({
    type: 2,
    data: {
      name: "bitefight",
      options: [{ name: "opponent", value: players.sweeper.discordUserId }],
      resolved: {
        users: {
          [players.sweeper.discordUserId]: {
            id: players.sweeper.discordUserId,
            username: players.sweeper.name,
          },
        },
      },
    },
    guild_id: guildId,
    channel_id: channelId,
    application_id: appId,
    token: "DUPLICATE_TOKEN",
    member: { user: { id: players.alpha.discordUserId, username: players.alpha.name } },
  });
  const duplicatePayload = await duplicate.json();
  assert.match(duplicatePayload.data.content, /current Bitefight/);
  assert.equal(duplicatePayload.data.flags, 64);

  const accept = await signedInteraction(buttonInteraction(joinId, players.beta));
  assert.deepEqual(await accept.json(), { type: 12 });
  const challengerJoin = await signedInteraction(buttonInteraction(joinId, players.alpha));
  assert.deepEqual(await challengerJoin.json(), { type: 12 });

  assert.deepEqual(await modeRequest(players.alpha, "alpha-instance"), {
    mode: "bitefight",
    matchId: fightId,
  });
  assert.deepEqual(await modeRequest(players.beta, "beta-instance"), {
    mode: "bitefight",
    matchId: fightId,
  });
  const switchToSweeper = await signedInteraction({
    type: 2,
    data: { name: "bitesweeper" },
    guild_id: guildId,
    channel_id: channelId,
    application_id: appId,
    token: "BETA_SWITCH_TOKEN",
    member: { user: { id: players.beta.discordUserId, username: players.beta.name } },
  });
  assert.deepEqual(await switchToSweeper.json(), { type: 12 });
  assert.equal(
    (await modeRequest(players.beta, "beta-sweeper-instance")).mode,
    "mega",
    "a newer Bitesweeper command must supersede the caller's Bitefight marker",
  );
  const sweeperMode = await modeRequest(players.sweeper, "sweeper-instance");
  assert.equal(
    sweeperMode.mode,
    "mega",
    "a Bitefight launch must not hijack another player's Bitesweeper intent",
  );

  let state = await fightRequest(players.alpha, fightId, { action: "ready" });
  assert.equal(state.status, "accepted");
  assert.equal(state.startedAt, null, "one ready fighter must not begin the countdown");
  const earlyPunch = await fightFetch(players.alpha, fightId, {
    action: "punch",
    sequence: 1,
  });
  assert.equal(earlyPunch.status, 409, "punches before the shared start must be rejected");
  state = await fightRequest(players.beta, fightId, { action: "ready" });
  assert.equal(state.status, "countdown");
  assert.equal(state.startedAt - state.countdownAt, 3_000);
  await waitFor(
    () => Date.now() >= state.startedAt + 50,
    "three-second Bitefight countdown",
  );
  state = await fightRequest(players.alpha, fightId);
  assert.equal(state.status, "fighting");
  const invalidSequence = await fightFetch(players.alpha, fightId, {
    action: "punch",
    sequence: "not-a-number",
  });
  assert.equal(invalidSequence.status, 400);

  state = await fightRequest(players.alpha, fightId, {
    action: "punch",
    sequence: 1,
  });
  assert.equal(state.accepted, true);
  assert.equal(state.players[1].health, 99);

  state = await fightRequest(players.alpha, fightId, {
    action: "punch",
    sequence: 2,
  });
  assert.equal(state.accepted, true);
  assert.equal(state.players[1].health, 98);

  state = await fightRequest(players.alpha, fightId, {
    action: "punch",
    sequence: 2,
  });
  assert.equal(state.accepted, false, "duplicate click sequences must be idempotent");
  assert.equal(state.players[1].health, 98);

  state = await fightRequest(players.alpha, fightId, {
    action: "punch",
    sequence: 1,
  });
  assert.equal(state.accepted, false, "older click sequences must be ignored");
  assert.equal(state.players[1].health, 98);

  const [alphaConcurrent, betaConcurrent] = await Promise.all([
    fightRequest(players.alpha, fightId, { action: "punch", sequence: 3 }),
    fightRequest(players.beta, fightId, { action: "punch", sequence: 1 }),
  ]);
  const latestRevision = Math.max(alphaConcurrent.revision, betaConcurrent.revision);
  state = await fightRequest(players.alpha, fightId);
  assert.ok(state.revision >= latestRevision);
  assert.equal(state.players[0].health, 99, "Beta's simultaneous punch must survive CAS");
  assert.equal(state.players[1].health, 97, "Alpha's simultaneous punch must survive CAS");

  state = await fightRequest(players.alpha, fightId, {
    action: "punch",
    sequence: 3,
  });
  assert.equal(state.accepted, false, "duplicate sequence numbers must be idempotent");
  assert.equal(state.players[1].health, 97);
  await waitFor(
    () =>
      webhookRequests.some((request) =>
        request.body.includes(Buffer.from("bitefight-preview.png")),
      ),
    "active Bitefight preview",
  );
  await new Promise((resolve) => setTimeout(resolve, 750));
  writeLatestPreview(previewPath);

  const knockout = await fightRequest(players.knockout, knockoutId, {
    action: "punch",
    sequence: 1,
  });
  assert.equal(knockout.accepted, true);
  assert.equal(knockout.status, "finished");
  assert.equal(knockout.players[1].health, 0);
  assert.equal(knockout.winnerDiscordUserId, players.knockout.discordUserId);
  assert.equal(knockout.finishReason, "knockout");
  const targetView = await fightRequest(players.target, knockoutId);
  const knockoutRevision = targetView.revision;
  const postFinishPunch = await fightFetch(players.target, knockoutId, {
    action: "punch",
    sequence: 1,
  });
  assert.equal(postFinishPunch.status, 409);
  const immutableKnockout = await fightRequest(players.target, knockoutId);
  assert.equal(immutableKnockout.revision, knockoutRevision);
  assert.equal(immutableKnockout.players[1].health, 0);

  const leaderboard = await leaderboardRequest(players.knockout);
  assert.deepEqual(
    leaderboard.entries.slice(0, 2).map(({ name, wins, losses }) => ({ name, wins, losses })),
    [
      { name: "Knockout", wins: 1, losses: 0 },
      { name: "Timer", wins: 1, losses: 0 },
    ],
  );
  assert.equal(
    leaderboard.entries.find((entry) => entry.discordUserId === players.knockout.discordUserId).me,
    true,
  );

  const [rematch, sameRematch] = await Promise.all([
    fightRequest(players.knockout, knockoutId, { action: "rematch" }),
    fightRequest(players.target, knockoutId, { action: "rematch" }),
  ]);
  assert.equal(rematch.status, "accepted");
  assert.equal(rematch.rematchOf, knockoutId);
  assert.notEqual(rematch.id, knockoutId);
  assert.equal(sameRematch.id, rematch.id, "both fighters must converge on one rematch");
  assert.ok(rematch.players.every((player) => player.health === 100));
  assert.ok(rematch.players.every((player) => player.readyAt === null));

  const forfeit = await fightRequest(players.alpha, fightId, { action: "forfeit" });
  assert.equal(forfeit.status, "finished");
  assert.equal(forfeit.finishReason, "forfeit");
  assert.equal(forfeit.winnerDiscordUserId, players.beta.discordUserId);

  await waitFor(
    () =>
      webhookRequests.some((request) =>
        request.body.includes(Buffer.from("bitefight-preview.png")),
      ),
    "Bitefight live preview",
  );
  await new Promise((resolve) => setTimeout(resolve, 750));
  const previewRequest = webhookRequests
    .slice()
    .reverse()
    .find((request) => request.body.includes(Buffer.from("bitefight-preview.png")));
  assert.ok(previewRequest.url.includes("/messages/@original"));
  assert.ok(
    previewRequest.body.includes(Buffer.from('"allowed_mentions":{"parse":[]}')),
    "live preview edits must suppress all mentions",
  );
  const pngStart = previewRequest.body.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const pngEndMarker = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  const pngEnd = previewRequest.body.indexOf(pngEndMarker, pngStart);
  assert.ok(pngStart >= 0 && pngEnd > pngStart, "preview attachment must contain a valid PNG");
  fs.writeFileSync(
    finalPreviewPath,
    previewRequest.body.subarray(pngStart, pngEnd + pngEndMarker.length),
  );

  const commandSource = fs.readFileSync(
    path.join(repoRoot, "scripts", "register-discord-commands.mjs"),
    "utf8",
  );
  assert.match(commandSource, /name:\s*"bitefight"[\s\S]*name:\s*"opponent"/);
  assert.match(commandSource, /response\.status !== 429/);
  assert.match(commandSource, /payload\?\.retry_after/);
  assert.match(commandSource, /await wait\(retryMs\)/);
  const interactionSource = fs.readFileSync(
    path.join(repoRoot, "src", "app", "api", "discord", "interactions", "route.ts"),
    "utf8",
  );
  assert.match(interactionSource, /challenged you to a Bitefight/);
  assert.match(interactionSource, /allowed_mentions:\s*\{\s*users:\s*\[opponentId\]\s*\}/);
  assert.match(
    interactionSource,
    /Date\.now\(\) - match\.createdAt >= BITEFIGHT_CHALLENGE_TTL_MS/,
  );
  const fightSource = fs.readFileSync(
    path.join(repoRoot, "src", "components", "BitefightGame.tsx"),
    "utf8",
  );
  assert.match(fightSource, /bitefightAction\(matchId, "punch", \{ sequence:/);
  assert.match(fightSource, />\s*PUNCH\s*</);
  assert.doesNotMatch(fightSource, /punches landed/);
  assert.doesNotMatch(fightSource, /expectedKey|key !== "f"|event\.repeat/);
  const sharedArenaSource = fs.readFileSync(
    path.join(repoRoot, "src", "components", "BitefightArena.tsx"),
    "utf8",
  );
  assert.match(sharedArenaSource, /onClick=\{onPunch\}/);
  assert.match(sharedArenaSource, /Click or tap the ring to punch/);
  assert.match(sharedArenaSource, /dynamic\(\(\) => import\("\.\/BitefightStage3D"\)/);
  assert.match(sharedArenaSource, /ssr:\s*false/);
  assert.doesNotMatch(
    sharedArenaSource,
    /player\.punches/,
    "the shared fighter HUD must not display punch totals",
  );
  const previewSource = fs.readFileSync(
    path.join(repoRoot, "src", "lib", "bitefight-discord-preview.tsx"),
    "utf8",
  );
  assert.doesNotMatch(
    previewSource,
    /player\.punches/,
    "the live Discord preview must not display punch totals",
  );
  const constantsSource = fs.readFileSync(
    path.join(repoRoot, "src", "lib", "bitefight-constants.ts"),
    "utf8",
  );
  assert.match(constantsSource, /BITEFIGHT_PUNCH_DAMAGE = 1/);
  assert.match(constantsSource, /BITEFIGHT_CHALLENGE_TTL_MS = 60_000/);
  const lifecycleSource = fs.readFileSync(
    path.join(repoRoot, "src", "lib", "bitefight.ts"),
    "utf8",
  );
  assert.match(
    lifecycleSource,
    /now - match\.createdAt >= BITEFIGHT_CHALLENGE_TTL_MS/,
  );
  const stageSource = fs.readFileSync(
    path.join(repoRoot, "src", "components", "BitefightStage3D.tsx"),
    "utf8",
  );
  assert.match(stageSource, /new THREE\.WebGLRenderer/);
  assert.match(stageSource, /RoundedBoxGeometry/);
  assert.match(stageSource, /requestAnimationFrame\(renderFrame\)/);
  assert.match(stageSource, /headPopStartedAt/);
  assert.match(stageSource, /prefers-reduced-motion/);
  assert.equal(
    (stageSource.match(/const (?:punchArm|guardArm) = createArm\(/g) ?? []).length,
    2,
    "each robot rig must keep two independently animated arms",
  );
  assert.match(stageSource, /const FIGHTER_CENTER_X = 1\.52/);
  assert.match(
    stageSource,
    /side === "left" \? -FIGHTER_CENTER_X : FIGHTER_CENTER_X/,
  );
  assert.match(
    stageSource,
    /\[-FIGHTER_CENTER_X, FIGHTER_CENTER_X\]/,
    "fighter platforms must stay centered under the closer robots",
  );
  assert.match(stageSource, /queuedPunchAmount\(rig\.punchArm/);
  assert.match(stageSource, /queuedPunchAmount\(rig\.guardArm/);
  assert.doesNotMatch(
    stageSource,
    /activeArm/,
    "alternating punches must not cancel the other arm's retraction",
  );
  assert.match(stageSource, /punchQueued:\s*boolean/);
  assert.match(stageSource, /function queueArmPunch/);
  assert.match(stageSource, /function queuedPunchAmount/);
  assert.match(stageSource, /function readPunchPose/);
  assert.match(stageSource, /const LEAD_PUNCH_SHOULDER_ANGLE = -0\.13/);
  assert.match(stageSource, /const REAR_PUNCH_SHOULDER_ANGLE = -0\.1/);
  assert.match(stageSource, /const leadReach = 0\.95/);
  assert.match(stageSource, /const rearReach = 0\.6/);
  assert.match(
    stageSource,
    /const mutualPunchLane = rig\.facing \* opponentPunch \* 0\.12/,
  );
  assert.match(
    stageSource,
    /LEAD_PUNCH_SHOULDER_ANGLE - mutualPunchLane/,
  );
  assert.match(
    stageSource,
    /REAR_PUNCH_SHOULDER_ANGLE - mutualPunchLane/,
  );
  assert.doesNotMatch(stageSource, /punchingPlayerId/);
  assert.match(
    stageSource,
    /\[-facing \* 0\.46, 1\.8, 0\]/,
    "the camera-side arm must use its own outer shoulder joint",
  );
  assert.match(
    stageSource,
    /\[facing \* 0\.46, 1\.7, 0\]/,
    "the opposite arm must use the other shoulder joint",
  );
  assert.match(stageSource, /shoulder\.rotation\.y = -Math\.PI \/ 2/);
  assert.match(
    stageSource,
    /root\.rotation\.y = side === "left" \? 1\.2 : -1\.2/,
  );
  const demoSource = fs.readFileSync(
    path.join(repoRoot, "src", "components", "BitefightDemo.tsx"),
    "utf8",
  );
  assert.match(demoSource, /Website sparring demo/);
  assert.match(demoSource, /<GameNav mode="bitefight"/);
  const matchRouteSource = fs.readFileSync(
    path.join(repoRoot, "src", "app", "api", "bitefight", "match", "route.ts"),
    "utf8",
  );
  assert.match(matchRouteSource, /MAX_PUNCH_REQUESTS_PER_WINDOW/);
  assert.match(matchRouteSource, /status:\s*429/);
  const tabsSource = fs.readFileSync(
    path.join(repoRoot, "src", "components", "GameTabs.tsx"),
    "utf8",
  );
  assert.match(tabsSource, /runtime\.embedded && runtime\.mode === "bitefight"/);
  assert.match(tabsSource, /!runtime\.embedded && runtime\.mode === "bitefight"/);

  console.log(
    `Bitefight verification passed. Active preview: ${previewPath}. Rematch preview: ${finalPreviewPath}`,
  );
} finally {
  server.kill();
  await waitForServerExit(server);
  webhook.server.close();
  await removeVerifyArtifacts();
}

function identity(userId, discordUserId, name) {
  return { userId, discordUserId, name };
}

function fighter(player, health = 100) {
  return {
    discordUserId: player.discordUserId,
    userId: player.userId,
    name: player.name,
    discordAvatarUrl: null,
    readyAt: now - 4_000,
    health,
    punches: 0,
    lastSequence: 0,
    lastAcceptedAt: null,
  };
}

function fightFixture({
  id,
  first,
  second,
  startedAt,
  firstHealth = 100,
  secondHealth = 100,
}) {
  return {
    id,
    revision: 0,
    guildId,
    channelId,
    status: "fighting",
    createdAt: startedAt - 5_000,
    acceptedAt: startedAt - 4_000,
    countdownAt: startedAt - 3_000,
    startedAt,
    finishedAt: null,
    winnerDiscordUserId: null,
    finishReason: null,
    rematchOf: null,
    rematchMatchId: null,
    preview: null,
    players: [fighter(first, firstHealth), fighter(second, secondHealth)],
  };
}

function pendingFightFixture({ id, first, second, createdAt }) {
  return {
    id,
    revision: 0,
    guildId,
    channelId,
    status: "pending",
    createdAt,
    acceptedAt: null,
    countdownAt: null,
    startedAt: null,
    finishedAt: null,
    winnerDiscordUserId: null,
    finishReason: null,
    rematchOf: null,
    rematchMatchId: null,
    preview: null,
    players: [
      { ...fighter(first), readyAt: null },
      { ...fighter(second), readyAt: null },
    ],
  };
}

function buttonInteraction(customId, player) {
  return {
    type: 3,
    data: { custom_id: customId },
    guild_id: guildId,
    channel_id: channelId,
    application_id: appId,
    token: `BUTTON_${player.name.toUpperCase()}`,
    member: { user: { id: player.discordUserId, username: player.name } },
  };
}

function writeLatestPreview(outputPath) {
  const request = webhookRequests
    .slice()
    .reverse()
    .find((entry) => entry.body.includes(Buffer.from("bitefight-preview.png")));
  assert.ok(request, "a Bitefight preview request must exist");
  const pngStart = request.body.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const pngEndMarker = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  const pngEnd = request.body.indexOf(pngEndMarker, pngStart);
  assert.ok(pngStart >= 0 && pngEnd > pngStart);
  fs.writeFileSync(
    outputPath,
    request.body.subarray(pngStart, pngEnd + pngEndMarker.length),
  );
}

async function signedInteraction(payload) {
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = crypto.sign(
    null,
    Buffer.from(timestamp + rawBody),
    privateKey,
  ).toString("hex");
  return fetch(`${baseUrl}/api/discord/interactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature-Ed25519": signature,
      "X-Signature-Timestamp": timestamp,
    },
    body: rawBody,
  });
}

async function fightRequest(player, matchId, action) {
  const response = await fightFetch(player, matchId, action);
  const body = await response.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(
      `Bitefight API returned ${response.status} with a non-JSON body: ${body || "<empty>"}\n${output}`,
    );
  }
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}

async function fightFetch(player, matchId, action) {
  return fetch(
    `${baseUrl}/api/bitefight/match${action ? "" : `?matchId=${encodeURIComponent(matchId)}`}`,
    {
      method: action ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: `bitedle_id=${player.userId}`,
        "X-Bitedle-Discord-User-Id": player.discordUserId,
        "X-Bitedle-Guild-Id": guildId,
      },
      ...(action ? { body: JSON.stringify({ matchId, ...action }) } : {}),
    },
  );
}

async function modeRequest(player, instanceId) {
  const response = await fetch(`${baseUrl}/api/activity/mode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `bitedle_id=${player.userId}`,
      "X-Bitedle-Discord-User-Id": player.discordUserId,
    },
    body: JSON.stringify({ instanceId, channelId }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function leaderboardRequest(player) {
  const response = await fetch(`${baseUrl}/api/bitefight/leaderboard`, {
    headers: {
      Cookie: `bitedle_id=${player.userId}`,
      "X-Bitedle-Discord-User-Id": player.discordUserId,
      "X-Bitedle-Guild-Id": guildId,
    },
  });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const candidate = net.createServer();
    candidate.unref();
    candidate.on("error", reject);
    candidate.listen(0, "127.0.0.1", () => {
      const address = candidate.address();
      candidate.close(() => resolve(address.port));
    });
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error(`Next server exited early.\n${output}`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Next server did not start.\n${output}`);
}

async function waitFor(predicate, description) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function waitForServerExit(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => {
    const force = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 3_000);
    child.once("exit", () => {
      clearTimeout(force);
      resolve();
    });
  });
}

async function removeVerifyArtifacts() {
  await new Promise((resolve) => setTimeout(resolve, 600));
  try {
    fs.rmSync(path.join(repoRoot, verifyDistDir), {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 250,
    });
  } finally {
    fs.rmSync(verifyTsconfigPath, { force: true });
  }
}

async function startWebhookServer(requests) {
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({
        method: request.method,
        url: request.url ?? "",
        body: Buffer.concat(chunks),
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ id: "preview-message" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}/api/v10` };
}
