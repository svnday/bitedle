import {
  discordIdentitySettled,
  getActivityInstanceId,
  getDiscordUserId,
  getGuildId,
  guildContextSettled,
  isDiscordEmbed,
} from "./discord-context";
import type {
  BiteracerGameState,
  BiteracerLeaderboard,
  BiteracerRaceState,
  BiteracerUserStats,
  BitesweeperPlayer,
  CellResult,
  GameMode,
  GameState,
  Leaderboard,
  MegaCellResult,
  MegaGameState,
  UserStats,
} from "./types";

const DISCORD_USER_HEADER_NAME = "X-Bitedle-Discord-User-Id";
const TZ_HEADER_NAME = "X-Bitedle-TZ";
const IDENTITY_BOOTSTRAP_PATHS = new Set([
  "/api/discord/token",
  "/api/discord/identify",
  // Fetched during the SDK handshake, before the identity link settles —
  // waiting on discordIdentitySettled() here would deadlock the boot.
  "/api/activity/mode",
]);
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
  state?: GameState | MegaGameState | BiteracerGameState;

  constructor(
    message: string,
    status: number,
    state?: GameState | MegaGameState | BiteracerGameState,
  ) {
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
  if (embedded && path === "/api/activity/mode") {
    discordUserId = getDiscordUserId();
  } else if (embedded && !IDENTITY_BOOTSTRAP_PATHS.has(path)) {
    await discordIdentitySettled();
    discordUserId = getDiscordUserId();
    if (!discordUserId && guildId && IDENTITY_REQUIRED_PATHS.has(path)) {
      throw new ApiError("Couldn't link your Discord identity. Close Bitedle and launch it again.", 428);
    }
  }
  const tz = localTimeZone();
  const activityInstanceId = embedded ? getActivityInstanceId() : null;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(guildId ? { "X-Bitedle-Guild-Id": guildId } : {}),
      ...(discordUserId ? { [DISCORD_USER_HEADER_NAME]: discordUserId } : {}),
      ...(activityInstanceId
        ? { "X-Bitedle-Activity-Instance-Id": activityInstanceId }
        : {}),
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
  megaState: () => request<MegaGameState>("/api/mega/state"),
  megaClick: (index: number) =>
    request<{ result: MegaCellResult; state: MegaGameState }>("/api/mega/click", {
      method: "POST",
      body: JSON.stringify({ index }),
    }),
  megaFlag: (index: number) =>
    request<MegaGameState>("/api/mega/flag", {
      method: "POST",
      body: JSON.stringify({ index }),
    }),
  megaReplay: () =>
    request<MegaGameState>("/api/mega/replay", {
      method: "POST",
    }),
  bitesweeperPlayers: () => request<{ players: BitesweeperPlayer[] }>("/api/mega/players"),
  activityMode: (payload: { instanceId: string; channelId: string | null }) =>
    request<{ mode: GameMode; raceId?: string }>("/api/activity/mode", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
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
  biteracerState: () => request<BiteracerGameState>("/api/biteracer/state"),
  biteracerStart: () =>
    request<BiteracerGameState>("/api/biteracer/start", { method: "POST" }),
  biteracerFinish: (typedText: string) =>
    request<BiteracerGameState>("/api/biteracer/finish", {
      method: "POST",
      body: JSON.stringify({ typedText }),
    }),
  biteracerLeaderboard: () => request<BiteracerLeaderboard>("/api/biteracer/leaderboard"),
  biteracerStats: () => request<BiteracerUserStats>("/api/biteracer/stats"),
  biteracerRaceState: (raceId: string) =>
    request<BiteracerRaceState>(`/api/biteracer/race?raceId=${encodeURIComponent(raceId)}`),
  biteracerRaceAction: (
    raceId: string,
    action: "ready" | "progress" | "finish" | "rematch",
    payload: Record<string, unknown> = {},
  ) =>
    request<BiteracerRaceState>("/api/biteracer/race", {
      method: "POST",
      body: JSON.stringify({ raceId, action, ...payload }),
    }),
};
