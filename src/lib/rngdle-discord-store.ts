import fs from "node:fs";
import path from "node:path";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { RngdleBadge, RngdleResult } from "./rngdle/types";
import { canRerollRngdle, rngdleGameDayDeadline } from "./rngdle/time";

export interface RngdleDiscordRoll {
  guildId: string;
  userId: string;
  displayName: string;
  avatar: string | null;
  gameDay: string;
  initial: RngdleResult;
  current: RngdleResult;
  initialRolledAt: number;
  rerolledAt: number | null;
}

export interface RngdleLeaderboardEntry {
  userId: string;
  displayName: string;
  avatar: string | null;
  totalEp: number;
  rolls: number;
  bestNumber: number;
  bestEp: number;
  bestPenaltyPercent: number | null;
  bestRarity: RngdleResult["rarity"];
}

export interface RngdleDailyStanding {
  userId: string;
  displayName: string;
  creditedEp: number;
  rank: number;
}

export interface RngdleProfileRoll {
  gameDay: string;
  result: RngdleResult;
}

export interface RngdleUserProfile {
  userId: string;
  displayName: string;
  avatar: string | null;
  today: RngdleProfileRoll | null;
  top: RngdleProfileRoll;
  worst: RngdleProfileRoll;
  allTimeRank: number;
  totalPlayers: number;
  games: number;
  careerEp: number;
  currentStreak: number;
  uniqueBadges: number;
  totalBadges: number;
  rerollDeltaEp: number;
  rarestBadges: RngdleBadge[];
  todayNewBadges: number;
}

export const RNGDLE_TOTAL_BADGES = 230;

export type RngdleRerollOutcome =
  | { status: "updated"; roll: RngdleDiscordRoll }
  | { status: "missing" | "already-used" | "expired" };

export interface RngdleDiscordRepository {
  createInitial(input: RngdleDiscordRoll): Promise<{ created: boolean; roll: RngdleDiscordRoll }>;
  getRoll(guildId: string, userId: string, gameDay: string): Promise<RngdleDiscordRoll | null>;
  reroll(input: {
    guildId: string;
    userId: string;
    gameDay: string;
    displayName: string;
    avatar: string | null;
    result: RngdleResult;
    now: number;
  }): Promise<RngdleRerollOutcome>;
  dailyStandings(guildId: string, gameDay: string): Promise<RngdleDailyStanding[]>;
  leaderboard(guildId: string, limit?: number): Promise<RngdleLeaderboardEntry[]>;
  /** Distinct players in a guild, for the leaderboard's "N PLAYERS" caption. */
  playerCount(guildId: string): Promise<number>;
  userProfile(guildId: string, userId: string, currentGameDay: string): Promise<RngdleUserProfile | null>;
}

interface FileDatabase {
  rolls: Record<string, RngdleDiscordRoll>;
}

function recordKey(guildId: string, userId: string, gameDay: string): string {
  return `${guildId}:${userId}:${gameDay}`;
}

function cloneRoll(roll: RngdleDiscordRoll): RngdleDiscordRoll {
  return structuredClone(roll);
}

function rankedDaily(rows: Omit<RngdleDailyStanding, "rank">[]): RngdleDailyStanding[] {
  rows.sort((a, b) => b.creditedEp - a.creditedEp || a.displayName.localeCompare(b.displayName));
  let previousScore: number | null = null;
  let rank = 0;
  return rows.map((row, index) => {
    if (row.creditedEp !== previousScore) rank = index + 1;
    previousScore = row.creditedEp;
    return { ...row, rank };
  });
}

