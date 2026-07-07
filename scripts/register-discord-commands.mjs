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

// "play" is deliberately not in this list — that name belongs to the
// PRIMARY_ENTRY_POINT command (see set-entry-point-command.mjs), which
// launches the Activity inline instead of just replying with a link.
//
// integration_types [0, 1] = guild install + user install; contexts
// [0, 1, 2] = server, app DM, group DM. This lets /bitedle and /share work
// both where a server has added the app and where an individual has
// user-installed it. Requires User Install to be enabled for the app in the
// Developer Portal -> Installation tab first (see README).
const commands = [
  {
    name: "bitedle",
    description: "Open today's Bitedle",
    type: 1,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "share",
    description: "Share Bitedle from Discord",
    type: 1,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
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
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

async function main() {
  console.log("Registering slash commands...");
  console.log(`Install URL: ${installUrl()}`);

  const listRes = await fetch(commandsUrl(), { headers });
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
    const deleteRes = await fetch(commandUrl(stalePlay.id), { method: "DELETE", headers });
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
      const patchRes = await fetch(commandUrl(match.id), {
        method: "PATCH",
        headers,
        body: JSON.stringify(command),
      });

      if (!patchRes.ok) {
        console.error(`Failed to update /${command.name} (${patchRes.status}): ${await patchRes.text()}`);
        process.exit(1);
      }

      console.log(`Updated /${command.name}` + (guildId ? ` in guild ${guildId}` : " globally"));
    } else {
      const createRes = await fetch(commandsUrl(), {
        method: "POST",
        headers,
        body: JSON.stringify(command),
      });

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
