import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bitedle-race-"));
const dbPath = path.join(tempDir, "db.json");
const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}`;
const webhookRequests = [];
const webhook = await startWebhookServer(webhookRequests);
const raceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const readyRaceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const discordA = "111111111111111111";
const discordB = "222222222222222222";
const passage = { id: "verify", book: "Verifier", author: "Bitedle", text: "fast fox" };
const startedAt = Date.now() - 10_000;

fs.writeFileSync(
  dbPath,
  JSON.stringify({
    users: {
      [userA]: {
        name: "Alpha",
        named: true,
        createdAt: Date.now(),
        discordUserId: discordA,
        discordAvatar: null,
      },
      [userB]: {
        name: "Beta",
        named: true,
        createdAt: Date.now(),
        discordUserId: discordB,
        discordAvatar: null,
      },
    },
    games: {},
    launches: {},
    megaGames: {},
    biteracerGames: {},
    biteracerRaces: {
      [raceId]: {
        id: raceId,
        guildId: "333333333333333333",
        channelId: "444444444444444444",
        passage,
        status: "racing",
        createdAt: startedAt - 5_000,
        acceptedAt: startedAt - 4_000,
        countdownAt: startedAt - 3_000,
        startedAt,
        finishedAt: null,
        winnerDiscordUserId: null,
        rematchOf: null,
        preview: {
          applicationId: "555555555555555555",
          webhookToken: "VERIFY_TOKEN",
          tokenCreatedAt: Date.now(),
        },
        players: [player(discordA, userA, "Alpha"), player(discordB, userB, "Beta")],
      },
      [readyRaceId]: {
        id: readyRaceId,
        guildId: "333333333333333333",
        channelId: "444444444444444444",
        passage,
        status: "accepted",
        createdAt: Date.now(),
        acceptedAt: Date.now(),
        countdownAt: null,
        startedAt: null,
        finishedAt: null,
        winnerDiscordUserId: null,
        rematchOf: null,
        preview: null,
        players: [
          { ...player(discordA, userA, "Alpha"), readyAt: null },
          { ...player(discordB, userB, "Beta"), readyAt: null },
        ],
      },
    },
    biteracerRaceLaunches: {
      [discordA]: { raceId, createdAt: Date.now() },
    },
    bitesweeperLaunches: {},
    activityModes: {},
    launchIntents: {
      [discordB]: { mode: "mega", viaEntryPoint: false, createdAt: Date.now() },
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
      BITEDLE_FORCE_FILE_STORE: "1",
      BITEDLE_FILE_DB_PATH: dbPath,
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
  let state = await raceRequest(userA, discordA);
  assert.equal(state.status, "racing");
  assert.equal(state.players.length, 2);

  const modeA = await modeRequest(userA, discordA, "instance-a");
  const modeB = await modeRequest(userB, discordB, "instance-b");
  assert.deepEqual(modeA, { mode: "biteracer", raceId });
  assert.equal(modeB.mode, "mega", "one user's Biteracer launch must not hijack another mode");

  let readyState = await raceRequest(userA, discordA, {
    raceId: readyRaceId,
    action: "ready",
  });
  assert.equal(readyState.status, "accepted");
  assert.equal(readyState.startedAt, null, "one ready player must not start the countdown");
  readyState = await raceRequest(userB, discordB, {
    raceId: readyRaceId,
    action: "ready",
  });
  assert.equal(readyState.status, "countdown");
  assert.ok(readyState.startedAt - readyState.countdownAt === 3_000);
  await waitFor(() => webhookRequests.length > 0);
  assert.ok(
    webhookRequests.some(
      (request) =>
        request.url.includes("/messages/@original") &&
        request.body.includes(Buffer.from("biteracer-preview.png")),
    ),
    "ready/countdown updates must render and PATCH the live race PNG",
  );
  const previewRequest = webhookRequests.find((request) =>
    request.body.includes(Buffer.from("biteracer-preview.png")),
  );
  const pngStart = previewRequest.body.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const pngEndMarker = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  const pngEnd = previewRequest.body.indexOf(pngEndMarker, pngStart);
  assert.ok(pngStart >= 0 && pngEnd > pngStart, "preview attachment must contain a valid PNG");
  fs.writeFileSync(
    path.join(tempDir, "biteracer-preview.png"),
    previewRequest.body.subarray(pngStart, pngEnd + pngEndMarker.length),
  );

  state = await raceRequest(userA, discordA, {
    raceId,
    action: "progress",
    typed: "fast x",
    sequence: 1,
  });
  const alpha = state.players.find((entry) => entry.discordUserId === discordA);
  assert.equal(alpha.progress, 5 / passage.text.length, "wrong characters must not move the racer");

  state = await raceRequest(userA, discordA, {
    raceId,
    action: "finish",
    typed: passage.text,
  });
  assert.equal(state.winnerDiscordUserId, discordA);
  assert.equal(state.players[0].progress, 1);

  state = await raceRequest(userB, discordB, {
    raceId,
    action: "finish",
    typed: passage.text,
  });
  assert.equal(state.status, "finished");
  assert.equal(state.winnerDiscordUserId, discordA, "the first valid finisher stays the winner");
  const leaderboard = await leaderboardRequest(userA, discordA);
  assert.deepEqual(
    leaderboard.entries.map(({ name, wins, losses }) => ({ name, wins, losses })),
    [
      { name: "Alpha", wins: 1, losses: 0 },
      { name: "Beta", wins: 0, losses: 1 },
    ],
  );
  assert.equal(leaderboard.entries[0].me, true);

  const rematch = await raceRequest(userA, discordA, {
    raceId,
    action: "rematch",
  });
  assert.equal(rematch.status, "accepted");
  assert.equal(rematch.rematchOf, raceId);
  assert.notEqual(rematch.id, raceId);
  assert.notEqual(rematch.passage.id, state.passage.id);
  assert.ok(rematch.players.every((entry) => entry.readyAt === null));

  const commandSource = fs.readFileSync(
    path.join(repoRoot, "scripts", "register-discord-commands.mjs"),
    "utf8",
  );
  assert.match(commandSource, /name:\s*"biteracer"/);
  assert.match(commandSource, /type:\s*6/);
  const interactionSource = fs.readFileSync(
    path.join(repoRoot, "src", "app", "api", "discord", "interactions", "route.ts"),
    "utf8",
  );
  assert.match(interactionSource, /randomRacePassage/);
  assert.doesNotMatch(interactionSource, /passageFor\(todayStr\(\)\)/);
  assert.match(
    interactionSource,
    /content:\s*`[^`]*<@\$\{opponentId\}>[^`]*challenged you to a Biteracer 1v1!/,
  );
  assert.match(interactionSource, /allowed_mentions:\s*\{\s*users:\s*\[opponentId\]\s*\}/);
  const discordSummarySource = fs.readFileSync(
    path.join(repoRoot, "src", "lib", "discord-summary.tsx"),
    "utf8",
  );
  assert.match(
    discordSummarySource,
    /function patchImageWebhookMessage[\s\S]*allowed_mentions:\s*\{\s*parse:\s*\[\]\s*\}/,
    "live preview edits must remain zero-ping",
  );
  const previewSource = fs.readFileSync(
    path.join(repoRoot, "src", "lib", "biteracer-discord-preview.tsx"),
    "utf8",
  );
  assert.match(previewSource, /renderBiteracerPreviewImage/);
  assert.match(previewSource, /messageId:\s*"@original"/);
  console.log(`Biteracer 1v1 verification passed. Preview: ${path.join(tempDir, "biteracer-preview.png")}`);
} finally {
  server.kill();
  webhook.server.close();
}

