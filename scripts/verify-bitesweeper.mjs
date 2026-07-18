import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
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
      DISCORD_PUBLIC_KEY: publicKeyHex,
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
  const launch = await signedInteraction({
    type: 2,
    data: { name: "bitesweeper" },
    channel_id: channelId,
    application_id: "234567890123456789",
    token: "LOCAL_TEST_TOKEN",
    user: { id: "345678901234567890" },
  });
  assert.equal(launch.status, 200);
  assert.deepEqual(await launch.json(), { type: 12 });
  await waitFor(() => output.includes("BITEDLE_FORCE_FILE_STORE=1"));
  assert.ok(fs.existsSync(dbPath), "FileStore should persist under the temporary path");

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
    headers: { "X-Bitedle-Guild-Id": channelId },
  });
  assert.equal(megaState.status, 200, "Bitesweeper must accept Discord guild requests");
  const state = await megaState.json();
  assert.equal(state.status, "playing");
  assert.equal("layout" in state, false, "a playing state must not reveal the board");

  assert.equal((await fetch(`${baseUrl}/api/mega/stats`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/mega/leaderboard`)).status, 404);

  const activityInstanceId = "presence-instance";
  const firstPlayer = await linkedPlayer("456789012345678901", "First player");
  const secondPlayer = await linkedPlayer("567890123456789012", "Second player");
  await embeddedFetch("/api/mega/state", firstPlayer, activityInstanceId);
  await embeddedFetch("/api/mega/state", secondPlayer, activityInstanceId);
  const secondClick = await embeddedFetch("/api/mega/click", secondPlayer, activityInstanceId, {
    method: "POST",
    body: JSON.stringify({ index: 0 }),
  });
  assert.equal(secondClick.status, 200);

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

  console.log("Bitesweeper verification passed: isolated launch surface, atomic mode binding, and instance-scoped player boards.");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await stopServer();
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
      ...init.headers,
    },
  });
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
