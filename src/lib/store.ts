import type {
  ClickRecord,
  GameMode,
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

export interface BitesweeperPlayerRow {
  userId: string;
  name: string;
  discordUserId: string | null;
  discordAvatar: string | null;
  status: GameStatus;
  score: number | null;
  clicks: MegaClickRecord[];
  seenAt: number;
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
   * identity: transfers games and launch records the canonical player lacks,
   * drops the orphan's conflicting ones, then anonymizes the orphan row
   * (kept, never deleted). Idempotent; re-run freely on every identify.
   */
  mergeUsers(fromUserId: string, toUserId: string): Promise<void>;
  getGame(date: string, userId: string): Promise<GameRecord | null>;
  /** Upserts; must never overwrite a game that is already finished, and must
   *  never change guildId once a game row exists (set once, at creation —
   *  it's only a first-guild/web marker; guild membership lives in the
   *  per-day launch records, see recordLaunch). */
  putGame(date: string, userId: string, game: GameRecord): Promise<void>;
  /** Every finished game for one player (their private stats) — cross-guild. */
  finishedGamesFor(userId: string): Promise<FinishedGame[]>;
  /** Leaderboard feed: finished games on a date, NAMED players only. A guild
   *  id means "players who launched in that guild that day" (a multi-server
   *  player appears in every such guild); null = web-only games. */
  finishedGamesOn(date: string, guildId: string | null): Promise<TodayRow[]>;
  /** Leaderboard feed: all finished games, NAMED players only. Guild scoping
   *  as in finishedGamesOn (launch membership; null = web-only games). */
  allFinishedGames(guildId: string | null): Promise<AllTimeRow[]>;
  getMegaGame(date: string, userId: string): Promise<MegaGameRecord | null>;
  /** Upserts while preserving finished-game immutability. */
  putMegaGame(date: string, userId: string, game: MegaGameRecord): Promise<void>;
  /** Replaces a finished Bitesweeper game with a fresh playing board. */
  replayMegaGame(date: string, userId: string, boardSeed: string): Promise<boolean>;
  /** Refreshes a player's membership in one running Bitesweeper Activity. */
  recordBitesweeperPresence(
    instanceId: string,
    date: string,
    userId: string,
    at: number,
  ): Promise<void>;
  /** Active players and their current boards in this exact Activity instance. */
  bitesweeperPlayers(
    instanceId: string,
    activeSince: number,
  ): Promise<BitesweeperPlayerRow[]>;
  /** Records a /bitesweeper launch in a channel. The next unbound Activity
   *  instance that boots from this channel claims Bitesweeper mode. Upserts. */
  markBitesweeperLaunch(channelId: string, at: number): Promise<void>;
  /** Resolves and permanently binds an Activity instance's mode. The marker
   *  claim and first binding are one atomic operation, so simultaneous
   *  participants cannot race a Bitesweeper launch back to Classic. */
  resolveActivityMode(
    instanceId: string,
    channelId: string | null,
    freshMarkerSince: number,
  ): Promise<GameMode>;
  /** Records the channel a server most recently used a command in. Nothing
   *  posts to it anymore (delivery rides interaction webhooks), but the call
   *  guarantees the guild_channels row exists before preview/recap updates
   *  touch it, and keeps a useful breadcrumb of where the app is used. */
  setGuildChannel(guildId: string, channelId: string): Promise<void>;
  /** Games for the guild's current live-preview window: everyone who opened
   *  the Activity IN THIS GUILD at or after `sinceLaunchedAt` (the window's
   *  start), ordered launcher-first by that guild's launch time. Not filtered
   *  by day — a recent launch is by definition on the player's current board,
   *  so cross-timezone players are still included; each row's `date` says
   *  which board that is. */
  livePreviewGamesOn(guildId: string, sinceLaunchedAt: number): Promise<LivePreviewRow[]>;
  /** Records that a player opened the Activity in a guild at `at`. Upserts —
   *  relaunching the same guild the same day just refreshes the launch time,
   *  which scopes that guild's live preview to one ~13-minute window. */
  recordLaunch(date: string, userId: string, guildId: string, at: number): Promise<void>;
  /** Guilds the player launched in on `date`, earliest launch first — the
   *  fan-out list for live-preview refreshes after a click. */
  launchGuildsFor(date: string, userId: string): Promise<string[]>;
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
    const forceFileStore = process.env.BITEDLE_FORCE_FILE_STORE === "1";
    if (forceFileStore && process.env.NODE_ENV === "production") {
      throw new Error("BITEDLE_FORCE_FILE_STORE must never be enabled in production");
    }

    const url = forceFileStore ? null : process.env.DATABASE_URL;
    if (url) {
      globalStore.__bitedleStore = new NeonStore(url);
    } else {
      if (process.env.NODE_ENV === "production") {
        throw new Error("DATABASE_URL must be set in production (Neon/Postgres connection string)");
      }
      console.warn(
        forceFileStore
          ? "Bitedle: BITEDLE_FORCE_FILE_STORE=1 — using isolated local JSON storage"
          : "Bitedle: DATABASE_URL not set — using local JSON file storage (data/db.json)",
      );
      globalStore.__bitedleStore = new FileStore();
    }
  }
  return globalStore.__bitedleStore;
}
