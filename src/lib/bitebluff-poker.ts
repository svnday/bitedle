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

export interface BitebluffHandInsight {
  label: string;
  summary: string;
  score: number;
  tier: string;
}

const CATEGORY_ORDER: BitebluffCategory[] = [
  "high-card",
  "pair",
  "two-pair",
  "three-of-a-kind",
  "straight",
  "flush",
  "full-house",
  "four-of-a-kind",
  "straight-flush",
  "royal-flush",
];

const CATEGORY_COMBINATIONS: Record<BitebluffCategory, number> = {
  "high-card": 1_302_540,
  pair: 1_098_240,
  "two-pair": 123_552,
  "three-of-a-kind": 54_912,
  straight: 10_200,
  flush: 5_108,
  "full-house": 3_744,
  "four-of-a-kind": 624,
  "straight-flush": 36,
  "royal-flush": 4,
};

const TOTAL_FIVE_CARD_HANDS = 2_598_960;
const RANKS = Array.from({ length: 13 }, (_, index) => index + 2);
const comparisonClassCache = new Map<BitebluffCategory, number[][]>();

function chooseRanks(
  values: readonly number[],
  count: number,
  start = 0,
  chosen: number[] = [],
  output: number[][] = [],
): number[][] {
  if (chosen.length === count) {
    output.push([...chosen]);
    return output;
  }
  for (let index = start; index <= values.length - (count - chosen.length); index += 1) {
    chosen.push(values[index]);
    chooseRanks(values, count, index + 1, chosen, output);
    chosen.pop();
  }
  return output;
}

