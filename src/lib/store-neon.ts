import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { GameRecord, MegaClickRecord, MegaGameRecord } from "./types";
import {
  LIVE_PREVIEW_POSTING,
  type AllTimeRow,
  type FinishedGame,
  type LivePreviewMessage,
  type LivePreviewRow,
  type Store,
  type TodayRow,
  type UserInfo,
} from "./store";

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
      // When the player last opened the Activity — scopes the live preview to
      // one launch window (see stampLaunch / livePreviewGamesOn).
      await this.sql`ALTER TABLE games ADD COLUMN IF NOT EXISTS launched_at bigint`;
      await this.sql`CREATE INDEX IF NOT EXISTS games_user_idx ON games (user_id)`;
      await this.sql`
        CREATE TABLE IF NOT EXISTS games_mega (
          date text NOT NULL,
          user_id uuid NOT NULL REFERENCES users(id),
          clicks jsonb NOT NULL DEFAULT '[]',
          status text NOT NULL DEFAULT 'playing',
          score int,
          finished_at bigint,
          PRIMARY KEY (date, user_id)
        )`;
      await this.sql`CREATE INDEX IF NOT EXISTS games_mega_user_idx ON games_mega (user_id)`;
      await this.sql`
        CREATE TABLE IF NOT EXISTS guild_channels (
          guild_id text PRIMARY KEY,
          channel_id text NOT NULL,
          updated_at bigint NOT NULL
        )`;
      await this.sql`ALTER TABLE guild_channels ADD COLUMN IF NOT EXISTS live_preview_date text`;
      await this.sql`ALTER TABLE guild_channels ADD COLUMN IF NOT EXISTS live_preview_message_id text`;
      await this.sql`ALTER TABLE guild_channels ADD COLUMN IF NOT EXISTS live_preview_updated_at bigint`;
      await this.sql`ALTER TABLE guild_channels ADD COLUMN IF NOT EXISTS live_preview_application_id text`;
      await this.sql`ALTER TABLE guild_channels ADD COLUMN IF NOT EXISTS live_preview_webhook_token text`;
      await this.sql`ALTER TABLE guild_channels ADD COLUMN IF NOT EXISTS live_preview_token_created_at bigint`;
      // Server day the guild's daily recap was last posted for.
      await this.sql`ALTER TABLE guild_channels ADD COLUMN IF NOT EXISTS recap_posted_date text`;

      // One-time dedupe of players who linked the same Discord id from
      // several devices before identify learned to merge (cheap no-ops once
      // clean). Canonical row = oldest per discord_user_id; same shape as
      // mergeUsers, but set-based across all duplicates at once.
      // A: give the canonical user the best duplicate game for each date it
      //    lacks (prefer finished over playing, then earliest finish).
      await this.sql`
        WITH canon AS (
          SELECT DISTINCT ON (discord_user_id) discord_user_id, id
          FROM users WHERE discord_user_id IS NOT NULL
          ORDER BY discord_user_id, created_at ASC, id ASC
        ), dup AS (
          SELECT u.id AS dup_id, c.id AS canon_id
          FROM users u JOIN canon c ON c.discord_user_id = u.discord_user_id
          WHERE u.id <> c.id
        ), movable AS (
          SELECT DISTINCT ON (d.canon_id, g.date) g.date, g.user_id AS dup_id, d.canon_id
          FROM games g JOIN dup d ON d.dup_id = g.user_id
          WHERE NOT EXISTS (SELECT 1 FROM games g2 WHERE g2.date = g.date AND g2.user_id = d.canon_id)
          ORDER BY d.canon_id, g.date, (g.status = 'playing') ASC, g.finished_at ASC NULLS LAST, g.user_id
        )
        UPDATE games g SET user_id = m.canon_id
        FROM movable m WHERE g.date = m.date AND g.user_id = m.dup_id`;
      // B: remaining duplicate-user games all conflict by date; drop them.
      await this.sql`
        WITH canon AS (
          SELECT DISTINCT ON (discord_user_id) discord_user_id, id
          FROM users WHERE discord_user_id IS NOT NULL
          ORDER BY discord_user_id, created_at ASC, id ASC
        )
        DELETE FROM games g
        USING users u, canon c
        WHERE g.user_id = u.id AND u.discord_user_id = c.discord_user_id AND u.id <> c.id`;
      // C: anonymize the duplicate user rows (same SET as mergeUsers).
      await this.sql`
        WITH canon AS (
          SELECT DISTINCT ON (discord_user_id) discord_user_id, id
          FROM users WHERE discord_user_id IS NOT NULL
          ORDER BY discord_user_id, created_at ASC, id ASC
        )
        UPDATE users u SET discord_user_id = NULL, discord_avatar = NULL, named = false
        FROM canon c
        WHERE u.discord_user_id = c.discord_user_id AND u.id <> c.id`;
      // Guard against new duplicates. Separate try/catch: if a duplicate
      // races in mid-migration, a rejected this.ready would otherwise be
      // cached forever; skipping lets the next cold start dedupe and retry.
      try {
        await this.sql`
          CREATE UNIQUE INDEX IF NOT EXISTS users_discord_user_id_uq
          ON users (discord_user_id) WHERE discord_user_id IS NOT NULL`;
      } catch {
        // Dups exist right now; the next cold start deduplicates and retries.
      }
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

  async getUserIdByDiscordId(discordUserId: string): Promise<string | null> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT id FROM users WHERE discord_user_id = ${discordUserId}
      ORDER BY created_at ASC, id ASC LIMIT 1`;
    return rows.length === 0 ? null : (rows[0].id as string);
  }

  async mergeUsers(fromUserId: string, toUserId: string): Promise<void> {
    await this.ensureSchema();
    // Three auto-committed statements (the Neon HTTP driver has no
    // transactions), sequenced so a crash between any two leaves the orphan
    // still Discord-linked — the next identify simply re-runs the merge.
    // Deliberately no error handling between steps: continuing past a failed
    // transfer into the DELETE would destroy transferable games.
    await this.sql`
      UPDATE games g SET user_id = ${toUserId}
      WHERE g.user_id = ${fromUserId}
        AND NOT EXISTS (SELECT 1 FROM games g2 WHERE g2.date = g.date AND g2.user_id = ${toUserId})`;
    // Whatever remains on the orphan conflicts by date; canonical wins.
    await this.sql`DELETE FROM games WHERE user_id = ${fromUserId}`;
    await this.sql`
      UPDATE games_mega g SET user_id = ${toUserId}
      WHERE g.user_id = ${fromUserId}
        AND NOT EXISTS (
          SELECT 1 FROM games_mega g2 WHERE g2.date = g.date AND g2.user_id = ${toUserId}
        )`;
    await this.sql`DELETE FROM games_mega WHERE user_id = ${fromUserId}`;
    // Anonymize: unlinked (lookup never returns it), unnamed (hidden from
    // leaderboards), and with no games left it can't reach livePreviewGamesOn.
    await this.sql`
      UPDATE users SET discord_user_id = NULL, discord_avatar = NULL, named = false
      WHERE id = ${fromUserId}`;
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

  async stampLaunch(date: string, userId: string, at: number): Promise<void> {
    await this.ensureSchema();
    // The caller ensures the game row exists first; a no-op otherwise. Allowed
    // on finished games too — launched_at is launch metadata, not game state.
    await this.sql`
      UPDATE games SET launched_at = ${at} WHERE date = ${date} AND user_id = ${userId}`;
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
      SELECT g.user_id, u.name, u.discord_user_id, u.discord_avatar, g.status, g.score, g.clicks,
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
      clicks: r.clicks as TodayRow["clicks"],
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

  async getMegaGame(date: string, userId: string): Promise<MegaGameRecord | null> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT clicks, status, score, finished_at
      FROM games_mega WHERE date = ${date} AND user_id = ${userId}`;
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      clicks: row.clicks as MegaGameRecord["clicks"],
      status: row.status as MegaGameRecord["status"],
      score: row.score === null ? null : Number(row.score),
      finishedAt: row.finished_at === null ? null : Number(row.finished_at),
    };
  }

  async putMegaGame(date: string, userId: string, game: MegaGameRecord): Promise<void> {
    await this.ensureSchema();
    await this.sql`
      INSERT INTO games_mega (date, user_id, clicks, status, score, finished_at)
      VALUES (${date}, ${userId}, ${JSON.stringify(game.clicks)}::jsonb,
              ${game.status}, ${game.score}, ${game.finishedAt})
      ON CONFLICT (date, user_id) DO UPDATE
      SET clicks = EXCLUDED.clicks, status = EXCLUDED.status,
          score = EXCLUDED.score, finished_at = EXCLUDED.finished_at
      WHERE games_mega.status = 'playing'`;
  }

  async finishedMegaGamesFor(userId: string): Promise<FinishedGame[]> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT date, status, score FROM games_mega
      WHERE user_id = ${userId} AND status <> 'playing'
      ORDER BY date`;
    return rows.map((row) => ({
      date: row.date as string,
      status: row.status as FinishedGame["status"],
      score: row.score === null ? null : Number(row.score),
    }));
  }

  async finishedMegaGamesOn(date: string): Promise<TodayRow<MegaClickRecord>[]> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT g.user_id, u.name, u.discord_user_id, u.discord_avatar,
             g.status, g.score, g.clicks,
             jsonb_array_length(g.clicks) AS click_count, g.finished_at
      FROM games_mega g JOIN users u ON u.id = g.user_id
      WHERE g.date = ${date} AND g.status <> 'playing' AND u.named`;
    return rows.map((row) => ({
      userId: row.user_id as string,
      name: row.name as string,
      discordUserId: row.discord_user_id as string | null,
      discordAvatar: row.discord_avatar as string | null,
      status: row.status as TodayRow["status"],
      score: row.score === null ? null : Number(row.score),
      clicks: row.clicks as MegaClickRecord[],
      clickCount: Number(row.click_count),
      finishedAt: row.finished_at === null ? 0 : Number(row.finished_at),
    }));
  }

  async allFinishedMegaGames(): Promise<AllTimeRow[]> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT g.user_id, u.name, u.discord_user_id, u.discord_avatar,
             g.date, g.status, g.score
      FROM games_mega g JOIN users u ON u.id = g.user_id
      WHERE g.status <> 'playing' AND u.named
      ORDER BY g.date`;
    return rows.map((row) => ({
      userId: row.user_id as string,
      name: row.name as string,
      discordUserId: row.discord_user_id as string | null,
      discordAvatar: row.discord_avatar as string | null,
      date: row.date as string,
      status: row.status as AllTimeRow["status"],
      score: row.score === null ? null : Number(row.score),
    }));
  }

  async setGuildChannel(guildId: string, channelId: string): Promise<void> {
    await this.ensureSchema();
    await this.sql`
      INSERT INTO guild_channels (guild_id, channel_id, updated_at)
      VALUES (${guildId}, ${channelId}, ${Date.now()})
      ON CONFLICT (guild_id) DO UPDATE SET channel_id = EXCLUDED.channel_id, updated_at = EXCLUDED.updated_at`;
  }

  async livePreviewGamesOn(guildId: string, sinceLaunchedAt: number): Promise<LivePreviewRow[]> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT g.user_id, u.name, u.discord_user_id, u.discord_avatar,
             g.date, g.status, g.score, g.clicks, g.finished_at
      FROM games g JOIN users u ON u.id = g.user_id
      WHERE g.guild_id = ${guildId}
        AND u.discord_user_id IS NOT NULL
        AND g.launched_at IS NOT NULL AND g.launched_at >= ${sinceLaunchedAt}
      ORDER BY g.launched_at ASC, g.user_id`;
    return rows.map((r) => ({
      userId: r.user_id as string,
      name: r.name as string,
      discordUserId: r.discord_user_id as string | null,
      discordAvatar: r.discord_avatar as string | null,
      date: r.date as string,
      status: r.status as LivePreviewRow["status"],
      score: r.score === null ? null : Number(r.score),
      clicks: r.clicks as LivePreviewRow["clicks"],
      finishedAt: r.finished_at === null ? null : Number(r.finished_at),
    }));
  }

  async getLivePreviewMessage(guildId: string, date: string): Promise<LivePreviewMessage | null> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT live_preview_application_id, live_preview_webhook_token,
             live_preview_token_created_at, live_preview_message_id, live_preview_updated_at,
             recap_posted_date
      FROM guild_channels
      WHERE guild_id = ${guildId} AND live_preview_date = ${date}`;
    if (
      rows.length === 0 ||
      rows[0].live_preview_application_id === null ||
      rows[0].live_preview_webhook_token === null
    ) {
      return null;
    }
    return {
      guildId,
      date,
      applicationId: rows[0].live_preview_application_id as string,
      webhookToken: rows[0].live_preview_webhook_token as string,
      tokenCreatedAt:
        rows[0].live_preview_token_created_at === null
          ? 0
          : Number(rows[0].live_preview_token_created_at),
      messageId: rows[0].live_preview_message_id as string | null,
      updatedAt: rows[0].live_preview_updated_at === null ? 0 : Number(rows[0].live_preview_updated_at),
      recapPostedDate: rows[0].recap_posted_date as string | null,
    };
  }

  async setLivePreviewMessage(message: LivePreviewMessage): Promise<void> {
    await this.ensureSchema();
    // channel_id '' only matters on the INSERT path — in practice the row
    // already exists, written by setGuildChannel before any preview update.
    await this.sql`
      INSERT INTO guild_channels (
        guild_id, channel_id, updated_at,
        live_preview_date, live_preview_application_id, live_preview_webhook_token,
        live_preview_token_created_at, live_preview_message_id, live_preview_updated_at
      )
      VALUES (
        ${message.guildId}, '', ${Date.now()},
        ${message.date}, ${message.applicationId}, ${message.webhookToken},
        ${message.tokenCreatedAt}, ${message.messageId}, ${message.updatedAt}
      )
      ON CONFLICT (guild_id) DO UPDATE
      SET live_preview_date = EXCLUDED.live_preview_date,
          live_preview_application_id = EXCLUDED.live_preview_application_id,
          live_preview_webhook_token = EXCLUDED.live_preview_webhook_token,
          live_preview_token_created_at = EXCLUDED.live_preview_token_created_at,
          live_preview_message_id = EXCLUDED.live_preview_message_id,
          live_preview_updated_at = EXCLUDED.live_preview_updated_at`;
  }

  async claimLivePreviewPost(guildId: string, date: string): Promise<boolean> {
    await this.ensureSchema();
    const rows = await this.sql`
      UPDATE guild_channels SET live_preview_message_id = ${LIVE_PREVIEW_POSTING}
      WHERE guild_id = ${guildId} AND live_preview_date = ${date}
        AND live_preview_message_id IS NULL
      RETURNING guild_id`;
    return rows.length > 0;
  }

  async releaseLivePreviewPost(guildId: string, date: string): Promise<void> {
    await this.ensureSchema();
    await this.sql`
      UPDATE guild_channels SET live_preview_message_id = NULL
      WHERE guild_id = ${guildId} AND live_preview_date = ${date}
        AND live_preview_message_id = ${LIVE_PREVIEW_POSTING}`;
  }

  async clearLivePreviewMessageId(guildId: string, date: string, messageId: string): Promise<void> {
    await this.ensureSchema();
    await this.sql`
      UPDATE guild_channels SET live_preview_message_id = NULL
      WHERE guild_id = ${guildId} AND live_preview_date = ${date}
        AND live_preview_message_id = ${messageId}`;
  }

  async claimDailyRecap(guildId: string, date: string): Promise<boolean> {
    await this.ensureSchema();
    // Auto-committed single statement — the concurrency gate for two members
    // both active right after the recap hour.
    const rows = await this.sql`
      UPDATE guild_channels SET recap_posted_date = ${date}
      WHERE guild_id = ${guildId}
        AND (recap_posted_date IS NULL OR recap_posted_date <> ${date})
      RETURNING guild_id`;
    return rows.length > 0;
  }

  async releaseDailyRecap(guildId: string, date: string): Promise<void> {
    await this.ensureSchema();
    await this.sql`
      UPDATE guild_channels SET recap_posted_date = NULL
      WHERE guild_id = ${guildId} AND recap_posted_date = ${date}`;
  }
}
