import fs from "node:fs";
import path from "node:path";
import type { BiteracerGameRecord, GameMode, GameRecord, MegaGameRecord } from "./types";
import {
  LIVE_PREVIEW_POSTING,
  type AllTimeRow,
  type BiteracerAllTimeRow,
  type BiteracerTodayRow,
  type BitesweeperPlayerRow,
  type BitesweeperPreviewMessage,
  type FinishedBiteracerGame,
  type FinishedGame,
  type LivePreviewMessage,
  type LivePreviewRow,
  type Store,
  type TodayRow,
  type UserInfo,
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
  /** games[date][userId]; launchedAt is legacy metadata (superseded by
   *  `launches`), kept in the type so old files still parse. */
  games: Record<string, Record<string, GameRecord & { launchedAt?: number }>>;
  /** launches[date][userId][guildId] = launchedAt — every guild the player
   *  opened the Activity in that day (guild membership for previews/recaps). */
  launches: Record<string, Record<string, Record<string, number>>>;
  megaGames: Record<string, Record<string, MegaGameRecord>>;
  /** biteracerGames[date][userId] — today's/finished Biteracer runs. */
  biteracerGames: Record<string, Record<string, BiteracerGameRecord>>;
  /** bitesweeperLaunches[channelId] = markedAt — pending /bitesweeper launches. */
  bitesweeperLaunches: Record<
    string,
    number | { at: number; expectedInstanceId: string | null; discordUserId?: string | null }
  >;
  /** activityModes[instanceId] — the mode an Activity instance defaults to
   *  (what intent-less joiners land in). */
  activityModes: Record<string, { mode: GameMode; createdAt: number }>;
  /** launchIntents[discordUserId] — the game that user last explicitly asked
   *  for; claimed by their next Activity boot. */
  launchIntents: Record<
    string,
    { mode: GameMode; viaEntryPoint: boolean; createdAt: number }
  >;
  /** activityUserModes[instanceId][userId] — which game each participant is
   *  playing within an instance. */
  activityUserModes: Record<string, Record<string, { mode: GameMode; createdAt: number }>>;
  /** bitesweeperPresence[instanceId][userId] = the player's current board and heartbeat. */
  bitesweeperPresence: Record<
    string,
    Record<string, { date: string; seenAt: number }>
  >;
  /** guildChannels[guildId] — per-guild Discord state (live preview, recap). */
  guildChannels: Record<
    string,
    {
      channelId: string;
      updatedAt: number;
      livePreviewDate?: string;
      livePreviewApplicationId?: string;
      livePreviewWebhookToken?: string;
      livePreviewTokenCreatedAt?: number;
      livePreviewMessageId?: string | null;
      livePreviewUpdatedAt?: number;
      recapPostedDate?: string | null;
      bitesweeperInstanceId?: string | null;
      bitesweeperApplicationId?: string;
      bitesweeperWebhookToken?: string;
      bitesweeperTokenCreatedAt?: number;
      bitesweeperMessageId?: string | null;
      bitesweeperUpdatedAt?: number;
    }
  >;
}

const DB_PATH = process.env.BITEDLE_FILE_DB_PATH
  ? path.resolve(process.env.BITEDLE_FILE_DB_PATH)
  : path.join(process.cwd(), "data", "db.json");
