import type { GameStatus } from "./types";

/**
 * Non-spoiling trail of squares showing the *count* of misses before the
 * win/loss, never their board positions (the board is identical for every
 * player each day, so revealing real cell positions would spoil it).
 */
export function squareTrail(status: GameStatus, misses: number): string {
  return "🟥".repeat(misses) + (status === "won" ? "🟩" : "💥");
}

export function shareText(game: {
  puzzleNumber: number;
  status: GameStatus;
  score: number | null;
  misses: number;
}): string {
  const scoreLine =
    game.status === "won" ? `${game.score} ${game.score === 1 ? "click" : "clicks"}` : "boom 💣";
  return `Bitedle #${game.puzzleNumber} · ${scoreLine}\n${squareTrail(game.status, game.misses)}`;
}
