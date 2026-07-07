import type { GameStatus } from "./types";

/**
 * Non-spoiling share text: a trail of squares showing the *count* of misses
 * before the win/loss, never their board positions.
 */
export function shareText(game: {
  puzzleNumber: number;
  status: GameStatus;
  score: number | null;
  misses: number;
}): string {
  const trail = "🟥".repeat(game.misses) + (game.status === "won" ? "🟩" : "💥");
  const scoreLine =
    game.status === "won" ? `${game.score} ${game.score === 1 ? "click" : "clicks"}` : "boom 💣";
  return `Bitedle #${game.puzzleNumber} · ${scoreLine}\n${trail}`;
}
