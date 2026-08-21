export const RNGDLE_TIME_ZONE = "America/New_York";
export const RNGDLE_RESET_HOUR = 19;

function timeZoneOffsetMs(date: Date, timeZone: string): number {
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
      .map((part) => [part.type, part.value]),
  );
  const representedAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((representedAsUtc - date.getTime()) / 1_000) * 1_000;
}

export function rngdleEasternWallClock(date: string, hour = RNGDLE_RESET_HOUR): number {
  const [year, month, day] = date.split("-").map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, 0, 0);
  let guess = new Date(wallClockAsUtc);
  guess = new Date(wallClockAsUtc - timeZoneOffsetMs(guess, RNGDLE_TIME_ZONE));
  guess = new Date(wallClockAsUtc - timeZoneOffsetMs(guess, RNGDLE_TIME_ZONE));
  return guess.getTime();
}

function easternDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: RNGDLE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function rngdleGameDay(now: Date = new Date()): string {
  const localDate = easternDate(now);
  return now.getTime() >= rngdleEasternWallClock(localDate)
    ? localDate
    : shiftDate(localDate, -1);
}

export function rngdleNextResetAt(now: Date = new Date()): number {
  return rngdleEasternWallClock(shiftDate(rngdleGameDay(now), 1));
}

// The one reroll stays available for the rest of the roll's game day: the
// deadline is the daily reset that follows the initial roll.
export function rngdleRerollDeadline(initialRolledAt: number): number {
  return rngdleNextResetAt(new Date(initialRolledAt));
}

export function canRerollRngdle(
  initialRolledAt: number,
  rerolledAt: number | null,
  now = Date.now(),
): boolean {
  return rerolledAt === null && now >= initialRolledAt && now < rngdleRerollDeadline(initialRolledAt);
}

export function formatRngdleCountdown(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
