import type { ClickRecord, GameRecord, GameStatus } from "./types";
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

export interface LivePreviewRow {
  userId: string;
  name: string;
  discordUserId: string | null;
  discordAvatar: string | null;
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

/** A Discord server's auto-detected daily-summary target channel. */
export interface GuildChannel {
  guildId: string;
  channelId: string;
}

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
  /** Records/updates which channel to post a server's daily summary into —
   *  captured automatically from inbound slash-command interactions
   *  (channel_id), never configured manually. Last-used-wins. */
  setGuildChannel(guildId: string, channelId: string): Promise<void>;
  getGuildChannel(guildId: string): Promise<GuildChannel | null>;
  /** Every registered guild→channel pair, for the daily summary cron to loop over. */
  allGuildChannels(): Promise<GuildChannel[]>;
  livePreviewGamesOn(date: string, guildId: string): Promise<LivePreviewRow[]>;
  getLivePreviewMessage(guildId: string, date: string): Promise<LivePreviewMessage | null>;
  setLivePreviewMessage(message: LivePreviewMessage): Promise<void>;
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
