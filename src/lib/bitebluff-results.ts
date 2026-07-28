import {
  compareBitebluffHands,
  evaluateBitebluffHand,
} from "./bitebluff-poker";
import type { BitebluffEntryRecord } from "./bitebluff-types";

export function bitebluffEntryIsWinner(
  entry: BitebluffEntryRecord,
): boolean {
  return entry.contestedPayout > 0 || (entry.wonLayers?.length ?? 0) > 0;
}

function compareFinalEntryHands(
  first: BitebluffEntryRecord,
  second: BitebluffEntryRecord,
): number {
  if (first.revealedHand && second.revealedHand) {
    return compareBitebluffHands(
      evaluateBitebluffHand(first.revealedHand),
      evaluateBitebluffHand(second.revealedHand),
    );
  }
  if (first.revealedHand) return 1;
  if (second.revealedHand) return -1;
  return 0;
}

export function sortBitebluffFinalEntries(
  entries: readonly BitebluffEntryRecord[],
): BitebluffEntryRecord[] {
  return [...entries].sort((first, second) => {
    const winnerDifference =
      Number(bitebluffEntryIsWinner(second)) -
      Number(bitebluffEntryIsWinner(first));
    if (winnerDifference !== 0) return winnerDifference;

    const handDifference = compareFinalEntryHands(first, second);
    if (handDifference !== 0) return -handDifference;

    const firstNet = first.payout - first.wager - first.redrawSurcharge;
    const secondNet =
      second.payout - second.wager - second.redrawSurcharge;
    if (firstNet !== secondNet) return secondNet - firstNet;
    if (first.contestedPayout !== second.contestedPayout) {
      return second.contestedPayout - first.contestedPayout;
    }
    return (
      first.displayName.localeCompare(second.displayName) ||
      first.id.localeCompare(second.id)
    );
  });
}
