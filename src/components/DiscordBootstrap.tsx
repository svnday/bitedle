"use client";

import { useEffect } from "react";
import type { DiscordSDK } from "@discord/embedded-app-sdk";
import { api } from "@/lib/client-api";
import { isDiscordEmbed, setGuildId } from "@/lib/discord-context";

/**
 * Handshakes with the Discord client when Bitedle is loaded as a Discord
 * Activity (an iframe served through Discord's reverse proxy at
 * *.discordsays.com). Outside that context this renders nothing and never
 * imports the SDK, so normal web play at bitedle.vercel.app is unaffected.
 */
export default function DiscordBootstrap() {
  useEffect(() => {
    if (!isDiscordEmbed()) return;

    let cancelled = false;
    (async () => {
      const { DiscordSDK } = await import("@discord/embedded-app-sdk");
      const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
      if (!clientId) {
        console.warn("Bitedle: running inside Discord but NEXT_PUBLIC_DISCORD_CLIENT_ID is unset");
        return;
      }
      const discordSdk = new DiscordSDK(clientId);
      if (cancelled) return;
      await discordSdk.ready();
      if (cancelled) return;

      // Available immediately post-ready, no OAuth needed — used to scope
      // the leaderboard to this server.
      setGuildId(discordSdk.guildId ?? null);

      // Fire-and-forget: links the real Discord identity for avatars. Never
      // awaited — a slow or declined consent prompt must not block anything.
      void linkDiscordIdentity(discordSdk, clientId).catch((e) => {
        console.warn("Bitedle: Discord identity link failed", e);
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

async function linkDiscordIdentity(discordSdk: DiscordSDK, clientId: string): Promise<void> {
  const { code } = await discordSdk.commands.authorize({
    client_id: clientId,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify"],
  });
  const { access_token } = await api.discordToken(code);
  const { user } = await discordSdk.commands.authenticate({ access_token });
  await api.discordIdentify({ discordUserId: user.id, discordAvatar: user.avatar ?? null });
}
