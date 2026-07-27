import {
  BITEBLUFF_HAND_SIZE,
  BITEBLUFF_REDRAW_MAX,
  BITEBLUFF_REDRAW_MIN,
  BITEBLUFF_SUITS,
  type BitebluffCard,
  type BitebluffRank,
} from "./bitebluff-constants";

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnit(seed: string, index: number): number {
  let value = (hashSeed(seed) + Math.imul(index + 1, 0x6d2b79f5)) >>> 0;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

export function bitebluffCardKey(card: BitebluffCard): string {
  return `${card.rank}:${card.suit}`;
}

export function bitebluffDeck(): BitebluffCard[] {
  const cards: BitebluffCard[] = [];
  for (const suit of BITEBLUFF_SUITS) {
    for (let rank = 2; rank <= 14; rank += 1) {
      cards.push({ rank: rank as BitebluffRank, suit });
    }
  }
  return cards;
}

export function seededBitebluffDeck(seed: string): BitebluffCard[] {
  const cards = bitebluffDeck();
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const target = Math.floor(seededUnit(seed, cards.length - index) * (index + 1));
    [cards[index], cards[target]] = [cards[target], cards[index]];
  }
  return cards;
}

export function dealBitebluffHand(seed: string, entrantId: string): {
  hand: BitebluffCard[];
  remaining: BitebluffCard[];
} {
  const deck = seededBitebluffDeck(`${seed}:entrant:${entrantId}`);
  return {
    hand: deck.slice(0, BITEBLUFF_HAND_SIZE),
    remaining: deck.slice(BITEBLUFF_HAND_SIZE),
  };
}

export function normalizeBitebluffBurnPositions(
  positions: readonly number[],
): number[] {
  if (
    positions.length < BITEBLUFF_REDRAW_MIN ||
    positions.length > BITEBLUFF_REDRAW_MAX ||
    positions.some(
      (position) =>
        !Number.isInteger(position) ||
        position < 0 ||
        position >= BITEBLUFF_HAND_SIZE,
    ) ||
    new Set(positions).size !== positions.length
  ) {
    throw new Error(
      "Choose 1, 2, or 3 different cards from your hand to Burn & Draw.",
    );
  }
  return [...positions].sort((a, b) => a - b);
}

export function normalizeBitebluffRedrawCount(count: number): number {
  if (
    !Number.isInteger(count) ||
    count < BITEBLUFF_REDRAW_MIN ||
    count > BITEBLUFF_REDRAW_MAX
  ) {
    throw new Error("Choose 1, 2, or 3 random cards to Burn & Draw.");
  }
  return count;
}

export function applySelectedBitebluffRedraw(input: {
  hand: readonly BitebluffCard[];
  remaining: readonly BitebluffCard[];
  positions: readonly number[];
}): {
  hand: BitebluffCard[];
  remaining: BitebluffCard[];
  burned: BitebluffCard[];
  positions: number[];
} {
  if (input.hand.length !== BITEBLUFF_HAND_SIZE) {
    throw new Error("Burn & Draw requires a five-card hand.");
  }
  const positions = normalizeBitebluffBurnPositions(input.positions);
  if (input.remaining.length < positions.length) {
    throw new Error("The Bitebluff deck does not have enough replacement cards.");
  }
  const replacements = input.remaining.slice(0, positions.length);
  const nextHand = [...input.hand];
  const burned = positions.map((position) => nextHand[position]);
  positions.forEach((position, replacementIndex) => {
    nextHand[position] = replacements[replacementIndex];
  });
  return {
    hand: nextHand,
    remaining: input.remaining.slice(positions.length),
    burned,
    positions,
  };
}