function previousDay(gameDay: string): string {
  const [year, month, day] = gameDay.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

function buildProfile(
  rolls: RngdleDiscordRoll[],
  standing: { allTimeRank: number; totalPlayers: number },
  currentGameDay: string,
): RngdleUserProfile | null {
  if (rolls.length === 0) return null;
  const newest = rolls.slice().sort((a, b) => b.initialRolledAt - a.initialRolledAt)[0];
  const byScore = rolls.slice().sort((a, b) => b.current.creditedEp - a.current.creditedEp || b.initialRolledAt - a.initialRolledAt);
  const uniqueBadges = new Map<string, RngdleBadge>();
  let rerollDeltaEp = 0;
  for (const roll of rolls) {
    for (const badge of roll.current.badges) {
      const previous = uniqueBadges.get(badge.id);
      if (!previous || badge.ep > previous.ep) uniqueBadges.set(badge.id, badge);
    }
    if (roll.rerolledAt !== null) rerollDeltaEp += roll.current.creditedEp - roll.initial.creditedEp;
  }
  const dates = new Set(rolls.map((roll) => roll.gameDay));
  let currentStreak = 0;
  let cursor = dates.has(currentGameDay) ? currentGameDay : previousDay(currentGameDay);
  while (dates.has(cursor)) {
    currentStreak += 1;
    cursor = previousDay(cursor);
  }
  const todayRoll = rolls.find((roll) => roll.gameDay === currentGameDay) ?? null;
  const previousBadgeIds = new Set(
    rolls
      .filter((roll) => roll.gameDay !== currentGameDay)
      .flatMap((roll) => roll.current.badges.map((badge) => badge.id)),
  );
  return {
    userId: newest.userId,
    displayName: newest.displayName,
    avatar: newest.avatar,
    today: todayRoll
      ? { gameDay: currentGameDay, result: todayRoll.current }
      : null,
    top: { gameDay: byScore[0].gameDay, result: byScore[0].current },
    worst: { gameDay: byScore.at(-1)!.gameDay, result: byScore.at(-1)!.current },
    allTimeRank: standing.allTimeRank,
    totalPlayers: Math.max(1, standing.totalPlayers),
    games: rolls.length,
    careerEp: rolls.reduce((total, roll) => total + roll.current.creditedEp, 0),
    currentStreak,
    uniqueBadges: uniqueBadges.size,
    totalBadges: RNGDLE_TOTAL_BADGES,
    rerollDeltaEp,
    rarestBadges: [...uniqueBadges.values()]
      .sort((a, b) => {
        const aProbability = a.prob > 0 ? a.prob : Number.POSITIVE_INFINITY;
        const bProbability = b.prob > 0 ? b.prob : Number.POSITIVE_INFINITY;
        return aProbability - bProbability || b.ep - a.ep || a.label.localeCompare(b.label);
      })
      .slice(0, 5),
    todayNewBadges: todayRoll
      ? todayRoll.current.badges.filter((badge) => !previousBadgeIds.has(badge.id)).length
      : 0,
  };
}

export class FileRngdleDiscordRepository implements RngdleDiscordRepository {
  private readonly filePath: string;
  private db: FileDatabase;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(filePath = process.env.BITEDLE_RNGDLE_FILE_DB_PATH
    ? path.resolve(process.env.BITEDLE_RNGDLE_FILE_DB_PATH)
    : path.join(process.cwd(), "data", "rngdle-discord.json")) {
    this.filePath = filePath;
    this.db = this.load();
  }

  private load(): FileDatabase {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as FileDatabase;
      if (parsed && typeof parsed === "object" && parsed.rolls) return parsed;
    } catch {
      // A missing local file is a fresh development database.
    }
    return { rolls: {} };
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.db, null, 2), "utf8");
    fs.renameSync(temporary, this.filePath);
  }

  private mutate<T>(operation: () => T): Promise<T> {
    const result = this.mutationQueue.then(() => {
      const value = operation();
      this.persist();
      return value;
    });
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async createInitial(input: RngdleDiscordRoll) {
    return this.mutate(() => {
      const key = recordKey(input.guildId, input.userId, input.gameDay);
      const existing = this.db.rolls[key];
      if (existing) return { created: false, roll: cloneRoll(existing) };
      this.db.rolls[key] = cloneRoll(input);
      return { created: true, roll: cloneRoll(input) };
    });
  }

  async getRoll(guildId: string, userId: string, gameDay: string) {
    const roll = this.db.rolls[recordKey(guildId, userId, gameDay)];
    return roll ? cloneRoll(roll) : null;
  }

  async reroll(input: {
    guildId: string;
    userId: string;
    gameDay: string;
    displayName: string;
    avatar: string | null;
    result: RngdleResult;
    now: number;
  }): Promise<RngdleRerollOutcome> {
    return this.mutate(() => {
      const key = recordKey(input.guildId, input.userId, input.gameDay);
      const existing = this.db.rolls[key];
      if (!existing) return { status: "missing" };
      if (existing.rerolledAt !== null) return { status: "already-used" };
      if (!canRerollRngdle(existing.initialRolledAt, existing.rerolledAt, input.now)) {
        return { status: "expired" };
      }
      const updated: RngdleDiscordRoll = {
        ...existing,
        displayName: input.displayName,
        avatar: input.avatar,
        current: input.result,
        rerolledAt: input.now,
      };
      this.db.rolls[key] = updated;
      return { status: "updated", roll: cloneRoll(updated) };
    });
  }

  async dailyStandings(guildId: string, gameDay: string): Promise<RngdleDailyStanding[]> {
    return rankedDaily(Object.values(this.db.rolls)
      .filter((roll) => roll.guildId === guildId && roll.gameDay === gameDay)
      .map((roll) => ({
        userId: roll.userId,
        displayName: roll.displayName,
        creditedEp: roll.current.creditedEp,
      })));
  }

  async leaderboard(guildId: string, limit = 25): Promise<RngdleLeaderboardEntry[]> {
    const totals = new Map<string, RngdleLeaderboardEntry & { latestAt: number }>();
    for (const roll of Object.values(this.db.rolls)) {
      if (roll.guildId !== guildId) continue;
      const previous = totals.get(roll.userId);
      if (!previous) {
        totals.set(roll.userId, {
          userId: roll.userId,
          displayName: roll.displayName,
          avatar: roll.avatar,
          totalEp: roll.current.creditedEp,
          rolls: 1,
          bestNumber: roll.current.number,
          bestEp: roll.current.creditedEp,
          bestPenaltyPercent: roll.current.penaltyPercent,
          bestRarity: roll.current.rarity,
          latestAt: roll.initialRolledAt,
        });
      } else {
        previous.totalEp += roll.current.creditedEp;
        previous.rolls += 1;
        if (roll.current.creditedEp > previous.bestEp) {
          previous.bestNumber = roll.current.number;
          previous.bestEp = roll.current.creditedEp;
          previous.bestPenaltyPercent = roll.current.penaltyPercent;
          previous.bestRarity = roll.current.rarity;
        }
        if (roll.initialRolledAt > previous.latestAt) {
          previous.displayName = roll.displayName;
          previous.avatar = roll.avatar;
          previous.latestAt = roll.initialRolledAt;
        }
      }
    }
    return [...totals.values()]
      .sort((a, b) => b.totalEp - a.totalEp || b.rolls - a.rolls || a.displayName.localeCompare(b.displayName))
      .slice(0, Math.max(1, limit))
      .map((entry) => ({
        userId: entry.userId,
        displayName: entry.displayName,
        avatar: entry.avatar,
        totalEp: entry.totalEp,
        rolls: entry.rolls,
        bestNumber: entry.bestNumber,
        bestEp: entry.bestEp,
        bestPenaltyPercent: entry.bestPenaltyPercent,
        bestRarity: entry.bestRarity,
      }));
  }

  async playerCount(guildId: string): Promise<number> {
    const players = new Set<string>();
    for (const roll of Object.values(this.db.rolls)) {
      if (roll.guildId === guildId) players.add(roll.userId);
    }
    return players.size;
  }

  async userProfile(guildId: string, userId: string, currentGameDay: string): Promise<RngdleUserProfile | null> {
    const rolls = Object.values(this.db.rolls)
      .filter((roll) => roll.guildId === guildId && roll.userId === userId)
      .map(cloneRoll);
    const leaderboard = await this.leaderboard(guildId, Number.MAX_SAFE_INTEGER);
    const index = leaderboard.findIndex((entry) => entry.userId === userId);
    return buildProfile(rolls, {
      allTimeRank: index === -1 ? leaderboard.length : index + 1,
      totalPlayers: Math.max(1, leaderboard.length),
    }, currentGameDay);
  }
}

