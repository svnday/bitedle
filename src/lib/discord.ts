import type { NextRequest } from "next/server";

/** Header the client attaches (only when embedded in Discord) carrying the current guild id. */
export const GUILD_HEADER_NAME = "X-Bitedle-Guild-Id";

export const SNOWFLAKE_RE = /^\d{5,25}$/;

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
