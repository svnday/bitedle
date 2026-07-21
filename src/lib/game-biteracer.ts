import crypto from "node:crypto";
import { BITERACER_PASSAGES } from "./biteracer-passages";
import { discordAvatarUrl } from "./discord";
import { boardSecret, dayNum, mulberry32 } from "./game";
import { getStore, type FinishedBiteracerGame } from "./store";
import { nextResetAt } from "./time";
import type {
  BiteracerAllTimeEntry,
  BiteracerGameState,
  BiteracerLeaderboard,
  BiteracerPassage,
  BiteracerTodayEntry,
  BiteracerUserStats,
} from "./types";

/**
 * date -> the day's deterministic passage. Passages are drawn from a seeded
 * Fisher-Yates permutation of all N indices (N = BITERACER_PASSAGES.length),
 * one fresh permutation per aligned "cycle" of N days, so every passage
 * appears exactly once per cycle, and cycles reshuffle deterministically
 * (same seed -> same shuffle, reproducible across processes/deploys). A
 * boundary rule below additionally guarantees the same passage never shows
 * on two consecutive days. Growing the passage list only affects future
 * cycles; already-played days keep their recorded passageId regardless.
 */
const permMemo = new Map<number, number[]>();

function rawPermutationForCycle(cycleNumber: number, n: number): number[] {
  const digest = crypto
    .createHash("sha256")
    .update(`${boardSecret()}:biteracer:cycle:${cycleNumber}`)
    .digest();
  const rng = mulberry32(digest.readUInt32LE(0));
  const indices = Array.from({ length: n }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

function permutationForCycle(cycleNumber: number, n: number): number[] {
  const cached = permMemo.get(cycleNumber);
  if (cached) return cached;
  const perm = rawPermutationForCycle(cycleNumber, n);
  // Boundary anti-repeat (mirrors game.ts's "never yesterday's cell" rule):
  // a cycle that would open with the passage the previous cycle closed on
  // swaps its first two slots instead — still a full permutation. The swap
  // never touches a permutation's LAST slot (n > 2), so the previous cycle's
  // closing passage is readable straight from its raw draw, with no chained
  // recomputation back through earlier cycles.
  if (n > 2 && cycleNumber > 0) {
    const prevLast = rawPermutationForCycle(cycleNumber - 1, n)[n - 1];
    if (perm[0] === prevLast) [perm[0], perm[1]] = [perm[1], perm[0]];
  }
  permMemo.set(cycleNumber, perm);
  return perm;
}

export function passageIndexFor(date: string): number {
  const n = BITERACER_PASSAGES.length;
  const ordinal = dayNum(date);
  const cycleNumber = Math.floor(ordinal / n);
  return permutationForCycle(cycleNumber, n)[ordinal % n];
}

export function passageFor(date: string): BiteracerPassage {
  return BITERACER_PASSAGES[passageIndexFor(date)];
}

const BITERACER_FIRST_PUZZLE = 1;
export const BITERACER_EPOCH_DATE = "2026-07-21"; // ship date — first puzzle is #1

export function biteracerPuzzleNumber(date: string): number {
  return dayNum(date) - dayNum(BITERACER_EPOCH_DATE) + BITERACER_FIRST_PUZZLE;
}

export async function biteracerStateFor(
  userId: string,
  date: string,
  timeZone?: string,
): Promise<BiteracerGameState> {
  const store = getStore();
  const [game, user] = await Promise.all([
    store.getBiteracerGame(date, userId),
    store.getUser(userId),
  ]);
  return {
    date,
    passageNumber: biteracerPuzzleNumber(date),
    status: game?.status ?? "playing",
    username: user?.name ?? "Player",
    named: user?.named ?? false,
    passage: passageFor(date),
    startedAt: game?.startedAt ?? null,
    nextResetAt: nextResetAt(new Date(), timeZone),
    result:
      game?.status === "finished"
        ? {
            netWpm: game.netWpm!,
            rawWpm: game.rawWpm!,
            accuracy: game.accuracy!,
            elapsedMs: game.elapsedMs!,
            correctChars: game.correctChars!,
            errorCount: game.errorCount!,
          }
        : null,
  };
}

/** Streak: consecutive *played* calendar days (no win/lose concept — every
 *  finished run counts), ending today or yesterday (today not yet played).
 *  Mirrors statsFromGames' streak walk in game.ts, minus the won-only filter. */
export function statsFromBiteracerGames(
  games: FinishedBiteracerGame[],
  today: string,
): BiteracerUserStats {
  const entries = games
    .map((g) => ({ day: dayNum(g.date), netWpm: g.netWpm, accuracy: g.accuracy }))
    .sort((a, b) => a.day - b.day);

  let maxStreak = 0;
  let run = 0;
  let prevDay: number | null = null;
  for (const e of entries) {
    run = prevDay !== null && e.day === prevDay + 1 ? run + 1 : 1;
    prevDay = e.day;
    if (run > maxStreak) maxStreak = run;
  }

  const byDay = new Set(entries.map((e) => e.day));
  let d = dayNum(today);
  if (!byDay.has(d)) d -= 1;
  let currentStreak = 0;
  while (byDay.has(d)) {
    currentStreak++;
    d--;
  }

  const played = entries.length;
  return {
    played,
    avgNetWpm:
      played === 0
        ? null
        : Math.round((entries.reduce((a, e) => a + e.netWpm, 0) / played) * 10) / 10,
    bestNetWpm: played === 0 ? null : Math.max(...entries.map((e) => e.netWpm)),
    avgAccuracy:
      played === 0
        ? null
        : Math.round((entries.reduce((a, e) => a + e.accuracy, 0) / played) * 10) / 10,
    currentStreak,
    maxStreak,
  };
}

export async function computeBiteracerUserStats(
  userId: string,
  today: string,
): Promise<BiteracerUserStats> {
  return statsFromBiteracerGames(await getStore().finishedBiteracerGamesFor(userId), today);
}

export async function computeBiteracerLeaderboard(
  today: string,
  meId: string | null,
): Promise<BiteracerLeaderboard> {
  const store = getStore();
  const [todayRows, allRows] = await Promise.all([
    store.finishedBiteracerGamesOn(today),
    store.allFinishedBiteracerGames(),
  ]);

  const todayEntries: BiteracerTodayEntry[] = todayRows
    .sort((a, b) => b.netWpm - a.netWpm || a.finishedAt - b.finishedAt)
    .slice(0, 100)
    .map((r) => ({
      name: r.name,
      discordAvatarUrl: discordAvatarUrl(r.discordUserId, r.discordAvatar),
      netWpm: r.netWpm,
      rawWpm: r.rawWpm,
      accuracy: r.accuracy,
      elapsedMs: r.elapsedMs,
      me: r.userId === meId,
    }));

  const byUser = new Map<
    string,
    {
      name: string;
      discordUserId: string | null;
      discordAvatar: string | null;
      games: FinishedBiteracerGame[];
    }
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
  const allTime: BiteracerAllTimeEntry[] = [];
  for (const [userId, u] of byUser) {
    const s = statsFromBiteracerGames(u.games, today);
    allTime.push({
      name: u.name,
      discordAvatarUrl: discordAvatarUrl(u.discordUserId, u.discordAvatar),
      gamesPlayed: s.played,
      avgNetWpm: s.avgNetWpm ?? 0,
      bestNetWpm: s.bestNetWpm ?? 0,
      currentStreak: s.currentStreak,
      maxStreak: s.maxStreak,
      me: userId === meId,
    });
  }
  allTime.sort((a, b) => b.avgNetWpm - a.avgNetWpm || a.name.localeCompare(b.name));

  return { date: today, today: todayEntries, allTime: allTime.slice(0, 100) };
}
