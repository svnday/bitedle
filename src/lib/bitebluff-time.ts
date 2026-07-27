import { todayStr } from "./time";

export const BITEBLUFF_TIME_ZONE = "America/New_York";
export const BITEBLUFF_REVEAL_HOUR = 23;

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

/** Epoch milliseconds for a wall-clock time on an Eastern calendar date. */
export function bitebluffEasternWallClock(
  date: string,
  hour: number,
  minute = 0,
): number {
  const [year, month, day] = date.split("-").map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = new Date(wallClockAsUtc);
  guess = new Date(wallClockAsUtc - timeZoneOffsetMs(guess, BITEBLUFF_TIME_ZONE));
  guess = new Date(wallClockAsUtc - timeZoneOffsetMs(guess, BITEBLUFF_TIME_ZONE));
  return guess.getTime();
}

export function bitebluffDate(now: Date = new Date()): string {
  return todayStr(now, BITEBLUFF_TIME_ZONE);
}

export function bitebluffRoundWindow(date: string): { opensAt: number; revealAt: number } {
  return {
    opensAt: bitebluffEasternWallClock(date, 0),
    revealAt: bitebluffEasternWallClock(date, BITEBLUFF_REVEAL_HOUR),
  };
}

export function bitebluffRevealLabel(revealAt: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BITEBLUFF_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(revealAt));
}
