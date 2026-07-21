import type { GameStatus } from "./types";

/**
 * Non-spoiling trail of squares showing the *count* of misses before the
 * win/loss, never their board positions (the board is identical for every
 * player each day, so revealing real cell positions would spoil it).
 */
export function squareTrail(status: GameStatus, misses: number): string {
  return "🟥".repeat(misses) + (status === "won" ? "🟩" : "💥");
}

function clicksLabel(n: number): string {
  return `${n} ${n === 1 ? "click" : "clicks"}`;
}

export function shareText(game: {
  puzzleNumber: number;
  status: GameStatus;
  score: number | null;
  misses: number;
}): string {
  // The winning/losing click is always the one right after the misses, so
  // this is the total click count for either outcome.
  const totalClicks = clicksLabel(game.misses + 1);
  // No repeated 🟥 miss trail here (unlike squareTrail) — the click count is
  // already spelled out below, so the squares would just be redundant.
  const indicator = game.status === "won" ? "✅" : "💥";
  const scoreLine =
    game.status === "won" ? `found in ${totalClicks} ${indicator}` : `boom in ${totalClicks} ${indicator}`;
  return `Bitedle #${game.puzzleNumber}\n${scoreLine}`;
}

export function megaShareText(game: {
  status: GameStatus;
  totalClicks: number;
}): string {
  const totalClicks = clicksLabel(game.totalClicks);
  const scoreLine =
    game.status === "won"
      ? `10×10 — found in ${totalClicks} ✅`
      : `10×10 — boom in ${totalClicks} 💥`;
  return `Bitesweeper\n${scoreLine}`;
}

export function biteracerShareText(game: {
  passageNumber: number;
  netWpm: number;
  accuracy: number;
}): string {
  return `Biteracer #${game.passageNumber}\n${game.netWpm} WPM · ${game.accuracy}% accuracy ⌨️`;
}
