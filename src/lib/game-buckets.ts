import type { GameStatus } from "./types";

export function megaBucketFor(status: GameStatus, score: number | null): string {
  if (status !== "won" || score === null) return "X";
  if (score <= 5) return "1-5";
  if (score <= 10) return "6-10";
  if (score <= 15) return "11-15";
  if (score <= 20) return "16-20";
  if (score <= 30) return "21-30";
  return "31+";
}
