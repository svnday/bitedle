#!/usr/bin/env node

const API_BASE = "https://discord.com/api/v10";

const clientId = process.env.DISCORD_CLIENT_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!clientId || !botToken) {
  console.error(
    "Usage: DISCORD_CLIENT_ID=... DISCORD_BOT_TOKEN=... node scripts/register-discord-commands.mjs",
  );
  process.exit(1);
}

const headers = {
  Authorization: `Bot ${botToken}`,
  "Content-Type": "application/json",
};

const MAX_RATE_LIMIT_RETRIES = 5;
const RATE_LIMIT_BUFFER_MS = 250;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discordFetch(url, options, action) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, options);
    if (response.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) {
      return response;
    }

    const payload = await response
      .clone()
      .json()
      .catch(() => null);
    const bodyRetrySeconds = Number(payload?.retry_after);
    const headerRetrySeconds = Number(response.headers.get("retry-after"));
    const retrySeconds = Number.isFinite(bodyRetrySeconds)
      ? bodyRetrySeconds
      : Number.isFinite(headerRetrySeconds)
        ? headerRetrySeconds
        : 1;
    const retryMs = Math.max(
      1_000,
      Math.ceil(retrySeconds * 1_000) + RATE_LIMIT_BUFFER_MS,
    );

    console.warn(
      `Rate limited while ${action}; retrying in ${(retryMs / 1_000).toFixed(2)}s ` +
        `(${attempt + 1}/${MAX_RATE_LIMIT_RETRIES})...`,
    );
    await wait(retryMs);
  }
}

// "play" is deliberately not in this list — that name belongs to the
// PRIMARY_ENTRY_POINT command (see set-entry-point-command.mjs), which
// launches the Activity inline instead of just replying with a link.
//
// integration_types [0, 1] = guild install + user install; contexts
// [0, 1, 2] = server, app DM, group DM. This lets /bitedle and /share work
// both where a server has added the app and where an individual has
// user-installed it. Requires User Install to be enabled for the app in the
// Developer Portal -> Installation tab first (see README). All four ordinary
// commands below support server, app-DM, and group-DM contexts.
const commands = [
  {
    name: "bitedle",
    description: "Open today's Bitedle",
    type: 1,
    // Explicitly clear any stale permission default left on an existing
    // command. null means no additional member permission is required;
    // Discord's normal Use Application Commands permission still applies.
    default_member_permissions: null,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "share",
    description: "Share Bitedle from Discord",
    type: 1,
    default_member_permissions: null,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "results",
    description: "Show today's Bitedle results for this server",
    type: 1,
    default_member_permissions: null,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "bitesweeper",
    description: "Open Bitesweeper — the replayable 10×10 board",
    type: 1,
    default_member_permissions: null,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "biteracer",
    description: "Challenge someone to a 1v1 typing race",
    type: 1,
    default_member_permissions: null,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      {
        type: 6,
        name: "opponent",
        description: "The person you want to race",
        required: true,
      },
    ],
  },
  {
    name: "bitefight",
    description: "Challenge someone to a 1v1 robot fight",
    type: 1,
    default_member_permissions: null,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      {
        type: 6,
        name: "opponent",
        description: "The person you want to fight",
        required: true,
      },
    ],
  },
];

function commandsUrl() {
  if (guildId) {
    return `${API_BASE}/applications/${clientId}/guilds/${guildId}/commands`;
  }
  return `${API_BASE}/applications/${clientId}/commands`;
}

function commandUrl(id) {
  if (guildId) {
    return `${API_BASE}/applications/${clientId}/guilds/${guildId}/commands/${id}`;
  }
  return `${API_BASE}/applications/${clientId}/commands/${id}`;
}

function installUrl() {
  const scope = "applications.commands";
  const params = new URLSearchParams({
    client_id: clientId,
    scope,
    // Force GUILD_INSTALL. Without this, an app that supports both install
    // types can be added only to the administrator's account, making its
    // commands visible to them but not to the rest of the server.
    integration_type: "0",
  });
  if (guildId) params.set("guild_id", guildId);
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

async function main() {
  console.log("Registering slash commands...");
  console.log(`Guild install URL (share with a server admin): ${installUrl()}`);

  const listRes = await discordFetch(commandsUrl(), { headers }, "listing commands");
  if (!listRes.ok) {
    console.error(`Failed to list commands (${listRes.status}): ${await listRes.text()}`);
    process.exit(1);
  }

  const existing = await listRes.json();

  // Clean up the ordinary CHAT_INPUT "/play" command from an earlier setup —
  // that name now belongs to the PRIMARY_ENTRY_POINT command instead (see
  // set-entry-point-command.mjs), and Discord won't allow both at once.
  const stalePlay = existing.find((c) => c.type === 1 && c.name === "play");
  if (stalePlay) {
    const deleteRes = await discordFetch(
      commandUrl(stalePlay.id),
      { method: "DELETE", headers },
      "removing stale /play",
    );
    if (!deleteRes.ok) {
      console.error(
        `Failed to remove the stale /play command (${deleteRes.status}): ${await deleteRes.text()}`,
      );
      process.exit(1);
    }
    console.log("Removed the stale ordinary /play command.");
  }

  for (const command of commands) {
    const match = existing.find((c) => c.name === command.name);

    if (match) {
      const patchRes = await discordFetch(
        commandUrl(match.id),
        {
          method: "PATCH",
          headers,
          body: JSON.stringify(command),
        },
        `updating /${command.name}`,
      );

      if (!patchRes.ok) {
        console.error(`Failed to update /${command.name} (${patchRes.status}): ${await patchRes.text()}`);
        process.exit(1);
      }

      console.log(`Updated /${command.name}` + (guildId ? ` in guild ${guildId}` : " globally"));
    } else {
      const createRes = await discordFetch(
        commandsUrl(),
        {
          method: "POST",
          headers,
          body: JSON.stringify(command),
        },
        `creating /${command.name}`,
      );

      if (!createRes.ok) {
        console.error(`Failed to create /${command.name} (${createRes.status}): ${await createRes.text()}`);
        process.exit(1);
      }

      console.log(`Created /${command.name}` + (guildId ? ` in guild ${guildId}` : " globally"));
    }
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
