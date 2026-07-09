import type { NextRequest } from "next/server";

/** Header the client attaches (only when embedded in Discord) carrying the current guild id. */
export const GUILD_HEADER_NAME = "X-Bitedle-Guild-Id";
/** Header the Discord Activity client attaches after SDK auth, as a fallback when mobile drops cookies. */
export const DISCORD_USER_HEADER_NAME = "X-Bitedle-Discord-User-Id";

export const SNOWFLAKE_RE = /^\d{5,25}$/;

/**
 * Discord user IDs barred from Bitedle, from the BITEDLE_BLOCKED_DISCORD_IDS
 * env var (comma/whitespace-separated snowflakes). Parsed once at module load
 * — a redeploy/restart picks up changes. Malformed entries are ignored.
 */
const BLOCKED_DISCORD_IDS = new Set(
  (process.env.BITEDLE_BLOCKED_DISCORD_IDS ?? "")
    .split(/[\s,]+/)
    .filter((id) => SNOWFLAKE_RE.test(id)),
);

/** True if this Discord user is on the blocklist (never for null/empty). */
export function isBlockedDiscordId(id: string | null | undefined): boolean {
  return typeof id === "string" && BLOCKED_DISCORD_IDS.has(id);
}

export function guildIdFromRequest(request: NextRequest): string | null {
  const raw = request.headers.get(GUILD_HEADER_NAME);
  return raw && SNOWFLAKE_RE.test(raw) ? raw : null;
}

/** Discord CDN avatar URL, or the deterministic default-avatar fallback. */
export function discordAvatarUrl(discordUserId: string | null, discordAvatar: string | null): string | null {
  if (!discordUserId) return null;
  if (discordAvatar) return `https://cdn.discordapp.com/avatars/${discordUserId}/${discordAvatar}.png`;
  // Default-avatar fallback for the modern (discriminator-less) username
  // system. Snowflake IDs exceed JS's safe integer range, so this needs
  // BigInt — BigInt() calls rather than `22n` literals, since this repo
  // targets ES2017.
  const index = Number((BigInt(discordUserId) >> BigInt(22)) % BigInt(6));
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}
