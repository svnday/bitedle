import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { ClickRecord, GameStatus } from "./types";

export interface UserRecord {
  name: string;
  createdAt: number;
}

export interface GameRecord {
  clicks: ClickRecord[];
  status: GameStatus;
  score: number | null;
  finishedAt: number | null;
}

export interface Db {
  /** Server secret that seeds each day's board so clients can't precompute it. */
  secret: string;
  /** Keyed by anonymous player id (random UUID stored in the player's cookie). */
  users: Record<string, UserRecord>;
  /** games[date][userId] */
  games: Record<string, Record<string, GameRecord>>;
}

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

// Cache on globalThis so all route handlers (and dev HMR reloads) share one
// in-memory instance — concurrent requests mutate the same object, and writes
// just serialize it.
const globalStore = globalThis as unknown as { __bitedleDb?: Db };

export function getDb(): Db {
  if (!globalStore.__bitedleDb) {
    globalStore.__bitedleDb = loadFromDisk();
  }
  return globalStore.__bitedleDb;
}

function loadFromDisk(): Db {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const db = JSON.parse(raw) as Db;
    if (typeof db.secret === "string" && db.users && db.games) return db;
  } catch {
    // Missing or corrupt file — start fresh below.
  }
  const fresh: Db = {
    secret: crypto.randomBytes(32).toString("hex"),
    users: {},
    games: {},
  };
  persist(fresh);
  return fresh;
}

export function saveDb(): void {
  persist(getDb());
}

function persist(db: Db): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tmp, DB_PATH);
}

export const AUTH_COOKIE = "bitedle_id";

export function newUserId(): string {
  return crypto.randomUUID();
}

export function defaultName(id: string): string {
  return `Player-${id.slice(0, 4)}`;
}

/**
 * Cleans a free-form display name: strips control characters, collapses
 * whitespace, caps the length. Returns null if nothing usable remains.
 */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw
    .replace(/\p{C}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20)
    .trim();
  return name.length > 0 ? name : null;
}

/** Returns the player id from the cookie, or null if unknown/absent. */
export function userIdFromCookie(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null;
  return getDb().users[cookieValue] ? cookieValue : null;
}
