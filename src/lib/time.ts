/**
 * The daily reset happens at midnight in one fixed timezone (BITEDLE_TZ) so
 * that every player, everywhere, gets the same board at the same moment —
 * and so behavior doesn't change when the server itself runs in UTC (Vercel).
 */

const DEFAULT_TZ = "America/New_York";

let cachedTz: string | null = null;

export function gameTimeZone(): string {
  if (cachedTz) return cachedTz;
  const tz = process.env.BITEDLE_TZ || DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    cachedTz = tz;
  } catch {
    console.warn(`Bitedle: invalid BITEDLE_TZ "${tz}", falling back to UTC`);
    cachedTz = "UTC";
  }
  return cachedTz;
}

/** Today's date as YYYY-MM-DD, in the given timezone (default: the game's). */
export function todayStr(now: Date = new Date(), timeZone: string = gameTimeZone()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Clamps a candidate day (from a player-supplied timezone) to within ±1 day of
 * the current UTC date. A real IANA zone already yields a date in that window
 * (offsets are ≤ ±14h), so this only guards against malformed/hostile input —
 * bounding how far a spoofed client could shift its board to at most ~1 day.
 */
export function clampToUtcDayWindow(date: string, now: Date = new Date()): string {
  const utc = todayStr(now, "UTC");
  const lo = shiftDay(utc, -1);
  const hi = shiftDay(utc, 1);
  if (date < lo) return lo;
  if (date > hi) return hi;
  return date;
}

/** YYYY-MM-DD shifted by whole days, via UTC to sidestep any tz/DST math. */
export function shiftDay(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  // formatToParts is whole-second; round away the input's millisecond residue.
  return Math.round((asUtc - date.getTime()) / 1000) * 1000;
}

/** Epoch ms of the next midnight in the given timezone (default: the game's). */
export function nextResetAt(now: Date = new Date(), timeZone: string = gameTimeZone()): number {
  const tz = timeZone;
  const [y, m, d] = todayStr(now, tz).split("-").map(Number);
  const midnightUtc = Date.UTC(y, m - 1, d + 1, 0, 0, 0);
  // Two passes so a DST shift landing exactly on the boundary still resolves.
  let guess = new Date(midnightUtc - tzOffsetMs(now, tz));
  guess = new Date(midnightUtc - tzOffsetMs(guess, tz));
  return guess.getTime();
}
