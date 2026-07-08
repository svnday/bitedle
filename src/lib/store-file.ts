import fs from "node:fs";
import path from "node:path";
import type { GameRecord } from "./types";
import type {
  AllTimeRow,
  FinishedGame,
  GuildChannel,
  LivePreviewMessage,
  LivePreviewRow,
  Store,
  TodayRow,
  UserInfo,
} from "./store";

interface FileDb {
  users: Record<
    string,
    {
      name: string;
      createdAt: number;
      named?: boolean;
      discordUserId?: string | null;
      discordAvatar?: string | null;
    }
  >;
  /** games[date][userId] */
  games: Record<string, Record<string, GameRecord>>;
  /** guildChannels[guildId] — auto-detected daily-summary target channel. */
  guildChannels: Record<
    string,
    {
      channelId: string;
      updatedAt: number;
      lastPreviewAt?: number;
      livePreviewDate?: string;
      livePreviewChannelId?: string;
      livePreviewMessageId?: string;
      livePreviewUpdatedAt?: number;
    }
  >;
}

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

/**
 * Local-development storage: one JSON file, loaded once and rewritten on every
 * mutation. Not for production — serverless filesystems are ephemeral, which
 * is why getStore() requires DATABASE_URL there.
 */
export class FileStore implements Store {
  private db: FileDb;

  constructor() {
    this.db = this.load();
  }

  private load(): FileDb {
    try {
      const raw = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
      if (raw && typeof raw === "object" && raw.users && raw.games) {
        // guildChannels didn't exist in files written before this feature.
        return { users: raw.users, games: raw.games, guildChannels: raw.guildChannels ?? {} };
      }
    } catch {
      // Missing or corrupt file — start fresh.
    }
    return { users: {}, games: {}, guildChannels: {} };
  }