const DATA_DIR = path.dirname(DB_PATH);

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
        // guildChannels/launches didn't exist in files written before those
        // features; launches is seeded from the single-guild era's games so
        // pre-migration players keep their guild membership.
        const db: FileDb = {
          users: raw.users,
          games: raw.games,
          launches: raw.launches ?? {},
          megaGames: raw.megaGames ?? {},
          biteracerGames: raw.biteracerGames ?? {},
          bitesweeperLaunches: raw.bitesweeperLaunches ?? {},
          activityModes: raw.activityModes ?? {},
          launchIntents: raw.launchIntents ?? {},
          activityUserModes: raw.activityUserModes ?? {},
          bitesweeperPresence: raw.bitesweeperPresence ?? {},
          guildChannels: raw.guildChannels ?? {},
        };
        if (!raw.launches) {
          for (const [date, byUser] of Object.entries(db.games)) {
            for (const [userId, g] of Object.entries(byUser)) {
              if (!g.guildId) continue;
              ((db.launches[date] ??= {})[userId] ??= {})[g.guildId] =
                g.launchedAt ?? g.finishedAt ?? 0;
            }
          }
        }
        return db;
      }
    } catch {
      // Missing or corrupt file — start fresh.
    }
    return {
      users: {},
      games: {},
      launches: {},
      megaGames: {},
      biteracerGames: {},
      bitesweeperLaunches: {},
      activityModes: {},
      launchIntents: {},
      activityUserModes: {},
      bitesweeperPresence: {},
      guildChannels: {},
    };
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
    // Oldest row wins — canonical player for the Discord id.
    const matches = Object.entries(this.db.users)
      .filter(([, u]) => u.discordUserId === discordUserId)
      .sort(([idA, a], [idB, b]) => a.createdAt - b.createdAt || idA.localeCompare(idB));
    return matches.length === 0 ? null : matches[0][0];
  }

  async mergeUsers(fromUserId: string, toUserId: string): Promise<void> {
    for (const byUser of Object.values(this.db.games)) {
      const orphanGame = byUser[fromUserId];
      if (!orphanGame) continue;
      // Transfer dates the canonical user lacks; conflicting dates: canonical wins.
      if (!byUser[toUserId]) byUser[toUserId] = orphanGame;
      delete byUser[fromUserId];
    }
    for (const byUser of Object.values(this.db.launches)) {
      const orphanLaunches = byUser[fromUserId];
      if (!orphanLaunches) continue;
      // Per guild: canonical entry wins on conflict, orphan fills the gaps.
      byUser[toUserId] = { ...orphanLaunches, ...(byUser[toUserId] ?? {}) };
      delete byUser[fromUserId];
    }
    for (const byUser of Object.values(this.db.megaGames)) {
      const orphanGame = byUser[fromUserId];
      if (!orphanGame) continue;
      if (!byUser[toUserId]) byUser[toUserId] = orphanGame;
      delete byUser[fromUserId];
    }
    for (const byUser of Object.values(this.db.biteracerGames)) {
      const orphanGame = byUser[fromUserId];
      if (!orphanGame) continue;
      if (!byUser[toUserId]) byUser[toUserId] = orphanGame;
      delete byUser[fromUserId];
    }
    for (const byUser of Object.values(this.db.bitesweeperPresence)) {
      const orphanPresence = byUser[fromUserId];
      if (!orphanPresence) continue;
      const canonicalPresence = byUser[toUserId];
      if (!canonicalPresence || orphanPresence.seenAt > canonicalPresence.seenAt) {
        byUser[toUserId] = orphanPresence;
      }
      delete byUser[fromUserId];
    }
    for (const byUser of Object.values(this.db.activityUserModes)) {
      const orphanMode = byUser[fromUserId];
      if (!orphanMode) continue;
      const canonicalMode = byUser[toUserId];
      if (!canonicalMode || orphanMode.createdAt > canonicalMode.createdAt) {
        byUser[toUserId] = orphanMode;
      }
      delete byUser[fromUserId];
    }
    const orphan = this.db.users[fromUserId];
    if (orphan) {
      orphan.discordUserId = null;
      orphan.discordAvatar = null;
      orphan.named = false;
    }
    this.persist();
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
    // guildId is set once (first-guild/web marker) — a full-object replace
    // here would otherwise let a later click silently drop it.
    byUser[userId] = {
      ...game,
      guildId: existing ? existing.guildId : game.guildId,
    };
    this.persist();
  }

  async recordLaunch(date: string, userId: string, guildId: string, at: number): Promise<void> {
    ((this.db.launches[date] ??= {})[userId] ??= {})[guildId] = at;
    this.persist();
  }

  async launchGuildsFor(date: string, userId: string): Promise<string[]> {
    return Object.entries(this.db.launches[date]?.[userId] ?? {})
      .sort(([, atA], [, atB]) => atA - atB)
      .map(([guildId]) => guildId);
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
      // Guild scoping is launch membership (multi-server players appear in
      // every guild they played in); null keeps the web-only partition.
      if (guildId === null) {
        if (g.guildId != null) continue;
      } else if (this.db.launches[date]?.[userId]?.[guildId] === undefined) {
        continue;
      }
      out.push({
        userId,
        name: user.name,
        discordUserId: user.discordUserId ?? null,
        discordAvatar: user.discordAvatar ?? null,
        status: g.status,
        score: g.score,
        clicks: g.clicks,
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
        // Same launch-membership scoping as finishedGamesOn.
        if (guildId === null) {
          if (g.guildId != null) continue;
        } else if (this.db.launches[date]?.[userId]?.[guildId] === undefined) {
          continue;
        }
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

  async getMegaGame(date: string, userId: string): Promise<MegaGameRecord | null> {
    const game = this.db.megaGames[date]?.[userId];
    return game
      ? {
          ...(JSON.parse(JSON.stringify(game)) as MegaGameRecord),
          flags: game.flags ?? [],
          activityInstanceId: game.activityInstanceId ?? null,
        }
      : null;
  }

  async putMegaGame(date: string, userId: string, game: MegaGameRecord): Promise<void> {
    const byUser = (this.db.megaGames[date] ??= {});
    const existing = byUser[userId];
    if (existing && existing.status !== "playing") return;
    byUser[userId] = JSON.parse(
      JSON.stringify({
        ...game,
        flags: game.flags ?? [],
        activityInstanceId: game.activityInstanceId ?? null,
      }),
    ) as MegaGameRecord;
    this.persist();
  }

  async replayMegaGame(date: string, userId: string, boardSeed: string): Promise<boolean> {
    const game = this.db.megaGames[date]?.[userId];
    if (!game || game.status === "playing") return false;
    this.db.megaGames[date][userId] = {
      clicks: [],
      flags: [],
      status: "playing",
      score: null,
      finishedAt: null,
      boardSeed,
      activityInstanceId: game.activityInstanceId ?? null,
    };
    this.persist();
    return true;
  }

  async startMegaGameForInstance(
    date: string,
    userId: string,
    instanceId: string,
    boardSeed: string,
  ): Promise<void> {
    const byUser = (this.db.megaGames[date] ??= {});
    if (byUser[userId]?.activityInstanceId === instanceId) return;
    byUser[userId] = {
      clicks: [],
      flags: [],
      status: "playing",
      score: null,
      finishedAt: null,
      boardSeed,
      activityInstanceId: instanceId,
    };
    this.persist();
  }

  async getBiteracerGame(date: string, userId: string): Promise<BiteracerGameRecord | null> {
    const g = this.db.biteracerGames[date]?.[userId];
    // Deep-copy so callers can't mutate stored state without the store methods.
    return g ? (JSON.parse(JSON.stringify(g)) as BiteracerGameRecord) : null;
  }

  async startBiteracerGame(
    date: string,
    userId: string,
    passageId: string,
    startedAt: number,
  ): Promise<BiteracerGameRecord> {
    const byUser = (this.db.biteracerGames[date] ??= {});
    // First call wins — a repeat call (refresh/reconnect) never resets the clock.
    if (!byUser[userId]) {
      byUser[userId] = {
        passageId,
        startedAt,
        finishedAt: null,
        status: "playing",
        netWpm: null,
        rawWpm: null,
        accuracy: null,
        elapsedMs: null,
        correctChars: null,
        errorCount: null,
        guildId: null,
      };
      this.persist();
    }
    return JSON.parse(JSON.stringify(byUser[userId])) as BiteracerGameRecord;
  }

  async finishBiteracerGame(
    date: string,
    userId: string,
    result: {
      finishedAt: number;
      netWpm: number;
      rawWpm: number;
      accuracy: number;
      elapsedMs: number;
      correctChars: number;
      errorCount: number;
    },
  ): Promise<BiteracerGameRecord | null> {
    const existing = this.db.biteracerGames[date]?.[userId];
    if (!existing || existing.status !== "playing") return null;
    Object.assign(existing, {
      status: "finished" as const,
      finishedAt: result.finishedAt,
      netWpm: result.netWpm,
      rawWpm: result.rawWpm,
      accuracy: result.accuracy,
      elapsedMs: result.elapsedMs,
      correctChars: result.correctChars,
      errorCount: result.errorCount,
    });
    this.persist();
    return JSON.parse(JSON.stringify(existing)) as BiteracerGameRecord;
  }

  async finishedBiteracerGamesFor(userId: string): Promise<FinishedBiteracerGame[]> {
    const out: FinishedBiteracerGame[] = [];
    for (const [date, byUser] of Object.entries(this.db.biteracerGames)) {
      const g = byUser[userId];
      if (g?.status === "finished") out.push({ date, netWpm: g.netWpm!, accuracy: g.accuracy! });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  async finishedBiteracerGamesOn(date: string): Promise<BiteracerTodayRow[]> {
    const out: BiteracerTodayRow[] = [];
    for (const [userId, g] of Object.entries(this.db.biteracerGames[date] ?? {})) {
      const user = this.db.users[userId];
      if (g.status !== "finished" || !user?.named) continue;
      out.push({
        userId,
        name: user.name,
        discordUserId: user.discordUserId ?? null,
        discordAvatar: user.discordAvatar ?? null,
        netWpm: g.netWpm!,
        rawWpm: g.rawWpm!,
        accuracy: g.accuracy!,
        elapsedMs: g.elapsedMs!,
        finishedAt: g.finishedAt ?? 0,
      });
    }
    return out;
  }

  async allFinishedBiteracerGames(): Promise<BiteracerAllTimeRow[]> {
    const out: BiteracerAllTimeRow[] = [];
    for (const [date, byUser] of Object.entries(this.db.biteracerGames)) {
      for (const [userId, g] of Object.entries(byUser)) {
        const user = this.db.users[userId];
        if (g.status !== "finished" || !user?.named) continue;
        out.push({
          userId,
          name: user.name,
          discordUserId: user.discordUserId ?? null,
          discordAvatar: user.discordAvatar ?? null,
          date,
          netWpm: g.netWpm!,
          accuracy: g.accuracy!,
        });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  async recordBitesweeperPresence(
    instanceId: string,
    date: string,
    userId: string,
    at: number,
  ): Promise<void> {
    (this.db.bitesweeperPresence[instanceId] ??= {})[userId] = { date, seenAt: at };
    this.persist();
  }

  async bitesweeperPlayers(
    instanceId: string,
    activeSince: number,
  ): Promise<BitesweeperPlayerRow[]> {
    const out: BitesweeperPlayerRow[] = [];
    for (const [userId, presence] of Object.entries(
      this.db.bitesweeperPresence[instanceId] ?? {},
    )) {
      if (presence.seenAt < activeSince) continue;
      const user = this.db.users[userId];
      if (!user?.discordUserId) continue;
      const game = this.db.megaGames[presence.date]?.[userId];
      if (game?.activityInstanceId && game.activityInstanceId !== instanceId) continue;
      out.push({
        userId,
        date: presence.date,
        name: user.name,
        discordUserId: user.discordUserId,
        discordAvatar: user.discordAvatar ?? null,
        status: game?.status ?? "playing",
        score: game?.score ?? null,
        clicks: game?.clicks ?? [],
        flags: game?.flags ?? [],
        seenAt: presence.seenAt,
      });
    }
    return out.sort((a, b) => a.seenAt - b.seenAt);
  }

  async getBitesweeperPreview(guildId: string): Promise<BitesweeperPreviewMessage | null> {
    const channel = this.db.guildChannels[guildId];
    if (!channel?.bitesweeperApplicationId || !channel.bitesweeperWebhookToken) return null;
    return {
      guildId,
      instanceId: channel.bitesweeperInstanceId ?? null,
      applicationId: channel.bitesweeperApplicationId,
      webhookToken: channel.bitesweeperWebhookToken,
      tokenCreatedAt: channel.bitesweeperTokenCreatedAt ?? 0,
      messageId: channel.bitesweeperMessageId ?? null,
      updatedAt: channel.bitesweeperUpdatedAt ?? 0,
    };
  }

  async setBitesweeperPreview(message: BitesweeperPreviewMessage): Promise<void> {
    const channel = this.db.guildChannels[message.guildId];
    if (!channel) return;
    channel.bitesweeperInstanceId = message.instanceId;
    channel.bitesweeperApplicationId = message.applicationId;
    channel.bitesweeperWebhookToken = message.webhookToken;
    channel.bitesweeperTokenCreatedAt = message.tokenCreatedAt;
    channel.bitesweeperMessageId = message.messageId;
    channel.bitesweeperUpdatedAt = message.updatedAt;
    this.persist();
  }

  async bindBitesweeperPreviewInstance(
    guildId: string,
    tokenCreatedAt: number,
    instanceId: string,
  ): Promise<boolean> {
    const channel = this.db.guildChannels[guildId];
    if (
      !channel ||
      channel.bitesweeperTokenCreatedAt !== tokenCreatedAt ||
      (channel.bitesweeperInstanceId && channel.bitesweeperInstanceId !== instanceId)
    ) return false;
    channel.bitesweeperInstanceId = instanceId;
    this.persist();
    return true;
  }

  async claimBitesweeperPreviewPost(guildId: string, tokenCreatedAt: number): Promise<boolean> {
    const channel = this.db.guildChannels[guildId];
    if (
      !channel ||
      channel.bitesweeperTokenCreatedAt !== tokenCreatedAt ||
      channel.bitesweeperMessageId !== null
    ) return false;
    channel.bitesweeperMessageId = LIVE_PREVIEW_POSTING;
    this.persist();
    return true;
  }

  async completeBitesweeperPreviewPost(
    guildId: string,
    tokenCreatedAt: number,
    messageId: string,
    updatedAt: number,
  ): Promise<void> {
    const channel = this.db.guildChannels[guildId];
    if (
      channel?.bitesweeperTokenCreatedAt === tokenCreatedAt &&
      channel.bitesweeperMessageId === LIVE_PREVIEW_POSTING
    ) {
      channel.bitesweeperMessageId = messageId;
      channel.bitesweeperUpdatedAt = updatedAt;
      this.persist();
    }
  }

  async releaseBitesweeperPreviewPost(guildId: string, tokenCreatedAt: number): Promise<void> {
    const channel = this.db.guildChannels[guildId];
    if (
      channel?.bitesweeperTokenCreatedAt === tokenCreatedAt &&
      channel.bitesweeperMessageId === LIVE_PREVIEW_POSTING
    ) {
      channel.bitesweeperMessageId = null;
      this.persist();
    }
  }

  async clearBitesweeperPreviewMessageId(
    guildId: string,
    tokenCreatedAt: number,
    messageId: string,
  ): Promise<void> {
    const channel = this.db.guildChannels[guildId];
    if (
      channel?.bitesweeperTokenCreatedAt === tokenCreatedAt &&
      channel.bitesweeperMessageId === messageId
    ) {
      channel.bitesweeperMessageId = null;
      this.persist();
    }
  }

  async markBitesweeperLaunch(
    channelId: string,
    at: number,
    expectedInstanceId: string | null = null,
    discordUserId: string | null = null,
  ): Promise<void> {
    this.db.bitesweeperLaunches[channelId] = { at, expectedInstanceId, discordUserId };
    this.persist();
  }

  async recordLaunchIntent(
    discordUserId: string,
    mode: GameMode,
    at: number,
    viaEntryPoint = false,
  ): Promise<void> {
    this.db.launchIntents[discordUserId] = { mode, viaEntryPoint, createdAt: at };
    this.persist();
  }

  async resolveActivityMode(
    instanceId: string,
    channelId: string | null,
    freshMarkerSince: number,
  ): Promise<GameMode> {
    const existing = this.db.activityModes[instanceId];
    const marker = channelId ? this.db.bitesweeperLaunches[channelId] : undefined;
    const markedAt = typeof marker === "number" ? marker : marker?.at;
    const expectedInstanceId = typeof marker === "number" ? null : marker?.expectedInstanceId;
    const hasFreshMarker = markedAt !== undefined && markedAt >= freshMarkerSince;
    if (
      hasFreshMarker &&
      channelId &&
      (!existing || (existing.mode === "mega" && expectedInstanceId === instanceId))
    ) {
      delete this.db.bitesweeperLaunches[channelId];
      this.persist();
    }
    if (existing) return existing.mode;

    const mode: GameMode = hasFreshMarker ? "mega" : "classic";
    this.db.activityModes[instanceId] = { mode, createdAt: Date.now() };
    this.persist();
    return mode;
  }

  async resolveActivityModeForUser(
    instanceId: string,
    channelId: string | null,
    userId: string | null,
    freshSince: number,
  ): Promise<GameMode> {
    if (!userId) return this.resolveActivityMode(instanceId, channelId, freshSince);

    const discordUserId = this.db.users[userId]?.discordUserId ?? null;
    const intent = discordUserId ? this.db.launchIntents[discordUserId] : undefined;
    const binding = this.db.activityUserModes[instanceId]?.[userId];

    if (discordUserId && intent && intent.createdAt >= freshSince) {
      delete this.db.launchIntents[discordUserId];
      // A weak (entry-point / App Launcher) classic intent yields to a
      // binding the user already has here: reopening the app resumes their
      // Bitesweeper game instead of yanking them to classic.
      const suppressed = intent.mode === "classic" && intent.viaEntryPoint && binding;
      if (!suppressed) {
        (this.db.activityUserModes[instanceId] ??= {})[userId] = {
          mode: intent.mode,
          createdAt: Date.now(),
        };
        if (intent.mode === "mega") {
          // Bind the instance default (if unbound) so intent-less joiners
          // land in the launched game, and consume the claimant's OWN channel
          // marker so it can't later hijack an unlinked classic boot.
          this.db.activityModes[instanceId] ??= { mode: "mega", createdAt: Date.now() };
          const marker = channelId ? this.db.bitesweeperLaunches[channelId] : undefined;
          if (
            channelId &&
            marker &&
            typeof marker !== "number" &&
            marker.discordUserId === discordUserId
          ) {
            delete this.db.bitesweeperLaunches[channelId];
          }
        }
        this.persist();
        return intent.mode;
      }
      this.persist();
    }

    if (binding) return binding.mode;
    return this.resolveActivityMode(instanceId, channelId, freshSince);
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

  async livePreviewGamesOn(guildId: string, sinceLaunchedAt: number): Promise<LivePreviewRow[]> {
    const rows: { launchedAt: number; row: LivePreviewRow }[] = [];
    // Scan every day's launches — a cross-timezone player's row lives under
    // their own local date; the launched_at window is what actually scopes
    // them, using this guild's own launch time.
    for (const [date, byUser] of Object.entries(this.db.launches)) {
      for (const [userId, byGuild] of Object.entries(byUser)) {
        const launchedAt = byGuild[guildId];
        if (launchedAt === undefined || launchedAt < sinceLaunchedAt) continue;
        const g = this.db.games[date]?.[userId];
        if (!g) continue;
        const user = this.db.users[userId];
        if (!user?.discordUserId) continue;
        rows.push({
          launchedAt,
          row: {
            userId,
            name: user.name,
            discordUserId: user.discordUserId ?? null,
            discordAvatar: user.discordAvatar ?? null,
            date,
            status: g.status,
            score: g.score,
            clicks: g.clicks,
            finishedAt: g.finishedAt,
          },
        });
      }
    }
    // Launcher first (earliest open in the window), then userId for determinism.
    return rows
      .sort((a, b) => a.launchedAt - b.launchedAt || a.row.userId.localeCompare(b.row.userId))
      .map((r) => r.row);
  }

  async getLivePreviewMessage(guildId: string, date: string): Promise<LivePreviewMessage | null> {
    const channel = this.db.guildChannels[guildId];
    if (
      !channel ||
      channel.livePreviewDate !== date ||
      !channel.livePreviewApplicationId ||
      !channel.livePreviewWebhookToken
    ) {
      return null;
    }
    return {
      guildId,
      date,
      applicationId: channel.livePreviewApplicationId,
      webhookToken: channel.livePreviewWebhookToken,
      tokenCreatedAt: channel.livePreviewTokenCreatedAt ?? 0,
      messageId: channel.livePreviewMessageId ?? null,
      updatedAt: channel.livePreviewUpdatedAt ?? 0,
      recapPostedDate: channel.recapPostedDate ?? null,
    };
  }

  async setLivePreviewMessage(message: LivePreviewMessage): Promise<void> {
    const existing = this.db.guildChannels[message.guildId];
    this.db.guildChannels[message.guildId] = {
      ...(existing ?? {}),
      channelId: existing?.channelId ?? "",
      updatedAt: existing?.updatedAt ?? Date.now(),
      livePreviewDate: message.date,
      livePreviewApplicationId: message.applicationId,
      livePreviewWebhookToken: message.webhookToken,
      livePreviewTokenCreatedAt: message.tokenCreatedAt,
      livePreviewMessageId: message.messageId,
      livePreviewUpdatedAt: message.updatedAt,
    };
    this.persist();
  }

  async claimLivePreviewPost(guildId: string, date: string): Promise<boolean> {
    const channel = this.db.guildChannels[guildId];
    if (!channel || channel.livePreviewDate !== date || channel.livePreviewMessageId != null) {
      return false;
    }
    channel.livePreviewMessageId = LIVE_PREVIEW_POSTING;
    this.persist();
    return true;
  }

  async releaseLivePreviewPost(guildId: string, date: string): Promise<void> {
    const channel = this.db.guildChannels[guildId];
    if (
      channel &&
      channel.livePreviewDate === date &&
      channel.livePreviewMessageId === LIVE_PREVIEW_POSTING
    ) {
      channel.livePreviewMessageId = null;
      this.persist();
    }
  }

  async clearLivePreviewMessageId(guildId: string, date: string, messageId: string): Promise<void> {
    const channel = this.db.guildChannels[guildId];
    if (channel && channel.livePreviewDate === date && channel.livePreviewMessageId === messageId) {
      channel.livePreviewMessageId = null;
      this.persist();
    }
  }

  async claimDailyRecap(guildId: string, date: string): Promise<boolean> {
    // No awaits between check and set — atomic within the event-loop tick.
    const channel = this.db.guildChannels[guildId];
    if (!channel || channel.recapPostedDate === date) return false;
    channel.recapPostedDate = date;
    this.persist();
    return true;
  }

  async releaseDailyRecap(guildId: string, date: string): Promise<void> {
    const channel = this.db.guildChannels[guildId];
    if (channel && channel.recapPostedDate === date) {
      channel.recapPostedDate = null;
      this.persist();
    }
  }
}
