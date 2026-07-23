"use client";

import { useEffect } from "react";
import type { DiscordSDK } from "@discord/embedded-app-sdk";
import { api } from "@/lib/client-api";
import {
  isDiscordEmbed,
  setActivityInstanceId,
  setDiscordUserId,
  setGuildId,
  setLaunchMode,
} from "@/lib/discord-context";

/**
 * Handshakes with the Discord client when Bitedle is loaded as a Discord
 * Activity (a Discord-authorized frame, whether served from the legacy
 * *.discordsays.com host or a direct mapped origin). Outside that context
 * this renders nothing and never imports the SDK, so normal web play at
 * bitedle.vercel.app is unaffected.
 */
export default function DiscordBootstrap() {
  useEffect(() => {
    if (!isDiscordEmbed()) return;

    let cancelled = false;

    // Safety net: never let a hung SDK-chunk load or ready() block every API
    // call (including the first click of the day) forever.
    const timeout = setTimeout(() => {
      console.warn("Bitedle: Discord handshake timed out after 5s, defaulting guildId to null");
      setGuildId(null);
      setActivityInstanceId(null);
      setDiscordUserId(null);
      setLaunchMode("unavailable");
    }, 5000);

    (async () => {
      try {
        const { DiscordSDK } = await import("@discord/embedded-app-sdk");
        const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
        if (!clientId) {
          console.warn("Bitedle: running inside Discord but NEXT_PUBLIC_DISCORD_CLIENT_ID is unset");
          setGuildId(null);
          setActivityInstanceId(null);
          setDiscordUserId(null);
          setLaunchMode("unavailable");
          return;
        }
        const discordSdk = new DiscordSDK(clientId);
        if (cancelled) return;
        await discordSdk.ready();
        if (cancelled) return;

        setActivityInstanceId(discordSdk.instanceId);

        // Available immediately post-ready, no OAuth needed — used to scope
        // the leaderboard to this server.
        setGuildId(discordSdk.guildId ?? null);

        // Which mode this player's session resolves to (/bitesweeper vs
        // /play — per player, via the identity cookie, so channel-mates can
        // play different games). Own try/catch: falling into the outer catch
        // would clobber the real guildId that was just set.
        try {
          const { mode } = await api.activityMode({
            instanceId: discordSdk.instanceId,
            channelId: discordSdk.channelId ?? null,
          });
          if (cancelled) return;
          setLaunchMode(mode === "mega" ? "mega" : "classic");
        } catch (e) {
          console.warn("Bitedle: activity mode lookup failed", e);
          setLaunchMode("unavailable");
        }

        // Fire-and-forget: links the real Discord identity for avatars. Never
        // awaited — a slow or declined consent prompt must not block anything.
        void linkDiscordIdentity(discordSdk, clientId).catch((e) => {
          console.warn("Bitedle: Discord identity link failed", e);
          setDiscordUserId(null);
        });
      } catch (e) {
        console.warn("Bitedle: Discord handshake failed", e);
        setGuildId(null);
        setActivityInstanceId(null);
        setDiscordUserId(null);
        setLaunchMode("unavailable");
      } finally {
        clearTimeout(timeout);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
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
  await api.discordIdentify({
    discordUserId: user.id,
    discordAvatar: user.avatar ?? null,
    discordName: user.global_name ?? user.username,
  });
  setDiscordUserId(user.id);
  // Game.tsx already fetched state before this (async, separate component)
  // finished — nudge it to refetch so the header picks up the synced name.
  window.dispatchEvent(new Event("bitedle:discord-identity-synced"));
}
