import type { NextRequest } from "next/server";
import { clampToUtcDayWindow, gameTimeZone, todayStr } from "./time";

/** Header the client attaches (only when embedded in Discord) carrying the current guild id. */
export const GUILD_HEADER_NAME = "X-Bitedle-Guild-Id";
/** Header the Discord Activity client attaches after SDK auth, as a fallback when mobile drops cookies. */
export const DISCORD_USER_HEADER_NAME = "X-Bitedle-Discord-User-Id";
/** Header carrying the player's IANA timezone, for a local-midnight board reset. */
export const TZ_HEADER_NAME = "X-Bitedle-TZ";
/** Header carrying the current Discord Activity instance for Bitesweeper presence. */
export const ACTIVITY_INSTANCE_HEADER_NAME = "X-Bitedle-Activity-Instance-Id";

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

export function activityInstanceIdFromRequest(request: NextRequest): string | null {
  const raw = request.headers.get(ACTIVITY_INSTANCE_HEADER_NAME);
  return raw && /^[A-Za-z0-9_-]{1,128}$/.test(raw) ? raw : null;
}

/**
 * The player's IANA timezone from the request header, or the game's default
 * when absent/invalid. Validated by asking Intl to build a formatter for it —
 * an unknown zone throws, so only real zones (offsets ≤ ±14h) get through.
 */
export function playerTimeZone(request: NextRequest): string {
  const raw = request.headers.get(TZ_HEADER_NAME);
  if (!raw) return gameTimeZone();
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: raw });
    return raw;
  } catch {
    return gameTimeZone();
  }
}

/**
 * The player's current day (YYYY-MM-DD) for board/leaderboard/stats scoping,
 * from their timezone and clamped to ±1 of the UTC date. This is the key the
 * daily board rolls on — at the player's own local midnight.
 */
export function playerDate(request: NextRequest, now: Date = new Date()): string {
  return clampToUtcDayWindow(todayStr(now, playerTimeZone(request)), now);
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
