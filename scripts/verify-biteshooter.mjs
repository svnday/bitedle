import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const verifyDistDir = ".next-verify-biteshooter";
const verifyTsconfigName = `.tsconfig-biteshooter-verify-${process.pid}.json`;
const verifyTsconfigPath = path.join(repoRoot, verifyTsconfigName);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bitedle-biteshooter-"));
const dbPath = path.join(tempDir, "db.json");
const previewPath = path.join(tempDir, "biteshooter-preview.png");
const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}`;
const webhookRequests = [];
const webhook = await startWebhookServer(webhookRequests);
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const publicKeyHex = publicKey
  .export({ type: "spki", format: "der" })
  .subarray(-32)
  .toString("hex");

const rules = compileTargetRules();
verifyTargetRules(rules);

const guildId = "333333333333333333";
const channelId = "444444444444444444";
const appId = "555555555555555555";
const players = {
  alpha: identity("11111111-1111-4111-8111-111111111111", "111111111111111111", "Alpha"),
  beta: identity("22222222-2222-4222-8222-222222222222", "222222222222222222", "Beta"),
  gamma: identity("33333333-3333-4333-8333-333333333333", "333333333333333333", "Gamma"),
  delta: identity("44444444-4444-4444-8444-444444444444", "444444444444444444", "Delta"),
  outsider: identity("55555555-5555-4555-8555-555555555555", "555555555555555555", "Outsider"),
  boxer: identity("66666666-6666-4666-8666-666666666666", "666666666666666666", "Boxer"),
  knockout: identity("77777777-7777-4777-8777-777777777777", "777777777777777777", "Knockout"),
  target: identity("88888888-8888-4888-8888-888888888888", "888888888888888888", "Target"),
  timer: identity("99999999-9999-4999-8999-999999999999", "999999999999999999", "Timer"),
  behind: identity("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "101010101010101010", "Behind"),
  drawOne: identity("bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", "121212121212121212", "Draw One"),
  drawTwo: identity("cccccccc-3333-4333-8333-cccccccccccc", "131313131313131313", "Draw Two"),
};
const ids = {
  expired: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  unjoined: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  knockout: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  timeout: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  draw: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  bitefight: "ffffffff-ffff-4fff-8fff-ffffffffffff",
};
const now = Date.now();

fs.writeFileSync(verifyTsconfigPath, JSON.stringify({ extends: "./tsconfig.json" }, null, 2));
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
      [ids.bitefight]: bitefightFixture(ids.bitefight, players.alpha, players.boxer),
    },
    bitefightLaunches: {
      [players.alpha.discordUserId]: {
        matchId: ids.bitefight,
        createdAt: now - 1_000,
      },
    },
    biteshooters: {
      [ids.expired]: pendingFixture(
        ids.expired,
        players.alpha,
        players.beta,
        now - 60_001,
      ),
      [ids.unjoined]: acceptedFixture(
        ids.unjoined,
        players.gamma,
        players.delta,
        now - 60_001,
      ),
      [ids.knockout]: fightingFixture({
        id: ids.knockout,
        first: players.knockout,
        second: players.target,
        seed: "knockout-seed",
        startedAt: now - 1_000,
        secondHealth: 2,
      }),
      [ids.timeout]: fightingFixture({
        id: ids.timeout,
        first: players.timer,
        second: players.behind,
        seed: "timeout-seed",
        startedAt: now - 60_001,
        firstHealth: 80,
        secondHealth: 62,
      }),
      [ids.draw]: fightingFixture({
        id: ids.draw,
        first: players.drawOne,
        second: players.drawTwo,
        seed: "draw-seed",
        startedAt: now - 60_001,
        firstHealth: 44,
        secondHealth: 44,
      }),
    },
    biteshooterLaunches: {
      [players.gamma.discordUserId]: { matchId: ids.unjoined, createdAt: now },
      [players.delta.discordUserId]: { matchId: ids.unjoined, createdAt: now },
    },
    bitesweeperLaunches: {},
    activityModes: {},
    launchIntents: {
      [players.outsider.discordUserId]: {
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
    buttonInteraction(`biteshooter-join:${ids.expired}`, players.beta),
  );
  const expiredPayload = await expiredAccept.json();
  assert.equal(expiredPayload.data.flags, 64);
  assert.match(expiredPayload.data.content, /challenge expired/i);
  const expired = await shooterRequest(players.alpha, ids.expired);
  assert.equal(expired.status, "expired");
  assert.equal(expired.winnerDiscordUserId, null);

  const staleLobby = await shooterRequest(players.gamma, ids.unjoined);
  assert.equal(staleLobby.status, "cancelled");
  assert.equal(staleLobby.finishReason, null);
  assert.equal(
    (await modeRequest(players.gamma, "expired-lobby-instance")).mode,
    "classic",
    "an accepted-but-unjoined timeout must clear its launch marker",
  );

  const lobbyChallenge = await signedInteraction(
    challengeInteraction(players.gamma, players.delta, "LOBBY_VERIFY_TOKEN"),
  );
  const lobbyPayload = await lobbyChallenge.json();
  assert.equal(lobbyPayload.type, 4, "timed-out lobby participants must be released");
  const lobbyJoinId = lobbyPayload.data.components[0].components[0].custom_id;
  assert.deepEqual(
    await (
      await signedInteraction(buttonInteraction(lobbyJoinId, players.delta))
    ).json(),
    { type: 12 },
  );
  const lobbyId = lobbyJoinId.slice("biteshooter-join:".length);
  const manuallyCancelled = await shooterRequest(players.gamma, lobbyId, {
    action: "cancel",
  });
  assert.equal(manuallyCancelled.status, "cancelled");
  assert.equal(manuallyCancelled.winnerDiscordUserId, null);

  const challenge = await signedInteraction(
    challengeInteraction(players.alpha, players.beta, "BITESHOOTER_VERIFY_TOKEN"),
  );
  assert.equal(challenge.status, 200);
  const challengePayload = await challenge.json();
  assert.equal(challengePayload.type, 4);
  assert.deepEqual(challengePayload.data.allowed_mentions, {
    users: [players.beta.discordUserId],
  });
  assert.equal(
    countOccurrences(challengePayload.data.content, `<@${players.beta.discordUserId}>`),
    1,
    "the initial challenge must mention the opponent exactly once",
  );
  const joinId = challengePayload.data.components[0].components[0].custom_id;
  const declineId = challengePayload.data.components[0].components[1].custom_id;
  assert.match(joinId, /^biteshooter-join:/);
  assert.match(declineId, /^biteshooter-decline:/);
  const matchId = joinId.slice("biteshooter-join:".length);

  const outsiderJoin = await signedInteraction(buttonInteraction(joinId, players.outsider));
  const outsiderPayload = await outsiderJoin.json();
  assert.equal(outsiderPayload.data.flags, 64);
  assert.match(outsiderPayload.data.content, /Only the two challenged shooters/);

  const duplicate = await signedInteraction(
    challengeInteraction(players.alpha, players.outsider, "DUPLICATE_TOKEN"),
  );
  const duplicatePayload = await duplicate.json();
  assert.equal(duplicatePayload.data.flags, 64);
  assert.match(duplicatePayload.data.content, /current Biteshooter/);

  const selfChallenge = await signedInteraction(
    challengeInteraction(players.alpha, players.alpha, "SELF_TOKEN"),
  );
  assert.match((await selfChallenge.json()).data.content, /challenge yourself/);
  const botChallenge = await signedInteraction(
    challengeInteraction(
      players.alpha,
      { ...players.outsider, bot: true },
      "BOT_TOKEN",
    ),
  );
  assert.match((await botChallenge.json()).data.content, /Bots aren't allowed/);

  assert.deepEqual(
    await (await signedInteraction(buttonInteraction(joinId, players.beta))).json(),
    { type: 12 },
  );
  assert.deepEqual(
    await (await signedInteraction(buttonInteraction(joinId, players.alpha))).json(),
    { type: 12 },
  );
  assert.deepEqual(await modeRequest(players.alpha, "alpha-shooter-instance"), {
    mode: "biteshooter",
    matchId,
  });
  assert.deepEqual(await modeRequest(players.beta, "beta-shooter-instance"), {
    mode: "biteshooter",
    matchId,
  });
  assert.equal(
    readDb().bitefights[ids.bitefight].status,
    "fighting",
    "launching Biteshooter must not cancel an active Bitefight",
  );
  assert.equal(
    (await modeRequest(players.outsider, "outsider-sweeper-instance")).mode,
    "mega",
    "another player's Bitesweeper intent must remain isolated",
  );
  assert.equal(
    (await modeRequest(players.boxer, "boxer-classic-instance")).mode,
    "classic",
    "another player's Classic mode must remain isolated",
  );

  let state = await shooterRequest(players.alpha, matchId);
  assert.equal(state.players[0].joinedAt !== null, true);
  assert.equal(state.players[1].joinedAt, null);
  assert.equal("preview" in state, false, "webhook credentials must be redacted");
  state = await shooterRequest(players.beta, matchId);
  assert.ok(state.players.every((player) => player.joinedAt !== null));

  state = await shooterRequest(players.alpha, matchId, { action: "ready" });
  assert.equal(state.status, "accepted");
  assert.equal(state.startedAt, null);
  const earlyAim = await shooterFetch(players.alpha, matchId, {
    action: "aim",
    sequence: 1,
    targetIndex: 0,
    point: rules.targetFor(state.seed, 0),
  });
  assert.equal(earlyAim.status, 409, "aiming before the shared start must fail");

  state = await shooterRequest(players.beta, matchId, { action: "ready" });
  assert.equal(state.status, "countdown");
  assert.equal(state.startedAt - state.countdownAt, 3_000);
  await waitFor(() => Date.now() >= state.startedAt + 50, "three-second countdown");
  state = await shooterRequest(players.alpha, matchId);
  assert.equal(state.status, "fighting");

  const seed = state.seed;
  state = await aimAt(players.alpha, matchId, seed, 1, 0, 0);
  assert.equal(state.damage, 3);
  assert.equal(findPlayer(state, players.beta).health, 97);

  state = await aimAt(players.alpha, matchId, seed, 2, 1, 0.5, {
    zone: "miss",
    damage: 99,
    opponentHealth: 0,
  });
  assert.equal(state.damage, 2, "the server must ignore forged damage and zone fields");
  assert.equal(findPlayer(state, players.beta).health, 95);

  state = await aimAt(players.alpha, matchId, seed, 3, 2, 0.8);
  assert.equal(state.damage, 1);
  assert.equal(findPlayer(state, players.beta).health, 94);

  state = await aimAt(players.alpha, matchId, seed, 4, 3, 1.2);
  assert.equal(state.damage, 0);
  assert.equal(findPlayer(state, players.alpha).targetIndex, 3);
  assert.equal(findPlayer(state, players.beta).health, 94);

  const beforeInvalid = state.revision;
  const wrongTarget = await shooterFetch(players.alpha, matchId, {
    action: "aim",
    sequence: 5,
    targetIndex: 999,
    point: rules.targetFor(seed, 3),
  });
  assert.equal(wrongTarget.status, 409);
  const invalidPoint = await shooterFetch(players.alpha, matchId, {
    action: "aim",
    sequence: 5,
    targetIndex: 3,
    point: { x: 99, y: 99 },
  });
  assert.equal(invalidPoint.status, 409);
  const malformedPoint = await shooterFetch(players.alpha, matchId, {
    action: "aim",
    sequence: 5,
    targetIndex: 3,
    point: { x: "bad", y: 0 },
  });
  assert.equal(malformedPoint.status, 400);
  state = await shooterRequest(players.alpha, matchId);
  assert.equal(state.revision, beforeInvalid);

  state = await shooterRequest(players.alpha, matchId, {
    action: "aim",
    sequence: 4,
    targetIndex: 3,
    point: rules.targetFor(seed, 3),
  });
  assert.equal(state.accepted, false, "duplicate sequences must be idempotent");
  assert.equal(findPlayer(state, players.beta).health, 94);

  const [alphaConcurrent, betaConcurrent] = await Promise.all([
    aimAt(players.alpha, matchId, seed, 5, 3, 0),
    aimAt(players.beta, matchId, seed, 1, 0, 0),
  ]);
  const concurrentRevision = Math.max(alphaConcurrent.revision, betaConcurrent.revision);
  state = await shooterRequest(players.alpha, matchId);
  assert.ok(state.revision >= concurrentRevision);
  assert.equal(findPlayer(state, players.alpha).health, 97);
  assert.equal(findPlayer(state, players.beta).health, 91);
  assert.deepEqual(
    {
      attempts: findPlayer(state, players.alpha).attempts,
      hits: findPlayer(state, players.alpha).hits,
      innerHits: findPlayer(state, players.alpha).innerHits,
      middleHits: findPlayer(state, players.alpha).middleHits,
      outerHits: findPlayer(state, players.alpha).outerHits,
      totalDamage: findPlayer(state, players.alpha).totalDamage,
    },
    { attempts: 5, hits: 4, innerHits: 2, middleHits: 1, outerHits: 1, totalDamage: 9 },
  );

  const knockout = await shooterRequest(players.knockout, ids.knockout, {
    action: "aim",
    sequence: 1,
    targetIndex: 0,
    point: rules.targetFor("knockout-seed", 0),
  });
  assert.equal(knockout.status, "finished");
  assert.equal(knockout.damage, 3);
  assert.equal(findPlayer(knockout, players.target).health, 0);
  assert.equal(knockout.winnerDiscordUserId, players.knockout.discordUserId);
  assert.equal(knockout.finishReason, "knockout");
  assert.equal(
    (
      await shooterFetch(players.target, ids.knockout, {
        action: "aim",
        sequence: 1,
        targetIndex: 0,
        point: rules.targetFor("knockout-seed", 0),
      })
    ).status,
    409,
  );

  const timedOut = await shooterRequest(players.timer, ids.timeout);
  assert.equal(timedOut.status, "finished");
  assert.equal(timedOut.finishReason, "timeout");
  assert.equal(timedOut.winnerDiscordUserId, players.timer.discordUserId);
  const draw = await shooterRequest(players.drawOne, ids.draw);
  assert.equal(draw.status, "finished");
  assert.equal(draw.finishReason, "draw");
  assert.equal(draw.winnerDiscordUserId, null);

  const forfeit = await shooterRequest(players.alpha, matchId, { action: "forfeit" });
  assert.equal(forfeit.status, "finished");
  assert.equal(forfeit.finishReason, "forfeit");
  assert.equal(forfeit.winnerDiscordUserId, players.beta.discordUserId);

  const [rematch, sameRematch] = await Promise.all([
    shooterRequest(players.knockout, ids.knockout, { action: "rematch" }),
    shooterRequest(players.target, ids.knockout, { action: "rematch" }),
  ]);
  assert.equal(rematch.id, sameRematch.id);
  assert.equal(rematch.status, "accepted");
  assert.equal(rematch.rematchOf, ids.knockout);
  assert.ok(rematch.players.every((player) => player.health === 100));
  assert.ok(rematch.players.every((player) => player.targetIndex === 0));
  const cancelledRematch = await shooterRequest(players.knockout, rematch.id, {
    action: "cancel",
  });
  assert.equal(cancelledRematch.status, "cancelled");

  const leaderboard = await leaderboardRequest(players.knockout);
  const byId = new Map(
    leaderboard.entries.map((entry) => [entry.discordUserId, entry]),
  );
  assert.deepEqual(
    {
      wins: byId.get(players.knockout.discordUserId).wins,
      losses: byId.get(players.knockout.discordUserId).losses,
      accuracy: byId.get(players.knockout.discordUserId).accuracy,
      bullseyes: byId.get(players.knockout.discordUserId).bullseyes,
      averageDamagePerHit:
        byId.get(players.knockout.discordUserId).averageDamagePerHit,
      me: byId.get(players.knockout.discordUserId).me,
    },
    {
      wins: 1,
      losses: 0,
      accuracy: 100,
      bullseyes: 1,
      averageDamagePerHit: 3,
      me: true,
    },
  );
  assert.equal(byId.get(players.beta.discordUserId).wins, 1);
  assert.equal(byId.get(players.drawOne.discordUserId).draws, 1);
  assert.equal(byId.has(players.gamma.discordUserId), false);
  assert.equal(byId.has(players.delta.discordUserId), false);

  const atomicResponses = await Promise.all([
    signedInteraction(
      challengeInteraction(players.gamma, players.outsider, "ATOMIC_ONE_TOKEN"),
    ),
    signedInteraction(
      challengeInteraction(players.delta, players.outsider, "ATOMIC_TWO_TOKEN"),
    ),
  ]);
  const atomicPayloads = await Promise.all(
    atomicResponses.map((response) => response.json()),
  );
  assert.equal(
    atomicPayloads.filter((payload) => payload.type === 4 && payload.data.flags !== 64)
      .length,
    1,
    "simultaneous challenges must reserve a shared participant only once",
  );
  assert.equal(
    atomicPayloads.filter((payload) => payload.data.flags === 64).length,
    1,
  );

  await waitFor(
    () =>
      webhookRequests.some(
        (request) =>
          request.url.includes("BITESHOOTER_VERIFY_TOKEN") &&
          request.body.includes(Buffer.from("biteshooter-preview.png")),
      ),
    "Biteshooter live preview",
  );
  await new Promise((resolve) => setTimeout(resolve, 750));
  const mainPreviewRequests = webhookRequests.filter(
    (request) =>
      request.url.includes("BITESHOOTER_VERIFY_TOKEN") &&
      request.body.includes(Buffer.from("biteshooter-preview.png")),
  );
  assert.ok(mainPreviewRequests.length > 0);
  for (const request of mainPreviewRequests) {
    assert.ok(request.url.includes("/messages/@original"));
    assert.ok(
      request.body.includes(Buffer.from('"allowed_mentions":{"parse":[]}')),
      "every preview edit must suppress mentions",
    );
  }
  writeLatestPreview(mainPreviewRequests.at(-1), previewPath);

  verifySourceContracts();

  console.log(
    `Biteshooter verification passed: lifecycle, cross-game isolation, server-authored 3/2/1/0 damage, CAS, rematch, leaderboard, and zero-ping preview. Preview: ${previewPath}`,
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

function shooterPlayer(player, { health = 100, joinedAt = now - 5_000 } = {}) {
  return {
    discordUserId: player.discordUserId,
    userId: player.userId,
    name: player.name,
    discordAvatarUrl: null,
    joinedAt,
    readyAt: joinedAt,
    health,
    targetIndex: 0,
    attempts: 0,
    hits: 0,
    innerHits: 0,
    middleHits: 0,
    outerHits: 0,
    totalDamage: 0,
    lastSequence: 0,
    lastAttemptAt: null,
  };
}

function baseMatch(id, first, second, seed) {
  return {
    id,
    revision: 0,
    guildId,
    channelId,
    seed,
    createdAt: now - 5_000,
    acceptedAt: now - 4_000,
    countdownAt: null,
    startedAt: null,
    finishedAt: null,
    winnerDiscordUserId: null,
    finishReason: null,
    rematchOf: null,
    rematchMatchId: null,
    preview: null,
    players: [shooterPlayer(first), shooterPlayer(second)],
  };
}

function pendingFixture(id, first, second, createdAt) {
  return {
    ...baseMatch(id, first, second, `pending-${id}`),
    status: "pending",
    createdAt,
    acceptedAt: null,
    players: [
      shooterPlayer(first, { joinedAt: null }),
      shooterPlayer(second, { joinedAt: null }),
    ].map((player) => ({ ...player, readyAt: null })),
  };
}

function acceptedFixture(id, first, second, acceptedAt) {
  return {
    ...baseMatch(id, first, second, `accepted-${id}`),
    status: "accepted",
    acceptedAt,
    players: [
      { ...shooterPlayer(first, { joinedAt: acceptedAt + 100 }), readyAt: null },
      { ...shooterPlayer(second, { joinedAt: null }), readyAt: null },
    ],
  };
}

function fightingFixture({
  id,
  first,
  second,
  seed,
  startedAt,
  firstHealth = 100,
  secondHealth = 100,
}) {
  return {
    ...baseMatch(id, first, second, seed),
    status: "fighting",
    countdownAt: startedAt - 3_000,
    startedAt,
    players: [
      shooterPlayer(first, { health: firstHealth }),
      shooterPlayer(second, { health: secondHealth }),
    ],
  };
}

function bitefightFixture(id, first, second) {
  return {
    id,
    revision: 0,
    guildId,
    channelId,
    status: "fighting",
    createdAt: now - 5_000,
    acceptedAt: now - 4_000,
    countdownAt: now - 3_000,
    startedAt: now - 1_000,
    finishedAt: null,
    winnerDiscordUserId: null,
    finishReason: null,
    rematchOf: null,
    rematchMatchId: null,
    preview: null,
    players: [first, second].map((player) => ({
      discordUserId: player.discordUserId,
      userId: player.userId,
      name: player.name,
      discordAvatarUrl: null,
      readyAt: now - 4_000,
      health: 100,
      punches: 0,
      lastSequence: 0,
      lastAcceptedAt: null,
    })),
  };
}

function challengeInteraction(challenger, opponent, token) {
  return {
    type: 2,
    data: {
      name: "biteshooter",
      options: [{ name: "opponent", value: opponent.discordUserId }],
      resolved: {
        users: {
          [opponent.discordUserId]: {
            id: opponent.discordUserId,
            username: opponent.name,
            avatar: null,
            ...(opponent.bot ? { bot: true } : {}),
          },
        },
      },
    },
    guild_id: guildId,
    channel_id: channelId,
    application_id: appId,
    token,
    member: {
      user: {
        id: challenger.discordUserId,
        username: challenger.name,
        avatar: null,
      },
    },
  };
}

function buttonInteraction(customId, player) {
  return {
    type: 3,
    data: { custom_id: customId },
    guild_id: guildId,
    channel_id: channelId,
    application_id: appId,
    token: `BUTTON_${player.name.toUpperCase().replaceAll(" ", "_")}`,
    member: { user: { id: player.discordUserId, username: player.name } },
  };
}

function compileTargetRules() {
  const compileDir = path.join(tempDir, "target-rules");
  const tsconfigPath = path.join(tempDir, "target-rules-tsconfig.json");
  fs.mkdirSync(compileDir, { recursive: true });
  fs.writeFileSync(
    tsconfigPath,
    JSON.stringify({
      compilerOptions: {
        target: "ES2020",
        module: "CommonJS",
        moduleResolution: "Node",
        esModuleInterop: true,
        strict: true,
        skipLibCheck: true,
        rootDir: path.join(repoRoot, "src", "lib"),
        outDir: compileDir,
      },
      files: [
        path.join(repoRoot, "src", "lib", "biteshooter-constants.ts"),
        path.join(repoRoot, "src", "lib", "biteshooter-targets.ts"),
      ],
    }),
  );
  execFileSync(
    process.execPath,
    [path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"), "-p", tsconfigPath],
    { cwd: repoRoot, stdio: "pipe" },
  );
  return createRequire(import.meta.url)(
    path.join(compileDir, "biteshooter-targets.js"),
  );
}

function verifyTargetRules(targetRules) {
  for (let index = 0; index < 500; index += 1) {
    const first = targetRules.targetFor("verification-seed", index);
    const second = targetRules.targetFor("verification-seed", index);
    assert.deepEqual(first, second);
    assert.ok(first.x >= 0.08 && first.x <= 0.92);
    assert.ok(first.y >= 0.08 && first.y <= 0.92);
  }
  const radius = 100;
  assert.equal(targetRules.classifyBiteshooterHit(30, radius), "inner");
  assert.equal(targetRules.classifyBiteshooterHit(30.001, radius), "middle");
  assert.equal(targetRules.classifyBiteshooterHit(62, radius), "middle");
  assert.equal(targetRules.classifyBiteshooterHit(62.001, radius), "outer");
  assert.equal(targetRules.classifyBiteshooterHit(100, radius), "outer");
  assert.equal(targetRules.classifyBiteshooterHit(100.001, radius), "miss");
  assert.equal(targetRules.damageForBiteshooterZone("inner"), 3);
  assert.equal(targetRules.damageForBiteshooterZone("middle"), 2);
  assert.equal(targetRules.damageForBiteshooterZone("outer"), 1);
  assert.equal(targetRules.damageForBiteshooterZone("miss"), 0);
  assert.equal(targetRules.clampBiteshooterHealth(2, 3), 0);
}

async function aimAt(player, matchId, seed, sequence, targetIndex, radiusRatio, forged = {}) {
  const target = rules.targetFor(seed, targetIndex);
  return shooterRequest(player, matchId, {
    action: "aim",
    sequence,
    targetIndex,
    point: {
      x: target.x + 0.04 * radiusRatio,
      y: target.y,
    },
    ...forged,
  });
}

function findPlayer(state, player) {
  return state.players.find(
    (candidate) => candidate.discordUserId === player.discordUserId,
  );
}

async function signedInteraction(payload) {
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = crypto
    .sign(null, Buffer.from(timestamp + rawBody), privateKey)
    .toString("hex");
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

async function shooterRequest(player, matchId, action) {
  const response = await shooterFetch(player, matchId, action);
  const body = await response.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(
      `Biteshooter API returned ${response.status} with a non-JSON body: ${body || "<empty>"}\n${output}`,
    );
  }
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}

async function shooterFetch(player, matchId, action) {
  return fetch(
    `${baseUrl}/api/biteshooter/match${
      action ? "" : `?matchId=${encodeURIComponent(matchId)}`
    }`,
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
  const response = await fetch(`${baseUrl}/api/biteshooter/leaderboard`, {
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

function verifySourceContracts() {
  const commandSource = readSource("scripts/register-discord-commands.mjs");
  assert.match(commandSource, /name:\s*"biteshooter"[\s\S]*name:\s*"opponent"/);
  assert.match(
    commandSource,
    /name:\s*"biteshooter"[\s\S]*default_member_permissions:\s*null[\s\S]*integration_types:\s*\[0,\s*1\][\s\S]*contexts:\s*\[0,\s*1,\s*2\]/,
  );
  const interactionSource = readSource("src/app/api/discord/interactions/route.ts");
  assert.match(interactionSource, /challenged you to a Biteshooter 1v1/);
  assert.match(
    interactionSource,
    /createBiteshooterIfPlayersAvailable\(match\)/,
  );
  assert.match(interactionSource, /allowed_mentions:\s*\{\s*users:\s*\[opponentId\]\s*\}/);
  const constantsSource = readSource("src/lib/biteshooter-constants.ts");
  assert.match(constantsSource, /BITESHOOTER_CHALLENGE_TTL_MS = 60_000/);
  assert.match(constantsSource, /BITESHOOTER_LOBBY_TIMEOUT_MS = 60_000/);
  const lifecycleSource = readSource("src/lib/biteshooter.ts");
  assert.match(lifecycleSource, /targetFor\(match\.seed, attacker\.targetIndex\)/);
  assert.doesNotMatch(lifecycleSource, /input\.damage|input\.zone|input\.health/);
  const routeSource = readSource("src/app/api/biteshooter/match/route.ts");
  assert.match(routeSource, /MAX_AIM_REQUESTS_PER_WINDOW/);
  assert.match(routeSource, /status:\s*429/);
  const gameSource = readSource("src/components/BiteshooterGame.tsx");
  assert.match(gameSource, /biteshooterAction\(matchId, "aim"/);
  assert.match(gameSource, />\s*Cancel match\s*</);
  assert.match(gameSource, /BITESHOOTER_LOBBY_TIMEOUT_MS/);
  const demoSource = readSource("src/components/BiteshooterDemo.tsx");
  assert.doesNotMatch(demoSource, /\/api\/biteshooter|biteshooterAction/);
  const tabsSource = readSource("src/components/GameTabs.tsx");
  assert.match(tabsSource, /runtime\.embedded && runtime\.mode === "biteshooter"/);
  assert.match(tabsSource, /!runtime\.embedded && runtime\.mode === "biteshooter"/);
  const contextSource = readSource("src/lib/discord-context.ts");
  assert.match(contextSource, /getBiteshooterMatchId/);
  assert.match(contextSource, /setBiteshooterMatchId/);
  const previewSource = readSource("src/lib/biteshooter-discord-preview.tsx");
  assert.match(previewSource, /filename:\s*"biteshooter-preview\.png"/);
  assert.match(previewSource, /await queue\.running/);
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readDb() {
  return JSON.parse(fs.readFileSync(dbPath, "utf8"));
}

function countOccurrences(value, needle) {
  return value.split(needle).length - 1;
}

function writeLatestPreview(request, outputPath) {
  const pngStart = request.body.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const pngEndMarker = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  const pngEnd = request.body.indexOf(pngEndMarker, pngStart);
  assert.ok(pngStart >= 0 && pngEnd > pngStart, "preview must contain a valid PNG");
  fs.writeFileSync(
    outputPath,
    request.body.subarray(pngStart, pngEnd + pngEndMarker.length),
  );
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
  for (let attempt = 0; attempt < 80; attempt += 1) {
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
  for (let attempt = 0; attempt < 100; attempt += 1) {
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
