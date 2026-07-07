import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { GameRecord } from "./types";
import type { AllTimeRow, FinishedGame, Store, TodayRow, UserInfo } from "./store";

/**
 * Postgres (Neon) storage. The schema is created lazily on first use, so a
 * fresh database needs no manual migration step.
 */
export class NeonStore implements Store {
  private sql: NeonQueryFunction<false, false>;
  private ready: Promise<void> | null = null;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  private ensureSchema(): Promise<void> {
    this.ready ??= (async () => {
      await this.sql`
        CREATE TABLE IF NOT EXISTS users (
          id uuid PRIMARY KEY,
          name text NOT NULL,
          named boolean NOT NULL DEFAULT false,
          created_at bigint NOT NULL
        )`;
      // Upgrades tables created before these columns existed.
      await this.sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS named boolean NOT NULL DEFAULT false`;
      await this.sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_user_id text`;
      await this.sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_avatar text`;
      await this.sql`
        CREATE TABLE IF NOT EXISTS games (
          date text NOT NULL,
          user_id uuid NOT NULL REFERENCES users(id),
          clicks jsonb NOT NULL DEFAULT '[]',
          status text NOT NULL DEFAULT 'playing',
          score int,
          finished_at bigint,
          PRIMARY KEY (date, user_id)
        )`;
      await this.sql`ALTER TABLE games ADD COLUMN IF NOT EXISTS guild_id text`;
      await this.sql`CREATE INDEX IF NOT EXISTS games_user_idx ON games (user_id)`;
    })();
    return this.ready;
  }

  async getUser(id: string): Promise<UserInfo | null> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT name, named, discord_user_id, discord_avatar FROM users WHERE id = ${id}`;
    if (rows.length === 0) return null;
    return {
      name: rows[0].name as string,
      named: Boolean(rows[0].named),
      discordUserId: rows[0].discord_user_id as string | null,
      discordAvatar: rows[0].discord_avatar as string | null,
    };
  }

  async createUser(id: string, name: string): Promise<void> {
    await this.ensureSchema();
    await this.sql`
      INSERT INTO users (id, name, created_at)
      VALUES (${id}, ${name}, ${Date.now()})
      ON CONFLICT (id) DO NOTHING`;
  }

  async setUserName(id: string, name: string): Promise<void> {
    await this.ensureSchema();
    await this.sql`UPDATE users SET name = ${name}, named = true WHERE id = ${id}`;
  }

  async setDiscordIdentity(
    userId: string,
    discordUserId: string,
    discordAvatar: string | null,
  ): Promise<void> {
    await this.ensureSchema();
    await this.sql`
      UPDATE users SET discord_user_id = ${discordUserId}, discord_avatar = ${discordAvatar}
      WHERE id = ${userId}`;
  }

  async getGame(date: string, userId: string): Promise<GameRecord | null> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT clicks, status, score, finished_at, guild_id
      FROM games WHERE date = ${date} AND user_id = ${userId}`;
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      clicks: r.clicks as GameRecord["clicks"],
      status: r.status as GameRecord["status"],
      score: r.score === null ? null : Number(r.score),
      finishedAt: r.finished_at === null ? null : Number(r.finished_at),
      guildId: r.guild_id as string | null,
    };
  }

  async putGame(date: string, userId: string, game: GameRecord): Promise<void> {
    await this.ensureSchema();
    // The WHERE guard makes finished games immutable even under a race.
    // guild_id is intentionally excluded from the UPDATE SET list, so it's
    // written once on insert and never changes on later clicks that day.
    await this.sql`
      INSERT INTO games (date, user_id, clicks, status, score, finished_at, guild_id)
      VALUES (${date}, ${userId}, ${JSON.stringify(game.clicks)}::jsonb,
              ${game.status}, ${game.score}, ${game.finishedAt}, ${game.guildId})
      ON CONFLICT (date, user_id) DO UPDATE
      SET clicks = EXCLUDED.clicks, status = EXCLUDED.status,
          score = EXCLUDED.score, finished_at = EXCLUDED.finished_at
      WHERE games.status = 'playing'`;
  }

  async finishedGamesFor(userId: string): Promise<FinishedGame[]> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT date, status, score FROM games
      WHERE user_id = ${userId} AND status <> 'playing'
      ORDER BY date`;
    return rows.map((r) => ({
      date: r.date as string,
      status: r.status as FinishedGame["status"],
      score: r.score === null ? null : Number(r.score),
    }));
  }

  async finishedGamesOn(date: string, guildId: string | null): Promise<TodayRow[]> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT g.user_id, u.name, u.discord_user_id, u.discord_avatar, g.status, g.score,
             jsonb_array_length(g.clicks) AS click_count, g.finished_at
      FROM games g JOIN users u ON u.id = g.user_id
      WHERE g.date = ${date} AND g.status <> 'playing' AND u.named
        AND g.guild_id IS NOT DISTINCT FROM ${guildId}`;
    return rows.map((r) => ({
      userId: r.user_id as string,
      name: r.name as string,
      discordUserId: r.discord_user_id as string | null,
      discordAvatar: r.discord_avatar as string | null,
      status: r.status as TodayRow["status"],
      score: r.score === null ? null : Number(r.score),
      clickCount: Number(r.click_count),
      finishedAt: r.finished_at === null ? 0 : Number(r.finished_at),
    }));
  }

  async allFinishedGames(guildId: string | null): Promise<AllTimeRow[]> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT g.user_id, u.name, u.discord_user_id, u.discord_avatar, g.date, g.status, g.score
      FROM games g JOIN users u ON u.id = g.user_id
      WHERE g.status <> 'playing' AND u.named
        AND g.guild_id IS NOT DISTINCT FROM ${guildId}
      ORDER BY g.date`;
    return rows.map((r) => ({
      userId: r.user_id as string,
      name: r.name as string,
      discordUserId: r.discord_user_id as string | null,
      discordAvatar: r.discord_avatar as string | null,
      date: r.date as string,
      status: r.status as AllTimeRow["status"],
      score: r.score === null ? null : Number(r.score),
    }));
  }
}