  private persist(): void {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2), "utf8");
    fs.renameSync(tmp, DB_PATH);
  }

  async getUser(id: string): Promise<UserInfo | null> {
    const u = this.db.users[id];
    return u
      ? {
          name: u.name,
          named: !!u.named,
          discordUserId: u.discordUserId ?? null,
          discordAvatar: u.discordAvatar ?? null,
        }
      : null;
  }

  async createUser(id: string, name: string): Promise<void> {
    if (!this.db.users[id]) {
      this.db.users[id] = { name, createdAt: Date.now(), named: false };
      this.persist();
    }
  }

  async setUserName(id: string, name: string): Promise<void> {
    if (this.db.users[id]) {
      this.db.users[id].name = name;
      this.db.users[id].named = true;
      this.persist();
    }
  }

  async setDiscordIdentity(
    userId: string,
    discordUserId: string,
    discordAvatar: string | null,
  ): Promise<void> {
    if (this.db.users[userId]) {
      this.db.users[userId].discordUserId = discordUserId;
      this.db.users[userId].discordAvatar = discordAvatar;
      this.persist();
    }
  }

  async getUserIdByDiscordId(discordUserId: string): Promise<string | null> {
    for (const [id, u] of Object.entries(this.db.users)) {
      if (u.discordUserId === discordUserId) return id;
    }
    return null;
  }

  async getGame(date: string, userId: string): Promise<GameRecord | null> {
    const g = this.db.games[date]?.[userId];
    // Deep-copy so callers can't mutate stored state without putGame.
    return g ? (JSON.parse(JSON.stringify(g)) as GameRecord) : null;
  }

  async putGame(date: string, userId: string, game: GameRecord): Promise<void> {
    const byUser = (this.db.games[date] ??= {});
    const existing = byUser[userId];
    if (existing && existing.status !== "playing") return;
    // guildId is set once, at creation — a full-object replace here would
    // otherwise let a later call silently overwrite it.
    byUser[userId] = { ...game, guildId: existing ? existing.guildId : game.guildId };
    this.persist();
  }

  async finishedGamesFor(userId: string): Promise<FinishedGame[]> {
    const out: FinishedGame[] = [];
    for (const [date, byUser] of Object.entries(this.db.games)) {
      const g = byUser[userId];
      if (g && g.status !== "playing") out.push({ date, status: g.status, score: g.score });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  async finishedGamesOn(date: string, guildId: string | null): Promise<TodayRow[]> {
    const out: TodayRow[] = [];
    for (const [userId, g] of Object.entries(this.db.games[date] ?? {})) {
      const user = this.db.users[userId];
      if (g.status === "playing" || !user?.named) continue;
      if ((g.guildId ?? null) !== guildId) continue;
      out.push({
        userId,
        name: user.name,
        discordUserId: user.discordUserId ?? null,
        discordAvatar: user.discordAvatar ?? null,
        status: g.status,
        score: g.score,
        clickCount: g.clicks.length,
        finishedAt: g.finishedAt ?? 0,
      });
    }
    return out;
  }

  async allFinishedGames(guildId: string | null): Promise<AllTimeRow[]> {
    const out: AllTimeRow[] = [];
    for (const [date, byUser] of Object.entries(this.db.games)) {
      for (const [userId, g] of Object.entries(byUser)) {
        const user = this.db.users[userId];
        if (g.status === "playing" || !user?.named) continue;
        if ((g.guildId ?? null) !== guildId) continue;
        out.push({
          userId,
          name: user.name,
          discordUserId: user.discordUserId ?? null,
          discordAvatar: user.discordAvatar ?? null,
          date,
          status: g.status,
          score: g.score,
        });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  async setGuildChannel(guildId: string, channelId: string): Promise<void> {
    const existing = this.db.guildChannels[guildId];
    this.db.guildChannels[guildId] = {
      ...(existing ?? {}),
      channelId,
      updatedAt: Date.now(),
    };
    this.persist();
  }

  async getGuildChannel(guildId: string): Promise<GuildChannel | null> {
    const channel = this.db.guildChannels[guildId];
    return channel ? { guildId, channelId: channel.channelId } : null;
  }

  async allGuildChannels(): Promise<GuildChannel[]> {
    return Object.entries(this.db.guildChannels).map(([guildId, v]) => ({
      guildId,
      channelId: v.channelId,
    }));
  }

  async getLastPreviewAt(guildId: string): Promise<number> {
    return this.db.guildChannels[guildId]?.lastPreviewAt ?? 0;
  }

  async setLastPreviewAt(guildId: string, at: number): Promise<void> {
    const existing = this.db.guildChannels[guildId];
    if (existing) existing.lastPreviewAt = at;
    else this.db.guildChannels[guildId] = { channelId: "", updatedAt: Date.now(), lastPreviewAt: at };
    this.persist();
  }

  async livePreviewGamesOn(date: string, guildId: string): Promise<LivePreviewRow[]> {
    const out: LivePreviewRow[] = [];
    for (const [userId, g] of Object.entries(this.db.games[date] ?? {})) {
      if ((g.guildId ?? null) !== guildId) continue;
      const user = this.db.users[userId];
      if (!user) continue;
      out.push({
        userId,
        name: user.name,
        discordUserId: user.discordUserId ?? null,
        discordAvatar: user.discordAvatar ?? null,
        status: g.status,
        score: g.score,
        clicks: g.clicks,
        finishedAt: g.finishedAt,
      });
    }
    return out.sort((a, b) => {
      if (a.status !== b.status) return a.status === "playing" ? -1 : 1;
      if (a.clicks.length !== b.clicks.length) return b.clicks.length - a.clicks.length;
      return (a.finishedAt ?? Number.MAX_SAFE_INTEGER) - (b.finishedAt ?? Number.MAX_SAFE_INTEGER);
    });
  }

  async getLivePreviewMessage(guildId: string, date: string): Promise<LivePreviewMessage | null> {
    const channel = this.db.guildChannels[guildId];
    if (
      !channel ||
      channel.livePreviewDate !== date ||
      !channel.livePreviewChannelId ||
      !channel.livePreviewMessageId
    ) {
      return null;
    }
    return {
      guildId,
      date,
      channelId: channel.livePreviewChannelId,
      messageId: channel.livePreviewMessageId,
      updatedAt: channel.livePreviewUpdatedAt ?? 0,
    };
  }

  async setLivePreviewMessage(message: LivePreviewMessage): Promise<void> {
    const existing = this.db.guildChannels[message.guildId];
    this.db.guildChannels[message.guildId] = {
      ...(existing ?? {}),
      channelId: existing?.channelId ?? message.channelId,
      updatedAt: existing?.updatedAt ?? Date.now(),
      livePreviewDate: message.date,
      livePreviewChannelId: message.channelId,
      livePreviewMessageId: message.messageId,
      livePreviewUpdatedAt: message.updatedAt,
    };
    this.persist();
  }
}
