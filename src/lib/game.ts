import crypto from "node:crypto";
import { discordAvatarUrl } from "./discord";
import { getStore, type AllTimeRow, type FinishedGame } from "./store";
import { nextResetAt, shiftDay, todayStr } from "./time";
import {
  BOARD_SIZE,
  DAILY_BOMB_COUNT,
  FIXED_BOMB_COUNT_FROM,
  MAX_BOMBS,
  MIN_BOMBS,
  type AllTimeEntry,
  type CellResult,
  type GameState,
  type GameStatus,
  type Leaderboard,
  type TodayEntry,
  type UserStats,
} from "./types";

export { todayStr };

/** The puzzle number that launched on EPOCH_DATE. */
const FIRST_PUZZLE = 257;
export const EPOCH_DATE = "2026-07-07";

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
  return dayNum(date) - dayNum(EPOCH_DATE) + FIRST_PUZZLE;
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

/** The day's deterministic draw: a shuffled cell order plus its bomb count.
 *  The raw check spot is `indices[0]`, bombs are `indices[1..bombCount]`. */
function boardDraw(date: string): { indices: number[]; bombCount: number } {
  const digest = crypto.createHash("sha256").update(`${boardSecret()}:${date}`).digest();
  const rng = mulberry32(digest.readUInt32LE(0));

  // Keep consuming the legacy count draw so fixing the count does not also
  // reshuffle every check and bomb position from this date onward.
  const legacyBombCount = MIN_BOMBS + Math.floor(rng() * (MAX_BOMBS - MIN_BOMBS + 1));
  const bombCount = date >= FIXED_BOMB_COUNT_FROM ? DAILY_BOMB_COUNT : legacyBombCount;
  const indices = Array.from({ length: BOARD_SIZE }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return { indices, bombCount };
}

/**
 * Boards from these dates on avoid day-over-day repetition; earlier boards
 * keep the raw draw untouched. A board must never change for a date players
 * may already have clicked on, and with per-player local resets the
 * furthest-ahead timezone (UTC+14) is more than a day past the server clock —
 * so each rule anchors at a date that was unreachable by any player before
 * that rule shipped (the bomb rule shipped a day after the check rule, hence
 * the two cutoffs).
 */
const CHECK_MOVE_FROM = "2026-07-13"; // check never repeats yesterday's cell
const BOMB_MOVE_FROM = "2026-07-14"; // at most 1 bomb repeats a yesterday-bomb cell

/** A date's final board contents after the anti-repeat rules. */
interface FinalDraw {
  checkIndex: number;
  bombIndices: number[];
}

/** Untouched raw draw — how every board was built before the cutoffs. */
function rawFinalDraw(date: string): FinalDraw {
  const { indices, bombCount } = boardDraw(date);
  return { checkIndex: indices[0], bombIndices: indices.slice(1, bombCount + 1) };
}

/** date -> final draw, so the day-chain below is walked once per process. */
const finalDrawMemo = new Map<string, FinalDraw>();

/**
 * A date's board after the anti-repeat rules:
 * - Check (from CHECK_MOVE_FROM): a draw landing on yesterday's (final) check
 *   position moves to the last shuffled cell instead — always a plain miss,
 *   and never yesterday's spot, since it can't equal the colliding first cell.
 * - Bombs (from BOMB_MOVE_FROM): bombs fill from the shuffle order, skipping
 *   the check cell and allowing at most one cell that was a bomb yesterday
 *   (further repeats are skipped in favor of deeper shuffle cells; 24
 *   candidates minus ≤1 check and ≤4 skips always leaves enough).
 * Yesterday's final board may itself have been adjusted, so the chain is
 * computed forward from the cutoff (memoized; one hash+shuffle per elapsed
 * day, only on first use).
 */
function finalDrawFor(date: string): FinalDraw {
  if (date < CHECK_MOVE_FROM) return rawFinalDraw(date);
  const cached = finalDrawMemo.get(date);
  if (cached) return cached;

  const chain: string[] = [];
  let d = date;
  while (d >= CHECK_MOVE_FROM && !finalDrawMemo.has(d)) {
    chain.push(d);
    d = shiftDay(d, -1);
  }
  let prev = d < CHECK_MOVE_FROM ? rawFinalDraw(d) : finalDrawMemo.get(d)!;
  for (let i = chain.length - 1; i >= 0; i--) {
    const day = chain[i];
    const { indices, bombCount } = boardDraw(day);
    const checkIndex = indices[0] === prev.checkIndex ? indices[BOARD_SIZE - 1] : indices[0];

    let bombIndices: number[];
    if (day < BOMB_MOVE_FROM) {
      bombIndices = indices.slice(1, bombCount + 1);
    } else {
      const prevBombs = new Set(prev.bombIndices);
      bombIndices = [];
      let repeatUsed = false;
      for (let k = 1; k < BOARD_SIZE && bombIndices.length < bombCount; k++) {
        const cell = indices[k];
        if (cell === checkIndex) continue;
        if (prevBombs.has(cell)) {
          if (repeatUsed) continue;
          repeatUsed = true;
        }
        bombIndices.push(cell);
      }
    }

    prev = { checkIndex, bombIndices };
    finalDrawMemo.set(day, prev);
  }
  return finalDrawMemo.get(date)!;
}

/**
 * The day's hidden board: exactly one check, three bombs for every new puzzle,
 * and red X everywhere else. Pre-cutover boards retain their original count.
 * Deterministic per (secret, date) so every player gets the same board, but
 * unguessable without the server secret. Day-over-day, the check never sits
 * where it sat yesterday and at most one bomb does (see finalDrawFor).
 */
export function layoutFor(date: string): CellResult[] {
  const { checkIndex, bombIndices } = finalDrawFor(date);
  const cells: CellResult[] = Array(BOARD_SIZE).fill("x");
  cells[checkIndex] = "check";
  for (const bomb of bombIndices) cells[bomb] = "bomb";
  return cells;
}

export async function stateFor(
  userId: string,
  date: string,
  timeZone?: string,
): Promise<GameState> {
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
    // Countdown to the player's own local midnight (falls back to game tz).
    nextResetAt: nextResetAt(new Date(), timeZone),
  };
  if (status !== "playing") {
    state.layout = layoutFor(date);
  }
  return state;
}