interface NeonRollRow {
  guild_id: string;
  user_id: string;
  game_day: string;
  display_name: string;
  avatar: string | null;
  initial_result: RngdleResult;
  current_result: RngdleResult;
  initial_rolled_at: string | number;
  rerolled_at: string | number | null;
}

function neonRoll(row: NeonRollRow): RngdleDiscordRoll {
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    displayName: row.display_name,
    avatar: row.avatar,
    gameDay: row.game_day,
    initial: row.initial_result,
    current: row.current_result,
    initialRolledAt: Number(row.initial_rolled_at),
    rerolledAt: row.rerolled_at === null ? null : Number(row.rerolled_at),
  };
}

export class NeonRngdleDiscordRepository implements RngdleDiscordRepository {
  private readonly sql: NeonQueryFunction<false, false>;
  private ready: Promise<void> | null = null;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  private ensureSchema(): Promise<void> {
    this.ready ??= (async () => {
      await this.sql`
        CREATE TABLE IF NOT EXISTS rngdle_rolls (
          guild_id text NOT NULL,
          user_id text NOT NULL,
          game_day text NOT NULL,
          display_name text NOT NULL,
          avatar text,
          initial_result jsonb NOT NULL,
          current_result jsonb NOT NULL,
          initial_rolled_at bigint NOT NULL,
          rerolled_at bigint,
          PRIMARY KEY (guild_id, user_id, game_day)
        )`;
      await this.sql`CREATE INDEX IF NOT EXISTS rngdle_rolls_guild_day_idx ON rngdle_rolls (guild_id, game_day)`;
      await this.sql`CREATE INDEX IF NOT EXISTS rngdle_rolls_guild_user_idx ON rngdle_rolls (guild_id, user_id)`;
    })();
    return this.ready;
  }