function compareComparison(first: readonly number[], second: readonly number[]): number {
  for (let index = 0; index < Math.max(first.length, second.length); index += 1) {
    const difference = (first[index] ?? 0) - (second[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function comparisonClasses(category: BitebluffCategory): number[][] {
  const cached = comparisonClassCache.get(category);
  if (cached) return cached;
  const classes: number[][] = [];

  if (category === "high-card" || category === "flush") {
    for (const ranks of chooseRanks(RANKS, 5)) {
      const descending = ranks.sort((a, b) => b - a);
      if (straightHigh(descending) === null) classes.push(descending);
    }
  } else if (category === "pair") {
    for (const pair of RANKS) {
      for (const kickers of chooseRanks(RANKS.filter((rank) => rank !== pair), 3)) {
        classes.push([pair, ...kickers.sort((a, b) => b - a)]);
      }
    }
  } else if (category === "two-pair") {
    for (const pairs of chooseRanks(RANKS, 2)) {
      const descendingPairs = pairs.sort((a, b) => b - a);
      for (const kicker of RANKS.filter((rank) => !pairs.includes(rank))) {
        classes.push([...descendingPairs, kicker]);
      }
    }
  } else if (category === "three-of-a-kind") {
    for (const trips of RANKS) {
      for (const kickers of chooseRanks(RANKS.filter((rank) => rank !== trips), 2)) {
        classes.push([trips, ...kickers.sort((a, b) => b - a)]);
      }
    }
  } else if (category === "straight") {
    for (let high = 5; high <= 14; high += 1) classes.push([high]);
  } else if (category === "full-house") {
    for (const trips of RANKS) {
      for (const pair of RANKS) {
        if (pair !== trips) classes.push([trips, pair]);
      }
    }
  } else if (category === "four-of-a-kind") {
    for (const quads of RANKS) {
      for (const kicker of RANKS) {
        if (kicker !== quads) classes.push([quads, kicker]);
      }
    }
  } else if (category === "straight-flush") {
    for (let high = 5; high <= 13; high += 1) classes.push([high]);
  } else {
    classes.push([]);
  }

  classes.sort(compareComparison);
  comparisonClassCache.set(category, classes);
  return classes;
}

function rankName(rank: number): string {
  if (rank === 14) return "Ace";
  if (rank === 13) return "King";
  if (rank === 12) return "Queen";
  if (rank === 11) return "Jack";
  return (
    {
      10: "Ten",
      9: "Nine",
      8: "Eight",
      7: "Seven",
      6: "Six",
      5: "Five",
      4: "Four",
      3: "Three",
      2: "Two",
    }[rank] ?? String(rank)
  );
}

function rankPlural(rank: number): string {
  if (rank === 14) return "Aces";
  if (rank === 13) return "Kings";
  if (rank === 12) return "Queens";
  if (rank === 11) return "Jacks";
  return `${rankName(rank)}s`;
}

function rankSymbol(rank: number): string {
  if (rank === 14) return "A";
  if (rank === 13) return "K";
  if (rank === 12) return "Q";
  if (rank === 11) return "J";
  return String(rank);
}

function handSummary(evaluation: BitebluffEvaluatedHand): string {
  const values = evaluation.comparison;
  if (evaluation.category === "royal-flush") {
    return "The best possible five-card poker hand.";
  }
  if (evaluation.category === "straight-flush") {
    return `${rankName(values[0])}-high straight flush.`;
  }
  if (evaluation.category === "four-of-a-kind") {
    return `Four ${rankPlural(values[0])} with a ${rankSymbol(values[1])} kicker.`;
  }
  if (evaluation.category === "full-house") {
    return `${rankPlural(values[0])} full of ${rankPlural(values[1])}.`;
  }
  if (evaluation.category === "flush") {
    return `${rankName(values[0])}-high flush. Next cards: ${values
      .slice(1)
      .map(rankSymbol)
      .join(", ")}.`;
  }
  if (evaluation.category === "straight") {
    return `${rankName(values[0])}-high straight.`;
  }
  if (evaluation.category === "three-of-a-kind") {
    return `Three ${rankPlural(values[0])}. Kickers: ${values
      .slice(1)
      .map(rankSymbol)
      .join(", ")}.`;
  }
  if (evaluation.category === "two-pair") {
    return `${rankPlural(values[0])} and ${rankPlural(values[1])}, ${rankSymbol(
      values[2],
    )} kicker.`;
  }
  if (evaluation.category === "pair") {
    return `Pair of ${rankPlural(values[0])}. Kickers: ${values
      .slice(1)
      .map(rankSymbol)
      .join(", ")}.`;
  }
  return `${rankName(values[0])}-high. Kickers: ${values
    .slice(1)
    .map(rankSymbol)
    .join(", ")}.`;
}

function insightTier(percentile: number): string {
  if (percentile >= 99.5) return "Exceptional";
  if (percentile >= 95) return "Elite";
  if (percentile >= 80) return "Very strong";
  if (percentile >= 60) return "Solid";
  if (percentile >= 40) return "In the mix";
  if (percentile >= 20) return "Below average";
  return "Long shot";
}

export function bitebluffHandInsight(
  hand: readonly BitebluffCard[],
): BitebluffHandInsight {
  const evaluation = evaluateBitebluffHand(hand);
  const classes = comparisonClasses(evaluation.category);
  const classIndex = classes.findIndex(
    (comparison) => compareComparison(comparison, evaluation.comparison) === 0,
  );
  if (classIndex < 0) throw new Error("Bitebluff hand comparison class was not found.");
  const weakerCombinations = CATEGORY_ORDER.slice(
    0,
    CATEGORY_ORDER.indexOf(evaluation.category),
  ).reduce((total, category) => total + CATEGORY_COMBINATIONS[category], 0);
  const combinationsPerClass =
    CATEGORY_COMBINATIONS[evaluation.category] / classes.length;
  const percentile =
    ((weakerCombinations + (classIndex + 0.5) * combinationsPerClass) /
      TOTAL_FIVE_CARD_HANDS) *
    100;
  const score = Math.round(percentile * 10) / 10;
  return {
    label: evaluation.label,
    summary: handSummary(evaluation),
    score,
    tier: insightTier(percentile),
  };
}
