#!/usr/bin/env node
/**
 * Read-only debugging helper: prints every command currently registered for
 * this app (global, or a specific guild via DISCORD_GUILD_ID), with its real
 * id/name/type — useful for confirming what Discord's API actually has vs.
 * what the Developer Portal UI displays (which can lag or mislabel).
 *
 * Usage:
 *   DISCORD_CLIENT_ID=... DISCORD_BOT_TOKEN=... node scripts/list-discord-commands.mjs
 */

const API_BASE = "https://discord.com/api/v10";

const TYPE_NAMES = {
  1: "CHAT_INPUT",
  2: "USER",
  3: "MESSAGE",
  4: "PRIMARY_ENTRY_POINT",
};

const clientId = process.env.DISCORD_CLIENT_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!clientId || !botToken) {
  console.error(
    "Usage: DISCORD_CLIENT_ID=... DISCORD_BOT_TOKEN=... node scripts/list-discord-commands.mjs",
  );
  process.exit(1);
}

const headers = { Authorization: `Bot ${botToken}` };

async function list(label, url) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    console.error(`Failed to list ${label} commands (${res.status}): ${await res.text()}`);
    return;
  }
  const commands = await res.json();
  console.log(`\n${label} commands (${commands.length}):`);
  for (const c of commands) {
    console.log(
      `  id=${c.id}  name="${c.name}"  type=${c.type} (${TYPE_NAMES[c.type] ?? "unknown"})  ` +
        `handler=${c.handler ?? "-"}  description="${c.description}"`,
    );
  }
}

await list("Global", `${API_BASE}/applications/${clientId}/commands`);
if (guildId) {
  await list(`Guild ${guildId}`, `${API_BASE}/applications/${clientId}/guilds/${guildId}/commands`);
}
