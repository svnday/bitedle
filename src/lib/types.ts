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
  /** Hidden cells the player marked as possible bombs. */
  flags: number[];
  status: GameStatus;
  score: number | null;
  finishedAt: number | null;
  /** Null for original daily boards; random per replayed Bitesweeper board. */
  boardSeed: string | null;
  /** Discord Activity that owns this private board; null for plain web play. */
  activityInstanceId: string | null;
}

export interface MegaGameState {
  date: string;
  username: string;
  named: boolean;
  status: GameStatus;
  score: number | null;
  clicks: MegaClickRecord[];
  flags: number[];
  livesRemaining: number;
  nextResetAt: number;
  layout?: MegaCellResult[];
}

/** Another Discord participant currently connected to this Bitesweeper Activity. */
export interface BitesweeperPlayer {
  name: string;
  discordAvatarUrl: string | null;
  status: GameStatus;
  score: number | null;
  clicks: MegaClickRecord[];
  flags: number[];
  livesRemaining: number;
}

export const MEGA_BOARD_COLS = 10;
export const MEGA_BOARD_SIZE = 100;
export const MEGA_BOMB_COUNT = 12;
export const MEGA_STARTING_LIVES = 3;
export const MEGA_SAFE_CELL_COUNT = MEGA_BOARD_SIZE - MEGA_BOMB_COUNT - 1;
