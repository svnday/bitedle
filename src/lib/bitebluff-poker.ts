import {
  BITEBLUFF_HAND_SIZE,
  type BitebluffCard,
  type BitebluffCategory,
  type BitebluffEvaluatedHand,
} from "./bitebluff-constants";
import { bitebluffCardKey } from "./bitebluff-cards";

const CATEGORY_STRENGTH: Record<BitebluffCategory, number> = {
  "high-card": 0,
  pair: 1,
  "two-pair": 2,
  "three-of-a-kind": 3,
  straight: 4,
  flush: 5,
  "full-house": 6,
  "four-of-a-kind": 7,
  "straight-flush": 8,
  "royal-flush": 9,
};

const LABELS: Record<BitebluffCategory, string> = {
  "high-card": "High Card",
  pair: "One Pair",
  "two-pair": "Two Pair",
  "three-of-a-kind": "Three of a Kind",
  straight: "Straight",
  flush: "Flush",
  "full-house": "Full House",
  "four-of-a-kind": "Four of a Kind",
  "straight-flush": "Straight Flush",
  "royal-flush": "Royal Flush",
};

function straightHigh(ranks: readonly number[]): number | null {
  const unique = [...new Set(ranks)].sort((a, b) => b - a);
  if (unique.length !== BITEBLUFF_HAND_SIZE) return null;
  if (unique.join(",") === "14,5,4,3,2") return 5;
  return unique.every((rank, index) => index === 0 || unique[index - 1] - rank === 1)
    ? unique[0]
    : null;
}

function evaluated(category: BitebluffCategory, comparison: number[]): BitebluffEvaluatedHand {
  return {
    category,
    comparison,
    strength: [CATEGORY_STRENGTH[category], ...comparison],
    label: LABELS[category],
  };
}

export function validateBitebluffHand(hand: readonly BitebluffCard[]): void {
  if (hand.length !== BITEBLUFF_HAND_SIZE) throw new Error("A Bitebluff hand must have five cards.");
  if (new Set(hand.map(bitebluffCardKey)).size !== BITEBLUFF_HAND_SIZE) {
    throw new Error("A Bitebluff hand cannot contain duplicate cards.");
  }
  for (const card of hand) {
    if (!Number.isInteger(card.rank) || card.rank < 2 || card.rank > 14) {
      throw new Error("Invalid Bitebluff card rank.");
    }
    if (!["clubs", "diamonds", "hearts", "spades"].includes(card.suit)) {
      throw new Error("Invalid Bitebluff card suit.");
    }
  }
}

export function evaluateBitebluffHand(hand: readonly BitebluffCard[]): BitebluffEvaluatedHand {
  validateBitebluffHand(hand);
  const ranks = hand.map((card) => card.rank).sort((a, b) => b - a);
  const flush = hand.every((card) => card.suit === hand[0].suit);
  const highStraight = straightHigh(ranks);
  const counts = new Map<number, number>();
  ranks.forEach((rank) => counts.set(rank, (counts.get(rank) ?? 0) + 1));
  const groups = [...counts.entries()].sort(
    ([rankA, countA], [rankB, countB]) => countB - countA || rankB - rankA,
  );

  if (flush && highStraight === 14) return evaluated("royal-flush", []);
  if (flush && highStraight !== null) return evaluated("straight-flush", [highStraight]);
  if (groups[0][1] === 4) return evaluated("four-of-a-kind", [groups[0][0], groups[1][0]]);
  if (groups[0][1] === 3 && groups[1][1] === 2) {
    return evaluated("full-house", [groups[0][0], groups[1][0]]);
  }
  if (flush) return evaluated("flush", ranks);
  if (highStraight !== null) return evaluated("straight", [highStraight]);
  if (groups[0][1] === 3) {
    return evaluated("three-of-a-kind", [
      groups[0][0],
      ...groups.slice(1).map(([rank]) => rank).sort((a, b) => b - a),
    ]);
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    return evaluated("two-pair", [...pairs, groups[2][0]]);
  }
  if (groups[0][1] === 2) {
    return evaluated("pair", [
      groups[0][0],
      ...groups.slice(1).map(([rank]) => rank).sort((a, b) => b - a),
    ]);
  }
  return evaluated("high-card", ranks);
}

export function compareBitebluffHands(
  first: BitebluffEvaluatedHand,
  second: BitebluffEvaluatedHand,
): number {
  const length = Math.max(first.strength.length, second.strength.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (first.strength[index] ?? 0) - (second.strength[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}
