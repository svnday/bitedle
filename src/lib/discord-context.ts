/**
 * Bridge between DiscordBootstrap (writer, once the SDK is ready) and
 * client-api.ts (reader, attaches this to outgoing requests). Browser-only,
 * module-level — deliberately not React state, since nothing needs to
 * re-render when this changes.
 */
let guildId: string | null = null;

export function setGuildId(id: string | null): void {
  guildId = id;
}

export function getGuildId(): string | null {
  return guildId;
}

/** True when running inside Discord's Activity iframe (vs. plain web play). */
export function isDiscordEmbed(): boolean {
  return typeof window !== "undefined" && window.location.hostname.endsWith(".discordsays.com");
}
