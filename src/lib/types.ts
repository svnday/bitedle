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

export type GameMode = "classic" | "mega" | "biteracer";
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
}

export const MEGA_BOARD_COLS = 10;
export const MEGA_BOARD_SIZE = 100;
export const MEGA_BOMB_COUNT = 12;

export type BiteracerStatus = "playing" | "finished";

/** One curated excerpt, bundled statically (see biteracer-passages.ts). */
export interface BiteracerPassage {
  id: string;
  book: string;
  author: string;
  text: string;
}

/** Final scoring for one finished run — net (accuracy-adjusted) WPM is the ranking metric. */
export interface BiteracerResult {
  netWpm: number;
  rawWpm: number;
  /** 0-100, one decimal. */
  accuracy: number;
  elapsedMs: number;
  correctChars: number;
  errorCount: number;
}

/** Persisted row shape, mirroring GameRecord/MegaGameRecord. */
export interface BiteracerGameRecord {
  passageId: string;
  /** Epoch ms — the authoritative clock start, set once by /api/biteracer/start. */
  startedAt: number;
  finishedAt: number | null;
  status: BiteracerStatus;
  netWpm: number | null;
  rawWpm: number | null;
  accuracy: number | null;
  elapsedMs: number | null;
  correctChars: number | null;
  errorCount: number | null;
  /** Reserved for future Discord parity; always null while website-only. */
  guildId: string | null;
}

/** Client-facing state — passage is always included (nothing to hide, unlike Bitedle's board). */
export interface BiteracerGameState {
  date: string;
  passageNumber: number;
  status: BiteracerStatus;
  username: string;
  named: boolean;
  passage: BiteracerPassage;
  /** Null until the player's first keystroke calls /api/biteracer/start. */
  startedAt: number | null;
  nextResetAt: number;
  result: BiteracerResult | null;
}

export interface BiteracerTodayEntry {
  name: string;
  discordAvatarUrl: string | null;
  netWpm: number;
  rawWpm: number;
  accuracy: number;
  elapsedMs: number;
  me: boolean;
}

export interface BiteracerAllTimeEntry {
  name: string;
  discordAvatarUrl: string | null;
  gamesPlayed: number;
  avgNetWpm: number;
  bestNetWpm: number;
  currentStreak: number;
  maxStreak: number;
  me: boolean;
}

export interface BiteracerLeaderboard {
  date: string;
  today: BiteracerTodayEntry[];
  allTime: BiteracerAllTimeEntry[];
}

export interface BiteracerUserStats {
  played: number;
  avgNetWpm: number | null;
  bestNetWpm: number | null;
  avgAccuracy: number | null;
  currentStreak: number;
  maxStreak: number;
}

export type BiteracerRaceStatus =
  | "pending"
  | "accepted"
  | "countdown"
  | "racing"
  | "finished"
  | "declined"
  | "cancelled"
  | "expired";

export interface BiteracerRacePlayer {
  discordUserId: string;
  userId: string | null;
  name: string;
  discordAvatarUrl: string | null;
  readyAt: number | null;
  progress: number;
  correctChars: number;
  errorCount: number;
  sequence: number;
  lastUpdateAt: number | null;
  finishedAt: number | null;
  result: BiteracerResult | null;
}

/** Persisted shared 1v1 race. Daily Biteracer rows remain completely separate. */
export interface BiteracerRaceRecord {
  id: string;
  guildId: string | null;
  channelId: string | null;
  passage: BiteracerPassage;
  status: BiteracerRaceStatus;
  createdAt: number;
  acceptedAt: number | null;
  countdownAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  winnerDiscordUserId: string | null;
  rematchOf: string | null;
  preview: {
    applicationId: string;
    webhookToken: string;
    tokenCreatedAt: number;
  } | null;
  players: [BiteracerRacePlayer, BiteracerRacePlayer];
}

export interface BiteracerRaceState extends BiteracerRaceRecord {
  meDiscordUserId: string;
  serverNow: number;
}

export interface BiteracerRaceLeaderboardEntry {
  discordUserId: string;
  name: string;
  discordAvatarUrl: string | null;
  wins: number;
  losses: number;
  races: number;
  winPct: number;
  me: boolean;
}
