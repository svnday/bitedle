#!/usr/bin/env node
/**
 * One-time admin script: renames Bitedle's Discord Activity entry point
 * command (the "Launch" command Discord auto-creates when Activities is
 * enabled) to a custom name/description. There's no Developer Portal UI
 * for this — it requires a direct API call.
 *
 * An app can have at most one PRIMARY_ENTRY_POINT command, so this finds
 * the existing one and PATCHes its name/description in place; type and
 * handler (DISCORD_LAUNCH_ACTIVITY) are left untouched.
 *
 * This claims the name "play", so run register-discord-commands.mjs
 * (which deletes any stray ordinary /play command left over from before)
 * either before or after this — order doesn't matter.
 *
 * Usage:
 *   DISCORD_CLIENT_ID=... DISCORD_BOT_TOKEN=... node scripts/set-entry-point-command.mjs
 *
 * DISCORD_BOT_TOKEN is a secret (Developer Portal -> Bot tab -> Reset
 * Token). Never commit it or expose it client-side. Safe to re-run
 * whenever you want to change the name/description again.
 */

const API_BASE = "https://discord.com/api/v10";

const NEW_NAME = "play";
const NEW_DESCRIPTION = "Open today's Bitedle";

const clientId = process.env.DISCORD_CLIENT_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;

if (!clientId || !botToken) {
  console.error(
    "Usage: DISCORD_CLIENT_ID=... DISCORD_BOT_TOKEN=... node scripts/set-entry-point-command.mjs",
  );
  process.exit(1);
}

const headers = {
  Authorization: `Bot ${botToken}`,
  "Content-Type": "application/json",
};

async function main() {
  const listRes = await fetch(`${API_BASE}/applications/${clientId}/commands`, { headers });
  if (!listRes.ok) {
    console.error(
      `Failed to list commands (${listRes.status}): ${await listRes.text()}\n` +
        "Check that DISCORD_CLIENT_ID and DISCORD_BOT_TOKEN are correct.",
    );
    process.exit(1);
  }

  const commands = await listRes.json();
  const entryPoint = commands.find((c) => c.type === 4);
  if (!entryPoint) {
    console.error(
      "No PRIMARY_ENTRY_POINT command found. Enable Activities for this app in the " +
        "Discord Developer Portal first — Discord auto-creates the default 'Launch' " +
        "command at that point.",
    );
    process.exit(1);
  }

  const patchRes = await fetch(`${API_BASE}/applications/${clientId}/commands/${entryPoint.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ name: NEW_NAME, description: NEW_DESCRIPTION }),
  });
  if (!patchRes.ok) {
    console.error(`Failed to update the command (${patchRes.status}): ${await patchRes.text()}`);
    process.exit(1);
  }

  const updated = await patchRes.json();
  console.log(`Entry point command renamed: /${updated.name} — "${updated.description}"`);
  console.log("It may take a few minutes (rarely up to an hour) to show up in Discord.");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
