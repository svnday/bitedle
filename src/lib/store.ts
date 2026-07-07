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
  status: "won" | "lost";
  score: number | null;
  clickCount: number;
  finishedAt: number;
}

/** A finished game with its player, for the all-time leaderboard. */
export interface AllTimeRow extends FinishedGame {
  userId: string;
  name: string;
}

export interface Store {
  /** Display name for a player id, or null if the id is unknown. */
  getUserName(id: string): Promise<string | null>;
  createUser(id: string, name: string): Promise<void>;
  setUserName(id: string, name: string): Promise<void>;
  getGame(date: string, userId: string): Promise<GameRecord | null>;
  /** Upserts; must never overwrite a game that is already finished. */
  putGame(date: string, userId: string, game: GameRecord): Promise<void>;
  finishedGamesFor(userId: string): Promise<FinishedGame[]>;
  finishedGamesOn(date: string): Promise<TodayRow[]>;
  allFinishedGames(): Promise<AllTimeRow[]>;
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
