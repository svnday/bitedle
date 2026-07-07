import fs from "node:fs";
import path from "node:path";
import type { GameRecord } from "./types";
import type { AllTimeRow, FinishedGame, Store, TodayRow, UserInfo } from "./store";

interface FileDb {
  users: Record<string, { name: string; createdAt: number; named?: boolean }>;
  /** games[date][userId] */
  games: Record<string, Record<string, GameRecord>>;
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
        return { users: raw.users, games: raw.games };
      }
    } catch {
      // Missing or corrupt file — start fresh.
    }
    return { users: {}, games: {} };
  }

  private persist(): void {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2), "utf8");
    fs.renameSync(tmp, DB_PATH);
  }

  async getUser(id: string): Promise<UserInfo | null> {
    const u = this.db.users[id];
    return u ? { name: u.name, named: !!u.named } : null;
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

  async getGame(date: string, userId: string): Promise<GameRecord | null> {
    const g = this.db.games[date]?.[userId];
    // Deep-copy so callers can't mutate stored state without putGame.
    return g ? (JSON.parse(JSON.stringify(g)) as GameRecord) : null;
  }

  async putGame(date: string, userId: string, game: GameRecord): Promise<void> {
    const byUser = (this.db.games[date] ??= {});
    if (byUser[userId] && byUser[userId].status !== "playing") return;
    byUser[userId] = game;
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

  async finishedGamesOn(date: string): Promise<TodayRow[]> {
    const out: TodayRow[] = [];
    for (const [userId, g] of Object.entries(this.db.games[date] ?? {})) {
      if (g.status === "playing") continue;
      out.push({
        userId,
        name: this.db.users[userId]?.name ?? "Player",
        status: g.status,
        score: g.score,
        clickCount: g.clicks.length,
        finishedAt: g.finishedAt ?? 0,
      });
    }
    return out;
  }

  async allFinishedGames(): Promise<AllTimeRow[]> {
    const out: AllTimeRow[] = [];
    for (const [date, byUser] of Object.entries(this.db.games)) {
      for (const [userId, g] of Object.entries(byUser)) {
        if (g.status === "playing") continue;
        out.push({
          userId,
          name: this.db.users[userId]?.name ?? "Player",
          date,
          status: g.status,
          score: g.score,
        });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }
}
