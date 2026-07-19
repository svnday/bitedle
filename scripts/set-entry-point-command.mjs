#!/usr/bin/env node
/**
 * One-time admin script: configures Bitedle's Discord Activity entry point
 * command (the "Launch" command Discord auto-creates when Activities is
 * enabled) — its name/description AND which install contexts it's available
 * in. There's no Developer Portal UI for the name, so this uses the API.
 *
 * An app can have at most one PRIMARY_ENTRY_POINT command. This finds the
 * existing one and updates it (type 4) to handler 1 / APP_HANDLER, so the
 * launch interaction reaches our app instead of Discord auto-posting a
 * "Game Invitation" card every time (we post a throttled stats preview
 * instead). It also sets integration_types [0, 1] and contexts [0, 1, 2] so
 * the Activity is launchable both when a server adds Bitedle (guild install)
 * AND when an individual user-installs it — letting them launch it in any
 * server, even ones that haven't added the app.
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
// handler 1 = APP_HANDLER: our app receives the launch interaction and controls
// what (if anything) gets posted to the channel. handler 2 = DISCORD_LAUNCH_ACTIVITY
// makes Discord auto-post a "Game Invitation" card on every launch, which spams
// the channel — so we use APP_HANDLER and post a throttled stats preview instead
// (see src/app/api/discord/interactions/route.ts).
const HANDLER = 1;
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

  // First try to PATCH in place. The `handler` (and sometimes
  // integration_types/contexts) often can't be changed via PATCH on an existing
  // command; if that's rejected — or if it silently leaves handler unchanged —
  // fall back to deleting and recreating the (single) entry point command.
  const patchRes = await fetch(`${API_BASE}/applications/${clientId}/commands/${entryPoint.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      name: NEW_NAME,
      description: NEW_DESCRIPTION,
      handler: HANDLER,
      // Clear any stale developer-defined permission requirement so every
      // member with Use Application Commands can see the entry point.
      default_member_permissions: null,
      integration_types: INTEGRATION_TYPES,
      contexts: CONTEXTS,
    }),
  });

  let updated;
  if (patchRes.ok) {
    updated = await patchRes.json();
  }

  if (!updated || updated.handler !== HANDLER) {
    if (!patchRes.ok) {
      console.warn(
        `PATCH failed (${patchRes.status}): ${await patchRes.text()}\n` +
          "Falling back to delete + recreate of the entry point command…",
      );
    } else {
      console.warn(
        `PATCH left handler as ${updated.handler} (wanted ${HANDLER}); ` +
          "recreating the entry point command to change it…",
      );
    }

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
        handler: HANDLER, // APP_HANDLER — app controls channel posts
        default_member_permissions: null,
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
      `(handler ${updated.handler}, integration_types ${JSON.stringify(updated.integration_types)}, ` +
      `contexts ${JSON.stringify(updated.contexts)})`,
  );
  console.log("It may take a few minutes (rarely up to an hour) to show up in Discord.");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
