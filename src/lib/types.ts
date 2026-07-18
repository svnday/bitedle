export type CellResult = "x" | "bomb" | "check";
export type GameStatus = "playing" | "won" | "lost";

export interface ClickRecord {
  index: number;
  result: CellResult;
}

export interface GameState {
  date: string;
  puzzleNumber: number;
  username: string;
  /** False while the player still has an auto-generated Player-xxxx name. */
  named: boolean;
  status: GameStatus;
  /** Number of non-bomb clicks it took to find the check (wins only). */
  score: number | null;
  clicks: ClickRecord[];
  /** Epoch ms when the next daily board drops (the game's reset timezone). */
  nextResetAt: number;
  /** The full board — only revealed once the game is finished. */
  layout?: CellResult[];
}

export interface GameRecord {
  clicks: ClickRecord[];
  status: GameStatus;
  score: number | null;
  finishedAt: number | null;
  /** Discord server this game was played in; null for web play. Set once at creation, immutable after. */
  guildId: string | null;
}

export interface UserStats {
  played: number;
  wins: number;
  winPct: number;
  currentStreak: number;
  maxStreak: number;
  bestScore: number | null;
  avgScore: number | null;
  /** Buckets: "1".."5", "6+", and "X" for losses. */
  distribution: Record<string, number>;
}

export interface TodayEntry {
  name: string;
  /** Discord avatar CDN URL, or null for web players / unlinked Discord players. */
  discordAvatarUrl: string | null;
  status: "won" | "lost";
  score: number | null;
  clicks: number;
  /** Ordered click positions, present only for finished Discord-guild viewers. */
  board?: ClickRecord[];
  /** Whether this row belongs to the requesting player (names aren't unique). */
  me: boolean;
}

export interface AllTimeEntry {
  name: string;
  /** Discord avatar CDN URL, or null for web players / unlinked Discord players. */
  discordAvatarUrl: string | null;
  played: number;
  wins: number;
  winPct: number;
  avgScore: number | null;
  bestScore: number | null;
  currentStreak: number;
  maxStreak: number;
  /** Whether this row belongs to the requesting player (names aren't unique). */
  me: boolean;
}

export interface Leaderboard {
  date: string;
  today: TodayEntry[];
  allTime: AllTimeEntry[];
  channelStats: UserStats;
}

export const BOARD_SIZE = 25;
export const MIN_BOMBS = 3;
export const MAX_BOMBS = 5;
export const DAILY_BOMB_COUNT = 3;
export const FIXED_BOMB_COUNT_FROM = "2026-07-19";
export const DISTRIBUTION_BUCKETS = ["1", "2", "3", "4", "5", "6+", "X"] as const;

export type GameMode = "classic" | "mega";
export type MegaCellResult = "bomb" | "check" | number;

export interface MegaClickRecord {
  index: number;
  result: MegaCellResult;
}

export interface MegaGameRecord {
  clicks: MegaClickRecord[];
  status: GameStatus;
  score: number | null;
  finishedAt: number | null;
}

export interface MegaGameState {
  date: string;
  puzzleNumber: number;
  username: string;
  named: boolean;
  status: GameStatus;
  score: number | null;
  clicks: MegaClickRecord[];
  nextResetAt: number;
  layout?: MegaCellResult[];
}

export const MEGA_BOARD_COLS = 10;
export const MEGA_BOARD_SIZE = 100;
export const MEGA_BOMB_COUNT = 12;
export const MEGA_DISTRIBUTION_BUCKETS = [
  "1-5",
  "6-10",
  "11-15",
  "16-20",
  "21-30",
  "31+",
  "X",
] as const;