function player(discordUserId, userId, name) {
  return {
    discordUserId,
    userId,
    name,
    discordAvatarUrl: null,
    readyAt: startedAt - 4_000,
    progress: 0,
    correctChars: 0,
    errorCount: 0,
    sequence: 0,
    lastUpdateAt: null,
    finishedAt: null,
    result: null,
  };
}

async function raceRequest(userId, discordUserId, body) {
  const response = await fetch(
    `${baseUrl}/api/biteracer/race${body ? "" : `?raceId=${raceId}`}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: `bitedle_id=${userId}`,
        "X-Bitedle-Discord-User-Id": discordUserId,
        "X-Bitedle-Guild-Id": "333333333333333333",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}

async function modeRequest(userId, discordUserId, instanceId) {
  const response = await fetch(`${baseUrl}/api/activity/mode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `bitedle_id=${userId}`,
      "X-Bitedle-Discord-User-Id": discordUserId,
    },
    body: JSON.stringify({ instanceId, channelId: "444444444444444444" }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function leaderboardRequest(userId, discordUserId) {
  const response = await fetch(`${baseUrl}/api/biteracer/race/leaderboard`, {
    headers: {
      Cookie: `bitedle_id=${userId}`,
      "X-Bitedle-Discord-User-Id": discordUserId,
      "X-Bitedle-Guild-Id": "333333333333333333",
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

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the live preview webhook");
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
