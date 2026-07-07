"use client";

import { useEffect } from "react";

/**
 * Handshakes with the Discord client when Bitedle is loaded as a Discord
 * Activity (an iframe served through Discord's reverse proxy at
 * *.discordsays.com). Outside that context this renders nothing and never
 * imports the SDK, so normal web play at bitedle.vercel.app is unaffected.
 */
export default function DiscordBootstrap() {
  useEffect(() => {
    if (!window.location.hostname.endsWith(".discordsays.com")) return;

    let cancelled = false;
    (async () => {
      const { DiscordSDK, patchUrlMappings } = await import("@discord/embedded-app-sdk");
      const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
      if (!clientId) {
        console.warn("Bitedle: running inside Discord but NEXT_PUBLIC_DISCORD_CLIENT_ID is unset");
        return;
      }
      // Allow-lists the hotlinked win/lose GIFs so they load through Discord's proxy.
      // patchSrcAttributes defaults to false — without it, only fetch/WebSocket/XHR
      // get rewritten, and the <img> tags' requests are left blocked by Discord's CSP.
      patchUrlMappings([{ prefix: "/tenor", target: "media1.tenor.com" }], {
        patchSrcAttributes: true,
      });
      const discordSdk = new DiscordSDK(clientId);
      if (!cancelled) await discordSdk.ready();
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
