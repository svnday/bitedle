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
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bitedle-bitesweeper-"));
const dbPath = path.join(tempDir, "db.json");
const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}`;
const webhookRequests = [];
const { server: webhookServer, baseUrl: webhookBaseUrl } = await startWebhookServer(webhookRequests);
const testGuildId = "678901234567890123";
const testBoardSecret = "bitesweeper-verification-secret";

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const publicKeyHex = publicKey
  .export({ type: "spki", format: "der" })
  .subarray(-32)
  .toString("hex");

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
      BITEDLE_SECRET: testBoardSecret,
      DISCORD_PUBLIC_KEY: publicKeyHex,
      BITEDLE_DISCORD_API_BASE_URL: `${webhookBaseUrl}/api/v10`,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);

server.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

try {
  await waitForServer();

  const channelId = "123456789012345678";
  const guildId = testGuildId;
  const launch = await signedInteraction({
    type: 2,
    data: { name: "bitesweeper" },
    channel_id: channelId,
    guild_id: guildId,
    application_id: "234567890123456789",
    token: "LOCAL_TEST_TOKEN",
    user: { id: "345678901234567890" },
  });
  assert.equal(launch.status, 200);
  assert.deepEqual(await launch.json(), { type: 12 });
  await waitFor(() => output.includes("BITEDLE_FORCE_FILE_STORE=1"));
  assert.ok(fs.existsSync(dbPath), "FileStore should persist under the temporary path");
  await waitFor(() => {
    const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    return Boolean(db.guildChannels?.[guildId]?.bitesweeperApplicationId);
  });
  await waitFor(() => webhookRequests.some((request) => request.method === "POST"));
  const placeholderPost = webhookRequests.find((request) => request.method === "POST");
  assert.match(placeholderPost.contentType, /^multipart\/form-data; boundary=/);
  assert.ok(placeholderPost.body.includes("bitesweeper-preview.png"));
  assert.ok(placeholderPost.body.includes("Play now!"));
  assert.ok(placeholderPost.body.includes("bitesweeper-launch"));
  assert.ok(placeholderPost.byteLength > 2_000, "placeholder must include a rendered PNG");
  const pngOffset = placeholderPost.buffer.indexOf(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  assert.ok(pngOffset >= 0, "placeholder webhook must contain a PNG attachment");
  assert.ok(placeholderPost.buffer.readUInt32BE(pngOffset + 16) >= 250);
  assert.ok(placeholderPost.buffer.readUInt32BE(pngOffset + 20) >= 300);
  if (process.env.BITEDLE_PREVIEW_OUTPUT) {
    const iendOffset = placeholderPost.buffer.indexOf(Buffer.from("IEND"), pngOffset);
    assert.ok(iendOffset > pngOffset);
    fs.writeFileSync(
      process.env.BITEDLE_PREVIEW_OUTPUT,
      placeholderPost.buffer.subarray(pngOffset, iendOffset + 8),
    );
  }

  const sameInstance = await Promise.all(
    Array.from({ length: 8 }, () =>
      postJson("/api/activity/mode", {
        instanceId: "bitesweeper-instance",
        channelId,
      }),
    ),
  );
  assert.deepEqual(
    sameInstance.map((result) => result.mode),
    Array(8).fill("mega"),
    "simultaneous participants must agree on Bitesweeper mode",
  );

  const buttonPlayer = await linkedPlayer("901234567890123456", "Button player");
  await embeddedFetch("/api/mega/state", buttonPlayer, "bitesweeper-instance");

  const launchButton = await signedInteraction({
    type: 3,
    data: { custom_id: "bitesweeper-launch" },
    channel_id: channelId,
    guild_id: guildId,
    application_id: "234567890123456789",
    token: "LOCAL_BUTTON_TOKEN",
    user: { id: "345678901234567890", username: "Launcher" },
  });
  assert.equal(launchButton.status, 200);
  assert.deepEqual(await launchButton.json(), { type: 12 });
  assert.deepEqual(
    await postJson("/api/activity/mode", {
      instanceId: "bitesweeper-instance",
      channelId,
    }),
    { mode: "mega" },
  );
  assert.deepEqual(
    await postJson("/api/activity/mode", {
      instanceId: "after-button-classic-instance",
      channelId,
    }),
    { mode: "classic" },
    "joining an existing Bitesweeper instance must consume the fresh button marker",
  );

  assert.deepEqual(
    await postJson("/api/activity/mode", {
      instanceId: "classic-instance",
      channelId,
    }),
    { mode: "classic" },
  );

  const secondLaunch = await signedInteraction({
    type: 2,
    data: { name: "bitesweeper" },
    channel_id: channelId,
    guild_id: guildId,
    application_id: "234567890123456789",
    token: "LOCAL_TEST_TOKEN_2",
    user: { id: "345678901234567890" },
  });
  assert.equal(secondLaunch.status, 200);
  assert.deepEqual(
    await postJson("/api/activity/mode", {
      instanceId: "classic-instance",
      channelId,
    }),
    { mode: "classic" },
    "an existing Classic binding must not consume a new Bitesweeper marker",
  );
  assert.deepEqual(
    await postJson("/api/activity/mode", {
      instanceId: "second-bitesweeper-instance",
      channelId,
    }),
    { mode: "mega" },
  );

  const megaState = await fetch(`${baseUrl}/api/mega/state`, {
    headers: { "X-Bitedle-Guild-Id": guildId },
  });
  assert.equal(megaState.status, 200, "Bitesweeper must accept Discord guild requests");
  const state = await megaState.json();
  assert.equal(state.status, "playing");
  assert.equal(state.livesRemaining, 3);
  assert.equal("puzzleNumber" in state, false, "Bitesweeper state must not expose numbering");
  assert.equal("layout" in state, false, "a playing state must not reveal the board");

  assert.equal((await fetch(`${baseUrl}/api/mega/stats`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/mega/leaderboard`)).status, 404);

  const activityInstanceId = "presence-instance";
  const firstPlayer = await linkedPlayer("456789012345678901", "First player");
  const secondPlayer = await linkedPlayer("567890123456789012", "Second player");
  await embeddedFetch("/api/mega/state", firstPlayer, activityInstanceId);
  await embeddedFetch("/api/mega/state", secondPlayer, activityInstanceId);
  const flagged = await embeddedFetch("/api/mega/flag", secondPlayer, activityInstanceId, {
    method: "POST",
    body: JSON.stringify({ index: 5 }),
  });
  assert.equal(flagged.status, 200);
  assert.deepEqual((await flagged.json()).flags, [5]);
  const flaggedClick = await embeddedFetch("/api/mega/click", secondPlayer, activityInstanceId, {
    method: "POST",
    body: JSON.stringify({ index: 5 }),
  });
  assert.equal(flaggedClick.status, 409, "a flagged square must not be revealed");
  const unflagged = await embeddedFetch("/api/mega/flag", secondPlayer, activityInstanceId, {
    method: "POST",
    body: JSON.stringify({ index: 5 }),
  });
  assert.deepEqual((await unflagged.json()).flags, []);
  await embeddedFetch("/api/mega/flag", secondPlayer, activityInstanceId, {
    method: "POST",
    body: JSON.stringify({ index: 6 }),
  });
  const secondClick = await embeddedFetch("/api/mega/click", secondPlayer, activityInstanceId, {
    method: "POST",
    body: JSON.stringify({ index: 0 }),
  });
  assert.equal(secondClick.status, 200);
  await waitFor(() => webhookRequests.some((request) => request.method === "PATCH"));

  const playersResponse = await embeddedFetch(
    "/api/mega/players",
    firstPlayer,
    activityInstanceId,
  );
  assert.equal(playersResponse.status, 200);
  const { players } = await playersResponse.json();
  assert.equal(players.length, 1, "presence must only return the other player");
  assert.equal(players[0].name, "Second player");
  assert.equal(players[0].clicks.length, 1, "presence must include the other player's board");
  assert.deepEqual(players[0].flags, [6], "presence must include the other player's flags");
  assert.equal(
    players[0].livesRemaining,
    3 - players[0].clicks.filter((click) => click.result === "bomb").length,
  );

  const gameTabsSource = fs.readFileSync(path.join(repoRoot, "src/components/GameTabs.tsx"), "utf8");
  assert.match(
    gameTabsSource,
    /mode === "mega".*<BitesweeperGame/s,
    "embedded Bitesweeper must bypass the shared game surface",
  );
  const contextSource = fs.readFileSync(path.join(repoRoot, "src/lib/discord-context.ts"), "utf8");
  for (const launchParam of ["frame_id", "instance_id", "platform"]) {
    assert.ok(contextSource.includes(launchParam), `embed detection must recognize ${launchParam}`);
  }
  assert.ok(
    contextSource.includes("window.self !== window.top"),
    "embed detection must recognize Discord's framed launch even without legacy URL signals",
  );
  assert.ok(
    gameTabsSource.includes("} | null>(null)"),
    "the server render must not preselect the public Classic surface",
  );
  const previewSource = fs.readFileSync(
    path.join(repoRoot, "src/lib/bitesweeper-discord-preview.tsx"),
    "utf8",
  );
  assert.ok(previewSource.includes("Array.from({ length: 100 }"));
  assert.ok(previewSource.includes('result === undefined ? "#3a3b3e"'));
  assert.ok(previewSource.includes("clicked.get(index)"));
  assert.ok(previewSource.includes('isFlagged ? "🚩"'));
  assert.ok(previewSource.includes("livesRemaining"));
  assert.ok(!previewSource.includes('row.clicks.length} click'));
  assert.ok(!previewSource.includes("Bitesweeper No."));
  assert.ok(previewSource.includes(">\n          Bitesweeper\n"));
  const bitesweeperSource = fs.readFileSync(
    path.join(repoRoot, "src/components/BitesweeperGame.tsx"),
    "utf8",
  );
  assert.ok(!bitesweeperSource.includes("puzzleNumber"));
  const boardSource = fs.readFileSync(path.join(repoRoot, "src/components/Board.tsx"), "utf8");
  assert.ok(boardSource.includes("onContextMenu"));
  assert.ok(boardSource.includes("onCellFlag(i)"));
  assert.ok(boardSource.includes("LONG_PRESS_MS = 500"));
  assert.ok(boardSource.includes("onPointerDown"));
  assert.ok(boardSource.includes("markTouchFlagHandled(i, Date.now())"));

  const privatePlayer = await linkedPlayer("789012345678901234", "Private player");
  const otherPrivatePlayer = await linkedPlayer("890123456789012345", "Other private player");
  const firstLaunchId = "private-launch-one";
  const secondLaunchId = "private-launch-two";
  const firstPrivateState = await embeddedFetch(
    "/api/mega/state",
    privatePlayer,
    firstLaunchId,
  );
  assert.equal(firstPrivateState.status, 200);
  assert.equal("puzzleNumber" in (await firstPrivateState.json()), false);
  const firstBoard = storedMegaGame(privatePlayer);
  assert.equal(firstBoard.activityInstanceId, firstLaunchId);
  assert.ok(firstBoard.boardSeed, "an Activity launch must create a random board seed");

  await embeddedFetch("/api/mega/state", privatePlayer, firstLaunchId);
  assert.equal(
    storedMegaGame(privatePlayer).boardSeed,
    firstBoard.boardSeed,
    "refreshing the same Activity instance must preserve the player's board",
  );

  await embeddedFetch("/api/mega/state", privatePlayer, secondLaunchId);
  const relaunchedBoard = storedMegaGame(privatePlayer);
  assert.equal(relaunchedBoard.activityInstanceId, secondLaunchId);
  assert.notEqual(
    relaunchedBoard.boardSeed,
    firstBoard.boardSeed,
    "a new Activity launch must reroll the player's board",
  );
  assert.deepEqual(relaunchedBoard.clicks, []);
  assert.deepEqual(relaunchedBoard.flags, []);

  await embeddedFetch("/api/mega/state", otherPrivatePlayer, secondLaunchId);
  assert.notEqual(
    storedMegaGame(otherPrivatePlayer).boardSeed,
    relaunchedBoard.boardSeed,
    "players in the same Activity must receive private random boards",
  );

  const livesPlayer = await linkedPlayer("912345678901234567", "Three lives player");
  const livesInstanceId = "three-lives-instance";
  const livesStateResponse = await embeddedFetch(
    "/api/mega/state",
    livesPlayer,
    livesInstanceId,
  );
  const livesState = await livesStateResponse.json();
  const livesGame = storedMegaGame(livesPlayer);
  const { bombIndices } = megaDrawIndices(livesState.date, livesGame.boardSeed);
  for (let bombNumber = 1; bombNumber <= 3; bombNumber++) {
    const hit = await embeddedFetch("/api/mega/click", livesPlayer, livesInstanceId, {
      method: "POST",
      body: JSON.stringify({ index: bombIndices[bombNumber - 1] }),
    });
    assert.equal(hit.status, 200);
    const payload = await hit.json();
    assert.equal(payload.result, "bomb");
    assert.equal(payload.state.livesRemaining, 3 - bombNumber);
    assert.equal(payload.state.status, bombNumber < 3 ? "playing" : "lost");
  }

  const clearPlayer = await linkedPlayer("923456789012345678", "Perfect clear player");
  const clearInstanceId = "perfect-clear-instance";
  const clearStateResponse = await embeddedFetch(
    "/api/mega/state",
    clearPlayer,
    clearInstanceId,
    { headers: { "X-Bitedle-Guild-Id": "" } },
  );
  const clearState = await clearStateResponse.json();
  const clearGame = storedMegaGame(clearPlayer);
  const clearDraw = megaDrawIndices(clearState.date, clearGame.boardSeed);
  for (const bombIndex of clearDraw.bombIndices.slice(0, 2)) {
    const bombHit = await embeddedFetch("/api/mega/click", clearPlayer, clearInstanceId, {
      method: "POST",
      headers: { "X-Bitedle-Guild-Id": "" },
      body: JSON.stringify({ index: bombIndex }),
    });
    assert.equal(bombHit.status, 200);
    const bombPayload = await bombHit.json();
    assert.equal(bombPayload.result, "bomb");
    assert.equal(bombPayload.state.status, "playing");
  }
  let perfectClearPayload;
  for (let safeNumber = 0; safeNumber < clearDraw.safeIndices.length; safeNumber++) {
    const click = await embeddedFetch("/api/mega/click", clearPlayer, clearInstanceId, {
      method: "POST",
      headers: { "X-Bitedle-Guild-Id": "" },
      body: JSON.stringify({ index: clearDraw.safeIndices[safeNumber] }),
    });
    assert.equal(click.status, 200);
    perfectClearPayload = await click.json();
    if (safeNumber < clearDraw.safeIndices.length - 1) {
      assert.equal(perfectClearPayload.state.status, "playing");
    }
  }
  assert.equal(perfectClearPayload.state.status, "won");
  assert.equal(perfectClearPayload.state.score, 89);
  assert.equal(perfectClearPayload.state.livesRemaining, 1);
  assert.equal(perfectClearPayload.state.clicks.length, 90);
  assert.deepEqual(perfectClearPayload.state.clicks.at(-1), {
    index: clearDraw.checkIndex,
    result: "check",
  });
  assert.equal(perfectClearPayload.state.layout[clearDraw.checkIndex], "check");

  console.log("Bitesweeper verification passed: isolated launch surface, perfect-clear auto-win, three-hit lives, mobile and desktop flags, private launch-random boards, live PNG preview, and atomic mode binding.");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await stopServer();
  await new Promise((resolve) => webhookServer.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const selected = typeof address === "object" && address ? address.port : null;
      probe.close((error) => (error ? reject(error) : resolve(selected)));
    });
  });
}

