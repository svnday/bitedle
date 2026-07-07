#!/usr/bin/env node
/**
 * One-time admin script: configures Bitedle's Discord Activity entry point
 * command (the "Launch" command Discord auto-creates when Activities is
 * enabled) — its name/description AND which install contexts it's available
 * in. There's no Developer Portal UI for the name, so this uses the API.
 *
 * An app can have at most one PRIMARY_ENTRY_POINT command. This finds the
 * existing one and updates it in place (keeping type 4 / handler 2,
 * DISCORD_LAUNCH_ACTIVITY). It sets integration_types [0, 1] and contexts
 * [0, 1, 2] so the Activity is launchable both when a server adds Bitedle
 * (guild install) AND when an individual user-installs it — letting them
 * launch it in any server, even ones that haven't added the app.
 *
 * PREREQUISITE: enable User Install for the app first, in the Developer
 * Portal -> Installation tab -> Installation Contexts (see README). Discord
 * rejects integration_type 1 on a command if the app itself doesn't support
 * it. Run this AFTER that portal step.
 *
 * This claims the name "play", so run register-discord-commands.mjs
 * (which deletes any stray ordinary /play command left over from before)
 * either before or after this — order doesn't matter.
 *
 * Usage:
 *   DISCORD_CLIENT_ID=... DISCORD_BOT_TOKEN=... node scripts/set-entry-point-command.mjs
 *
 * DISCORD_BOT_TOKEN is a secret (Developer Portal -> Bot tab -> Reset
 * Token). Never commit it or expose it client-side. Safe to re-run any time.
 */

const API_BASE = "https://discord.com/api/v10";

const NEW_NAME = "play";
const NEW_DESCRIPTION = "Open today's Bitedle";
// [0, 1] = guild install + user install; [0, 1, 2] = server, app DM, group DM.
const INTEGRATION_TYPES = [0, 1];
const CONTEXTS = [0, 1, 2];

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

  // First try to PATCH in place. integration_types/contexts aren't always
  // editable via PATCH on an existing command; if that's rejected, fall back
  // to deleting and recreating the (single) entry point command.
  const patchRes = await fetch(`${API_BASE}/applications/${clientId}/commands/${entryPoint.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      name: NEW_NAME,
      description: NEW_DESCRIPTION,
      integration_types: INTEGRATION_TYPES,
      contexts: CONTEXTS,
    }),
  });

  let updated;
  if (patchRes.ok) {
    updated = await patchRes.json();
  } else {
    const patchErr = await patchRes.text();
    console.warn(
      `PATCH failed (${patchRes.status}): ${patchErr}\n` +
        "Falling back to delete + recreate of the entry point command…",
    );

    const deleteRes = await fetch(
      `${API_BASE}/applications/${clientId}/commands/${entryPoint.id}`,
      { method: "DELETE", headers },
    );
    if (!deleteRes.ok) {
      console.error(
        `Failed to delete the existing entry point command (${deleteRes.status}): ${await deleteRes.text()}`,
      );
      process.exit(1);
    }

    const createRes = await fetch(`${API_BASE}/applications/${clientId}/commands`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: NEW_NAME,
        description: NEW_DESCRIPTION,
        type: 4, // PRIMARY_ENTRY_POINT
        handler: 2, // DISCORD_LAUNCH_ACTIVITY
        integration_types: INTEGRATION_TYPES,
        contexts: CONTEXTS,
      }),
    });
    if (!createRes.ok) {
      console.error(
        `Failed to recreate the entry point command (${createRes.status}): ${await createRes.text()}\n` +
          "If this mentions integration_types, make sure User Install is enabled for the app " +
          "in the Developer Portal -> Installation tab first (see README).",
      );
      process.exit(1);
    }
    updated = await createRes.json();
  }

  console.log(
    `Entry point command set: /${updated.name} — "${updated.description}" ` +
      `(integration_types ${JSON.stringify(updated.integration_types)}, contexts ${JSON.stringify(updated.contexts)})`,
  );
  console.log("It may take a few minutes (rarely up to an hour) to show up in Discord.");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
