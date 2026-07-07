import crypto from "node:crypto";
import type { Db, GameRecord } from "./db";
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

/** Puzzle #1 launched on this date. */
export const EPOCH_DATE = "2026-07-06";

const MS_PER_DAY = 86_400_000;

/** Today's date in the server's local timezone, as YYYY-MM-DD. */
export function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
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
export function layoutFor(secret: string, date: string): CellResult[] {
  const digest = crypto.createHash("sha256").update(`${secret}:${date}`).digest();
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

export function gameFor(db: Db, userKey: string, date: string): GameRecord {
  return (
    db.games[date]?.[userKey] ?? { clicks: [], status: "playing", score: null, finishedAt: null }
  );
}

export function stateFor(db: Db, userKey: string, date: string): GameState {
  const game = gameFor(db, userKey, date);
  const state: GameState = {
    date,
    puzzleNumber: puzzleNumber(date),
    username: db.users[userKey]?.name ?? "Player",
    status: game.status,
    score: game.score,
    clicks: game.clicks,
  };
  if (game.status !== "playing") {
    state.checkIndex = layoutFor(db.secret, date).indexOf("check");
  }
  return state;
}

export function bucketFor(status: GameStatus, score: number | null): string {
  if (status !== "won" || score === null) return "X";
  return score <= 5 ? String(score) : "6+";
}

interface FinishedEntry {
  day: number;
  status: "won" | "lost";
  score: number | null;
}

function finishedGames(db: Db, userKey: string): FinishedEntry[] {
  const entries: FinishedEntry[] = [];
  for (const [date, games] of Object.entries(db.games)) {
    const g = games[userKey];
    if (g && g.status !== "playing") {
      entries.push({ day: dayNum(date), status: g.status, score: g.score });
    }
  }
  return entries.sort((a, b) => a.day - b.day);
}

export function computeUserStats(db: Db, userKey: string, today: string): UserStats {
  const entries = finishedGames(db, userKey);
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

export function computeLeaderboard(db: Db, today: string, meId: string | null): Leaderboard {
  const todayGames = db.games[today] ?? {};
  const todayEntries: (TodayEntry & { finishedAt: number })[] = [];
  for (const [key, g] of Object.entries(todayGames)) {
    if (g.status === "playing") continue;
    todayEntries.push({
      name: db.users[key]?.name ?? "Player",
      status: g.status,
      score: g.score,
      clicks: g.clicks.length,
      me: key === meId,
      finishedAt: g.finishedAt ?? 0,
    });
  }
  todayEntries.sort((a, b) => {
    if (a.status !== b.status) return a.status === "won" ? -1 : 1;
    if (a.status === "won" && a.score !== b.score) return (a.score ?? 0) - (b.score ?? 0);
    if (a.status === "lost" && a.clicks !== b.clicks) return b.clicks - a.clicks;
    return a.finishedAt - b.finishedAt;
  });

  const allTime: AllTimeEntry[] = [];
  for (const key of Object.keys(db.users)) {
    const s = computeUserStats(db, key, today);
    if (s.played === 0) continue;
    allTime.push({
      name: db.users[key].name,
      played: s.played,
      wins: s.wins,
      winPct: s.winPct,
      avgScore: s.avgScore,
      bestScore: s.bestScore,
      currentStreak: s.currentStreak,
      maxStreak: s.maxStreak,
      me: key === meId,
    });
  }
  allTime.sort((a, b) => {
    if (a.wins !== b.wins) return b.wins - a.wins;
    const avgA = a.avgScore ?? Number.POSITIVE_INFINITY;
    const avgB = b.avgScore ?? Number.POSITIVE_INFINITY;
    if (avgA !== avgB) return avgA - avgB;
    return a.name.localeCompare(b.name);
  });

  return {
    date: today,
    today: todayEntries
      .slice(0, 100)
      .map((e) => ({ name: e.name, status: e.status, score: e.score, clicks: e.clicks, me: e.me })),
    allTime: allTime.slice(0, 100),
  };
}
