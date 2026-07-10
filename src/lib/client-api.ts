import {
  discordIdentitySettled,
  getDiscordUserId,
  getGuildId,
  guildContextSettled,
  isDiscordEmbed,
} from "./discord-context";
import type { CellResult, GameState, Leaderboard, UserStats } from "./types";

const DISCORD_USER_HEADER_NAME = "X-Bitedle-Discord-User-Id";
const TZ_HEADER_NAME = "X-Bitedle-TZ";
const IDENTITY_BOOTSTRAP_PATHS = new Set(["/api/discord/token", "/api/discord/identify"]);
const IDENTITY_REQUIRED_PATHS = new Set(["/api/state", "/api/click"]);

/** The player's IANA timezone, so the server can roll their board at their own
 *  local midnight (Wordle-style). Resolved once; empty string if unavailable. */
function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

export class ApiError extends Error {
  status: number;
  /** Some errors (e.g. "already played") include the authoritative state. */
  state?: GameState;

  constructor(message: string, status: number, state?: GameState) {
    super(message);
    this.status = status;
    this.state = state;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const embedded = isDiscordEmbed();
  // Wait for DiscordBootstrap's handshake to settle before reading guildId —
  // otherwise a request fired before setGuildId() runs would silently omit
  // the header and get scoped as a plain web game (permanently, for /click).
  if (embedded) {
    await guildContextSettled();
  }
  // Discord's Activity proxy blocks plain relative requests; they must be
  // routed through /.proxy. Never applied outside the Discord iframe.
  const url = embedded ? `/.proxy${path}` : path;
  const guildId = embedded ? getGuildId() : null;
  let discordUserId: string | null = null;
  if (embedded && guildId && !IDENTITY_BOOTSTRAP_PATHS.has(path)) {
    await discordIdentitySettled();
    discordUserId = getDiscordUserId();
    if (!discordUserId && IDENTITY_REQUIRED_PATHS.has(path)) {
      throw new ApiError("Couldn't link your Discord identity. Close Bitedle and launch it again.", 428);
    }
  }
  const tz = localTimeZone();
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(guildId ? { "X-Bitedle-Guild-Id": guildId } : {}),
      ...(discordUserId ? { [DISCORD_USER_HEADER_NAME]: discordUserId } : {}),
      ...(tz ? { [TZ_HEADER_NAME]: tz } : {}),
      ...init?.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data.state);
  }
  return data as T;
}

export const api = {
  setName: (name: string) =>
    request<{ username: string }>("/api/name", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  state: () => request<GameState>("/api/state"),
  click: (index: number) =>
    request<{ result: CellResult; state: GameState }>("/api/click", {
      method: "POST",
      body: JSON.stringify({ index }),
    }),
  stats: () => request<UserStats>("/api/stats"),
  leaderboard: () => request<Leaderboard>("/api/leaderboard"),
  discordToken: (code: string) =>
    request<{ access_token: string }>("/api/discord/token", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  discordIdentify: (payload: { discordUserId: string; discordAvatar: string | null; discordName: string }) =>
    request<{ ok: true }>("/api/discord/identify", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