export function bucketFor(status: GameStatus, score: number | null): string {
  if (status !== "won" || score === null) return "X";
  return score <= 5 ? String(score) : "6+";
}

function distributionFromEntries(entries: { status: GameStatus; score: number | null }[]): Record<string, number> {
  const distribution: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6+": 0, X: 0 };
  for (const e of entries) distribution[bucketFor(e.status, e.score)]++;
  return distribution;
}

/** Aggregates a player's finished games (any order) into their stats. */
export function statsFromGames(games: FinishedGame[], today: string): UserStats {
  const entries = games
    .map((g) => ({ day: dayNum(g.date), status: g.status, score: g.score }))
    .sort((a, b) => a.day - b.day);
  const winScores = entries.filter((e) => e.status === "won").map((e) => e.score ?? 0);

  const distribution = distributionFromEntries(entries);

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

export function channelStatsFromGames(games: AllTimeRow[], today: string): UserStats {
  const entries = games
    .map((g) => ({ day: dayNum(g.date), status: g.status, score: g.score }))
    .sort((a, b) => a.day - b.day);

  const played = entries.length;
  const wins = entries.filter((e) => e.status === "won").length;
  const distribution = distributionFromEntries(entries);

  const byDay = new Set(entries.map((e) => e.day));
  let d = dayNum(today);
  if (!byDay.has(d)) d -= 1;
  let currentStreak = 0;
  while (byDay.has(d)) {
    currentStreak++;
    d--;
  }

  return {
    played,
    wins,
    winPct: played === 0 ? 0 : Math.round((wins / played) * 100),
    currentStreak,
    maxStreak: 0,
    bestScore: null,
    avgScore: null,
    distribution,
  };
}

export async function computeUserStats(userId: string, today: string): Promise<UserStats> {
  return statsFromGames(await getStore().finishedGamesFor(userId), today);
}

export async function computeLeaderboard(
  today: string,
  meId: string | null,
  guildId: string | null,
): Promise<Leaderboard> {
  const store = getStore();
  const [todayRows, allRows, myGame] = await Promise.all([
    store.finishedGamesOn(today, guildId),
    store.allFinishedGames(guildId),
    meId !== null && guildId !== null ? store.getGame(today, meId) : Promise.resolve(null),
  ]);
  const revealBoards = guildId !== null && myGame !== null && myGame.status !== "playing";

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
        discordAvatarUrl: discordAvatarUrl(r.discordUserId, r.discordAvatar),
        status: r.status,
        score: r.score,
        clicks: r.clickCount,
        ...(revealBoards ? { board: r.clicks } : {}),
        me: r.userId === meId,
      }),
    );

  const byUser = new Map<
    string,
    { name: string; discordUserId: string | null; discordAvatar: string | null; games: FinishedGame[] }
  >();
  for (const r of allRows) {
    const u = byUser.get(r.userId) ?? {
      name: r.name,
      discordUserId: r.discordUserId,
      discordAvatar: r.discordAvatar,
      games: [],
    };
    u.name = r.name;
    u.discordUserId = r.discordUserId;
    u.discordAvatar = r.discordAvatar;
    u.games.push(r);
    byUser.set(r.userId, u);
  }
  const allTime: AllTimeEntry[] = [];
  for (const [userId, u] of byUser) {
    const s = statsFromGames(u.games, today);
    allTime.push({
      name: u.name,
      discordAvatarUrl: discordAvatarUrl(u.discordUserId, u.discordAvatar),
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

  const channelStats = channelStatsFromGames(allRows, today);

  return { date: today, today: todayEntries, allTime: allTime.slice(0, 100), channelStats };
}