async function waitForServer() {
  await waitFor(async () => {
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1_000) });
      return response.ok;
    } catch {
      return false;
    }
  }, 30_000);
}

async function waitFor(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
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

async function postJson(pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200, `${pathname} returned ${response.status}`);
  return response.json();
}

async function linkedPlayer(discordUserId, discordName) {
  const initial = await fetch(`${baseUrl}/api/mega/state`);
  assert.equal(initial.status, 200);
  const cookie = initial.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "initial state must issue an identity cookie");
  const identify = await fetch(`${baseUrl}/api/discord/identify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ discordUserId, discordAvatar: null, discordName }),
  });
  assert.equal(identify.status, 200);
  return { cookie, discordUserId };
}

function embeddedFetch(pathname, player, activityInstanceId, init = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Cookie: player.cookie,
      "X-Bitedle-Discord-User-Id": player.discordUserId,
      "X-Bitedle-Activity-Instance-Id": activityInstanceId,
      "X-Bitedle-Guild-Id": testGuildId,
      ...init.headers,
    },
  });
}

function storedMegaGame(player) {
  const userId = decodeURIComponent(player.cookie.slice(player.cookie.indexOf("=") + 1));
  const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  for (const games of Object.values(db.megaGames ?? {})) {
    if (games[userId]) return games[userId];
  }
  assert.fail(`No stored Bitesweeper game for ${userId}`);
}

function megaDrawIndices(date, boardSeed) {
  const digest = crypto
    .createHash("sha256")
    .update(`${testBoardSecret}:mega:${date}:${boardSeed}`)
    .digest();
  const rng = mulberry32(digest.readUInt32LE(0));
  const indices = Array.from({ length: 100 }, (_, index) => index);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return {
    checkIndex: indices[0],
    bombIndices: indices.slice(1, 13),
    safeIndices: indices.slice(13),
  };
}

function mulberry32(seed) {
  let value = seed;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

async function startWebhookServer(requests) {
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const bodyBuffer = Buffer.concat(chunks);
      requests.push({
        method: request.method,
        contentType: request.headers["content-type"] ?? "",
        body: bodyBuffer.toString("latin1"),
        buffer: bodyBuffer,
        byteLength: bodyBuffer.length,
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(request.method === "POST" ? JSON.stringify({ id: "preview-message" }) : "{}");
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function stopServer() {
  if (server.exitCode !== null) return;
  server.kill();
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}
