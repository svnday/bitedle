import { getGuildId } from "./discord-context";
import type { CellResult, GameState, Leaderboard, UserStats } from "./types";

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

/** True when running inside a Discord Activity iframe (Discord's reverse-proxy domain). */
function isDiscordEmbedded(): boolean {
  return typeof window !== "undefined" && window.location.hostname.endsWith(".discordsays.com");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Discord's Activity proxy blocks plain relative requests; they must be
  // routed through /.proxy. Never applied outside the Discord iframe.
  const embedded = isDiscordEmbedded();
  const url = embedded ? `/.proxy${path}` : path;
  const guildId = embedded ? getGuildId() : null;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(guildId ? { "X-Bitedle-Guild-Id": guildId } : {}),
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
  discordIdentify: (payload: { discordUserId: string; discordAvatar: string | null }) =>
    request<{ ok: true }>("/api/discord/identify", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
