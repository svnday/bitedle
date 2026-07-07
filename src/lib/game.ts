import crypto from "node:crypto";
import { getStore, type FinishedGame } from "./store";
import { nextResetAt, todayStr } from "./time";
import {
  BOARD_SIZE,
  MIN_BOMBS,
  MAX_BOMBS,
  type AllTimeEntry,
  type CellResult,
  type GameState,
  type GameStatus,
  type Leaderboard,
  type TodayEntry,
  type UserStats,
} from "./types";

export { todayStr };

/** Puzzle #1 launched on this date. */
export const EPOCH_DATE = "2026-07-06";

const MS_PER_DAY = 86_400_000;
const DEV_SECRET = "bitedle-dev-secret-not-for-production";

let warnedDevSecret = false;

/** The secret that seeds each day's board so clients can't precompute it. */
function boardSecret(): string {
  const secret = process.env.BITEDLE_SECRET;
  if (secret && secret.length >= 8) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("BITEDLE_SECRET must be set in production (any long random string)");
  }
  if (!warnedDevSecret) {
    warnedDevSecret = true;
    console.warn("Bitedle: BITEDLE_SECRET not set — using a fixed dev secret");
  }
  return DEV_SECRET;
}

function dayNum(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / MS_PER_DAY);
}

export function puzzleNumber(date: string): number {
  return dayNum(date) - dayNum(EPOCH_DATE) + 1;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The day's hidden board: exactly one check, 3–5 bombs, red X everywhere else.
 * Deterministic per (secret, date) so every player gets the same board, but
 * unguessable without the server secret.
 */
export function layoutFor(date: string): CellResult[] {
  const digest = crypto.createHash("sha256").update(`${boardSecret()}:${date}`).digest();
  const rng = mulberry32(digest.readUInt32LE(0));

  const bombCount = MIN_BOMBS + Math.floor(rng() * (MAX_BOMBS - MIN_BOMBS + 1));
  const indices = Array.from({ length: BOARD_SIZE }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  const cells: CellResult[] = Array(BOARD_SIZE).fill("x");
  cells[indices[0]] = "check";
  for (let i = 1; i <= bombCount; i++) cells[indices[i]] = "bomb";
  return cells;
}

export async function stateFor(userId: string, date: string): Promise<GameState> {
  const store = getStore();
  const [game, user] = await Promise.all([store.getGame(date, userId), store.getUser(userId)]);
  const status = game?.status ?? "playing";
  const state: GameState = {
    date,
    puzzleNumber: puzzleNumber(date),
    username: user?.name ?? "Player",
    named: user?.named ?? false,
    status,
    score: game?.score ?? null,
    clicks: game?.clicks ?? [],
    nextResetAt: nextResetAt(),
  };
  if (status !== "playing") {
    state.checkIndex = layoutFor(date).indexOf("check");
  }
  return state;
}

export function bucketFor(status: GameStatus, score: number | null): string {
  if (status !== "won" || score === null) return "X";
  return score <= 5 ? String(score) : "6+";
}

/** Aggregates a player's finished games (any order) into their stats. */
export function statsFromGames(games: FinishedGame[], today: string): UserStats {
  const entries = games
    .map((g) => ({ day: dayNum(g.date), status: g.status, score: g.score }))
    .sort((a, b) => a.day - b.day);
  const winScores = entries.filter((e) => e.status === "won").map((e) => e.score ?? 0);

  const distribution: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6+": 0, X: 0 };
  for (const e of entries) distribution[bucketFor(e.status, e.score)]++;

  // Max streak: longest run of wins on consecutive calendar days.
  let maxStreak = 0;
  let run = 0;
  let prevWinDay: number | null = null;
  for (const e of entries) {
    if (e.status === "won") {
      run = prevWinDay !== null && e.day === prevWinDay + 1 ? run + 1 : 1;
      prevWinDay = e.day;
      if (run > maxStreak) maxStreak = run;
    } else {
      run = 0;
      prevWinDay = null;
    }
  }

  // Current streak: consecutive wins ending today (or yesterday, if today
  // hasn't been played yet).
  const byDay = new Map(entries.map((e) => [e.day, e.status]));
  let d = dayNum(today);
  if (!byDay.has(d)) d -= 1;
  let currentStreak = 0;
  while (byDay.get(d) === "won") {
    currentStreak++;
    d--;
  }

  const played = entries.length;
  const wins = winScores.length;
  return {
    played,
    wins,
    winPct: played === 0 ? 0 : Math.round((wins / played) * 100),
    currentStreak,
    maxStreak,
    bestScore: wins === 0 ? null : Math.min(...winScores),
    avgScore: wins === 0 ? null : Math.round((winScores.reduce((a, b) => a + b, 0) / wins) * 10) / 10,
    distribution,
  };
}

export async function computeUserStats(userId: string, today: string): Promise<UserStats> {
  return statsFromGames(await getStore().finishedGamesFor(userId), today);
}

export async function computeLeaderboard(today: string, meId: string | null): Promise<Leaderboard> {
  const store = getStore();
  const [todayRows, allRows] = await Promise.all([
    store.finishedGamesOn(today),
    store.allFinishedGames(),
  ]);

  const todayEntries = todayRows
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "won" ? -1 : 1;
      if (a.status === "won" && a.score !== b.score) return (a.score ?? 0) - (b.score ?? 0);
      if (a.status === "lost" && a.clickCount !== b.clickCount) return b.clickCount - a.clickCount;
      return a.finishedAt - b.finishedAt;
    })
    .slice(0, 100)
    .map(
      (r): TodayEntry => ({
        name: r.name,
        status: r.status,
        score: r.score,
        clicks: r.clickCount,
        me: r.userId === meId,
      }),
    );

  const byUser = new Map<string, { name: string; games: FinishedGame[] }>();
  for (const r of allRows) {
    const u = byUser.get(r.userId) ?? { name: r.name, games: [] };
    u.name = r.name;
    u.games.push(r);
    byUser.set(r.userId, u);
  }
  const allTime: AllTimeEntry[] = [];
  for (const [userId, u] of byUser) {
    const s = statsFromGames(u.games, today);
    allTime.push({
      name: u.name,
      played: s.played,
      wins: s.wins,
      winPct: s.winPct,
      avgScore: s.avgScore,
      bestScore: s.bestScore,
      currentStreak: s.currentStreak,
      maxStreak: s.maxStreak,
      me: userId === meId,
    });
  }
  allTime.sort((a, b) => {
    if (a.wins !== b.wins) return b.wins - a.wins;
    const avgA = a.avgScore ?? Number.POSITIVE_INFINITY;
    const avgB = b.avgScore ?? Number.POSITIVE_INFINITY;
    if (avgA !== avgB) return avgA - avgB;
    return a.name.localeCompare(b.name);
  });

  return { date: today, today: todayEntries, allTime: allTime.slice(0, 100) };
}
