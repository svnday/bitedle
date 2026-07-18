import type {
  ClickRecord,
  GameRecord,
  GameStatus,
  MegaClickRecord,
  MegaGameRecord,
} from "./types";
import { FileStore } from "./store-file";
import { NeonStore } from "./store-neon";

/** A finished game, as needed for stats/streak computation. */
export interface FinishedGame {
  date: string;
  status: GameStatus;
  score: number | null;
}

/** A finished game on a given day, as needed for the daily leaderboard. */
export interface TodayRow<TClick = ClickRecord> {
  userId: string;
  name: string;
  discordUserId: string | null;
  discordAvatar: string | null;
  status: "won" | "lost";
  score: number | null;
  clicks: TClick[];
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

export interface LivePreviewRow {
  userId: string;
  name: string;
  discordUserId: string | null;
  discordAvatar: string | null;
  /** The puzzle this player is on — their local day, which can differ from
   *  the server day (and from other players in the same launch window). */
  date: string;
  status: GameStatus;
  score: number | null;
  clicks: ClickRecord[];
  finishedAt: number | null;
}

export interface UserInfo {
  name: string;
  /** True once the player has chosen a name (vs the auto-generated one). */
  named: boolean;
  /** Linked Discord identity, only present if the player authorized via a Discord Activity. */
  discordUserId: string | null;
  discordAvatar: string | null;
}


/** Sentinel stored as the live-preview messageId while a POST is in flight,
 *  so concurrent invocations neither double-post nor try to PATCH it. */
export const LIVE_PREVIEW_POSTING = "__posting__";

/**
 * The day's live-preview message for one guild, posted/edited via the
 * interaction webhook of whichever launch most recently minted it.
 */
export interface LivePreviewMessage {
  guildId: string;
  date: string;
  /** Webhook route: /webhooks/{applicationId}/{webhookToken}. */
  applicationId: string;
  webhookToken: string;
  /** Epoch ms the interaction token was received — valid for 15 minutes. */
  tokenCreatedAt: number;
  /** Null while the token is stored but no message has been posted yet
   *  (a launch lands before the launcher's game row exists). */
  messageId: string | null;
  updatedAt: number;
  /** Server day the guild's daily recap was last posted for — populated by
   *  getLivePreviewMessage as a read fast-path, never written by
   *  setLivePreviewMessage (only claim/releaseDailyRecap touch it). */
  recapPostedDate?: string | null;
}

export interface Store {
  /** The player for an id, or null if the id is unknown. */
  getUser(id: string): Promise<UserInfo | null>;
  createUser(id: string, name: string): Promise<void>;
  /** Sets a chosen display name (also marks the player as named). */
  setUserName(id: string, name: string): Promise<void>;
  /** Links a player's real Discord identity (for avatar display only). */
  setDiscordIdentity(userId: string, discordUserId: string, discordAvatar: string | null): Promise<void>;
  /** Reverse lookup (Discord interactions carry no Bitedle cookie). The
   *  oldest matching row wins — it is the canonical player for a Discord id. */
  getUserIdByDiscordId(discordUserId: string): Promise<string | null>;
  /**
   * Folds an orphan player into the canonical player for the same Discord
   * identity: transfers games the canonical player lacks, drops the orphan's
   * conflicting-date games, then anonymizes the orphan row (kept, never
   * deleted). Idempotent; re-run freely on every identify.
   */
  mergeUsers(fromUserId: string, toUserId: string): Promise<void>;
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
  getMegaGame(date: string, userId: string): Promise<MegaGameRecord | null>;
  /** Upserts while preserving finished-game immutability. */
  putMegaGame(date: string, userId: string, game: MegaGameRecord): Promise<void>;
  /** Replaces a finished XL game with a fresh playing board. */
  replayMegaGame(date: string, userId: string, boardSeed: string): Promise<boolean>;
  finishedMegaGamesFor(userId: string): Promise<FinishedGame[]>;
  finishedMegaGamesOn(date: string): Promise<TodayRow<MegaClickRecord>[]>;
  allFinishedMegaGames(): Promise<AllTimeRow[]>;
  /** Records the channel a server most recently used a command in. Nothing
   *  posts to it anymore (delivery rides interaction webhooks), but the call
   *  guarantees the guild_channels row exists before preview/recap updates
   *  touch it, and keeps a useful breadcrumb of where the app is used. */
  setGuildChannel(guildId: string, channelId: string): Promise<void>;
  /** Games for the guild's current live-preview window: everyone who opened
   *  the Activity at or after `sinceLaunchedAt` (the window's start), ordered
   *  launcher-first. Not filtered by day — a recent launch is by definition on
   *  the player's current board, so cross-timezone players are still included;
   *  each row's `date` says which board that is. */
  livePreviewGamesOn(guildId: string, sinceLaunchedAt: number): Promise<LivePreviewRow[]>;
  /** Records that a player opened the Activity at `at` — their launch time,
   *  used to scope the live preview to one ~13-minute window. */
  stampLaunch(date: string, userId: string, at: number): Promise<void>;
  getLivePreviewMessage(guildId: string, date: string): Promise<LivePreviewMessage | null>;
  setLivePreviewMessage(message: LivePreviewMessage): Promise<void>;
  /** Atomically claims the right to POST the day's preview message (null
   *  messageId → LIVE_PREVIEW_POSTING). False when another invocation already
   *  claimed or posted — launch, state, identify and click can all race
   *  within the same second on serverless. */
  claimLivePreviewPost(guildId: string, date: string): Promise<boolean>;
  /** Rolls a failed claim back so a later invocation can retry the POST. */
  releaseLivePreviewPost(guildId: string, date: string): Promise<void>;
  /** Forgets a message that no longer exists on Discord (deleted by a mod) —
   *  only if the stored id still matches, so concurrent 404s reset it once. */
  clearLivePreviewMessageId(guildId: string, date: string, messageId: string): Promise<void>;
  /** Atomically claims the right to post the guild's daily recap for `date`
   *  (the guild_channels row exists by the time this runs). False when
   *  another invocation already claimed or posted it today. */
  claimDailyRecap(guildId: string, date: string): Promise<boolean>;
  /** Rolls a failed recap POST back so a later activity retries today —
   *  guarded by date so a stale rollback can't clobber a next-day claim. */
  releaseDailyRecap(guildId: string, date: string): Promise<void>;
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
