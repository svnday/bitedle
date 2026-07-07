import type { GameRecord, GameStatus } from "./types";
import { FileStore } from "./store-file";
import { NeonStore } from "./store-neon";

/** A finished game, as needed for stats/streak computation. */
export interface FinishedGame {
  date: string;
  status: GameStatus;
  score: number | null;
}

/** A finished game on a given day, as needed for the daily leaderboard. */
export interface TodayRow {
  userId: string;
  name: string;
  discordUserId: string | null;
  discordAvatar: string | null;
  status: "won" | "lost";
  score: number | null;
  clickCount: number;
  finishedAt: number;
}

/** A finished game with its player, for the all-time leaderboard. */
export interface AllTimeRow extends FinishedGame {
  userId: string;
  name: string;
  discordUserId: string | null;
  discordAvatar: string | null;
}

export interface UserInfo {
  name: string;
  /** True once the player has chosen a name (vs the auto-generated one). */
  named: boolean;
  /** Linked Discord identity, only present if the player authorized via a Discord Activity. */
  discordUserId: string | null;
  discordAvatar: string | null;
}

export interface Store {
  /** The player for an id, or null if the id is unknown. */
  getUser(id: string): Promise<UserInfo | null>;
  createUser(id: string, name: string): Promise<void>;
  /** Sets a chosen display name (also marks the player as named). */
  setUserName(id: string, name: string): Promise<void>;
  /** Links a player's real Discord identity (for avatar display only). */
  setDiscordIdentity(userId: string, discordUserId: string, discordAvatar: string | null): Promise<void>;
  /** Reverse lookup: a Discord interaction only carries the caller's Discord id, not a Bitedle cookie. */
  getUserIdByDiscordId(discordUserId: string): Promise<string | null>;
  getGame(date: string, userId: string): Promise<GameRecord | null>;
  /** Upserts; must never overwrite a game that is already finished, and must
   *  never change guildId once a game row exists (set once, at creation). */
  putGame(date: string, userId: string, game: GameRecord): Promise<void>;
  /** Every finished game for one player (their private stats) — cross-guild. */
  finishedGamesFor(userId: string): Promise<FinishedGame[]>;
  /** Leaderboard feed: finished games on a date, NAMED players only, scoped
   *  to one guild (null = web-only games). */
  finishedGamesOn(date: string, guildId: string | null): Promise<TodayRow[]>;
  /** Leaderboard feed: all finished games, NAMED players only, scoped to one
   *  guild (null = web-only games). */
  allFinishedGames(guildId: string | null): Promise<AllTimeRow[]>;
}

// Cached on globalThis so dev HMR reloads keep one instance per process.
const globalStore = globalThis as unknown as { __bitedleStore?: Store };

export function getStore(): Store {
  if (!globalStore.__bitedleStore) {
    const url = process.env.DATABASE_URL;
    if (url) {
      globalStore.__bitedleStore = new NeonStore(url);
    } else {
      if (process.env.NODE_ENV === "production") {
        throw new Error("DATABASE_URL must be set in production (Neon/Postgres connection string)");
      }
      console.warn("Bitedle: DATABASE_URL not set — using local JSON file storage (data/db.json)");
      globalStore.__bitedleStore = new FileStore();
    }
  }
  return globalStore.__bitedleStore;
}