  async createInitial(input: RngdleDiscordRoll) {
    await this.ensureSchema();
    const inserted = await this.sql`
      INSERT INTO rngdle_rolls (
        guild_id, user_id, game_day, display_name, avatar,
        initial_result, current_result, initial_rolled_at, rerolled_at
      ) VALUES (
        ${input.guildId}, ${input.userId}, ${input.gameDay}, ${input.displayName}, ${input.avatar},
        ${JSON.stringify(input.initial)}::jsonb, ${JSON.stringify(input.current)}::jsonb,
        ${input.initialRolledAt}, NULL
      )
      ON CONFLICT (guild_id, user_id, game_day) DO NOTHING
      RETURNING *` as NeonRollRow[];
    if (inserted[0]) return { created: true, roll: neonRoll(inserted[0]) };
    const existing = await this.getRoll(input.guildId, input.userId, input.gameDay);
    if (!existing) throw new Error("RNGDLE roll conflicted but could not be read.");
    return { created: false, roll: existing };
  }

  async getRoll(guildId: string, userId: string, gameDay: string) {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT * FROM rngdle_rolls
      WHERE guild_id = ${guildId} AND user_id = ${userId} AND game_day = ${gameDay}
      LIMIT 1` as NeonRollRow[];
    return rows[0] ? neonRoll(rows[0]) : null;
  }

  async reroll(input: {
    guildId: string;
    userId: string;
    gameDay: string;
    displayName: string;
    avatar: string | null;
    result: RngdleResult;
    now: number;
  }): Promise<RngdleRerollOutcome> {
    await this.ensureSchema();
    const updated = await this.sql`
      UPDATE rngdle_rolls SET
        display_name = ${input.displayName},
        avatar = ${input.avatar},
        current_result = ${JSON.stringify(input.result)}::jsonb,
        rerolled_at = ${input.now}
      WHERE guild_id = ${input.guildId}
        AND user_id = ${input.userId}
        AND game_day = ${input.gameDay}
        AND rerolled_at IS NULL
        AND initial_rolled_at <= ${input.now}
        AND ${rngdleGameDayDeadline(input.gameDay)} > ${input.now}
      RETURNING *` as NeonRollRow[];
    if (updated[0]) return { status: "updated", roll: neonRoll(updated[0]) };
    const existing = await this.getRoll(input.guildId, input.userId, input.gameDay);
    if (!existing) return { status: "missing" };
    return { status: existing.rerolledAt === null ? "expired" : "already-used" };
  }

  async dailyStandings(guildId: string, gameDay: string): Promise<RngdleDailyStanding[]> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT user_id, display_name, (current_result->>'creditedEp')::bigint AS credited_ep
      FROM rngdle_rolls
      WHERE guild_id = ${guildId} AND game_day = ${gameDay}` as Array<{
        user_id: string;
        display_name: string;
        credited_ep: string | number;
      }>;
    return rankedDaily(rows.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      creditedEp: Number(row.credited_ep),
    })));
  }

  async leaderboard(guildId: string, limit = 25): Promise<RngdleLeaderboardEntry[]> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT
        user_id,
        (array_agg(display_name ORDER BY initial_rolled_at DESC))[1] AS display_name,
        (array_agg(avatar ORDER BY initial_rolled_at DESC))[1] AS avatar,
        SUM((current_result->>'creditedEp')::bigint) AS total_ep,
        COUNT(*)::int AS rolls,
        (array_agg((current_result->>'number')::int ORDER BY (current_result->>'creditedEp')::bigint DESC))[1] AS best_number,
        (array_agg((current_result->>'creditedEp')::bigint ORDER BY (current_result->>'creditedEp')::bigint DESC))[1] AS best_ep,
        (array_agg((current_result->>'penaltyPercent')::int ORDER BY (current_result->>'creditedEp')::bigint DESC))[1] AS best_penalty_percent,
        (array_agg(current_result->>'rarity' ORDER BY (current_result->>'creditedEp')::bigint DESC))[1] AS best_rarity
      FROM rngdle_rolls
      WHERE guild_id = ${guildId}
      GROUP BY user_id
      ORDER BY total_ep DESC, rolls DESC, display_name ASC
      LIMIT ${Math.max(1, limit)}` as Array<{
        user_id: string;
        display_name: string;
        avatar: string | null;
        total_ep: string | number;
        rolls: string | number;
        best_number: string | number;
        best_ep: string | number;
        best_penalty_percent: string | number | null;
        best_rarity: RngdleResult["rarity"];
      }>;
    return rows.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      avatar: row.avatar,
      totalEp: Number(row.total_ep),
      rolls: Number(row.rolls),
      bestNumber: Number(row.best_number),
      bestEp: Number(row.best_ep),
      bestPenaltyPercent: row.best_penalty_percent === null ? null : Number(row.best_penalty_percent),
      bestRarity: row.best_rarity,
    }));
  }

  async playerCount(guildId: string): Promise<number> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT COUNT(DISTINCT user_id)::int AS players
      FROM rngdle_rolls
      WHERE guild_id = ${guildId}` as Array<{ players: number }>;
    return rows[0]?.players ?? 0;
  }

  async userProfile(guildId: string, userId: string, currentGameDay: string): Promise<RngdleUserProfile | null> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT * FROM rngdle_rolls
      WHERE guild_id = ${guildId} AND user_id = ${userId}
      ORDER BY initial_rolled_at DESC` as NeonRollRow[];
    if (rows.length === 0) return null;
    // Rank computed in the database with the leaderboard's exact ordering,
    // instead of shipping the entire aggregated leaderboard to find one index.
    const standing = await this.sql`
      WITH totals AS (
        SELECT
          user_id,
          SUM((current_result->>'creditedEp')::bigint) AS total_ep,
          COUNT(*)::int AS rolls,
          (array_agg(display_name ORDER BY initial_rolled_at DESC))[1] AS display_name
        FROM rngdle_rolls
        WHERE guild_id = ${guildId}
        GROUP BY user_id
      ), ranked AS (
        SELECT
          user_id,
          (ROW_NUMBER() OVER (ORDER BY total_ep DESC, rolls DESC, display_name ASC))::int AS rank,
          (COUNT(*) OVER ())::int AS players
        FROM totals
      )
      SELECT rank, players FROM ranked WHERE user_id = ${userId}` as Array<{ rank: number; players: number }>;
    return buildProfile(rows.map(neonRoll), {
      allTimeRank: standing[0]?.rank ?? 1,
      totalPlayers: standing[0]?.players ?? 1,
    }, currentGameDay);
  }
}

const globalRepository = globalThis as unknown as {
  __rngdleDiscordRepository?: RngdleDiscordRepository;
};

export function getRngdleDiscordRepository(): RngdleDiscordRepository {
  if (!globalRepository.__rngdleDiscordRepository) {
    const forceFile = process.env.BITEDLE_FORCE_FILE_STORE === "1";
    if (forceFile && process.env.NODE_ENV === "production") {
      throw new Error("BITEDLE_FORCE_FILE_STORE must never be enabled in production");
    }
    const databaseUrl = forceFile ? null : process.env.DATABASE_URL;
    if (databaseUrl) {
      globalRepository.__rngdleDiscordRepository = new NeonRngdleDiscordRepository(databaseUrl);
    } else {
      if (process.env.NODE_ENV === "production") {
        throw new Error("DATABASE_URL must be set in production");
      }
      globalRepository.__rngdleDiscordRepository = new FileRngdleDiscordRepository();
    }
  }
  return globalRepository.__rngdleDiscordRepository;
}
