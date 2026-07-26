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

export function randomBurnPositions(seed: string, count: number): number[] {
  if (!Number.isInteger(count) || count < BITEBLUFF_REDRAW_MIN || count > BITEBLUFF_REDRAW_MAX) {
    throw new Error("Burn & Draw count must be an integer from 1 through 3.");
  }
  const positions = [0, 1, 2, 3, 4];
  for (let index = positions.length - 1; index > 0; index -= 1) {
    const target = Math.floor(seededUnit(`${seed}:burn`, positions.length - index) * (index + 1));
    [positions[index], positions[target]] = [positions[target], positions[index]];
  }
  return positions.slice(0, count).sort((a, b) => a - b);
}

export function applyRandomBitebluffRedraw(input: {
  hand: readonly BitebluffCard[];
  remaining: readonly BitebluffCard[];
  seed: string;
  count: number;
}): {
  hand: BitebluffCard[];
  remaining: BitebluffCard[];
  burned: BitebluffCard[];
  positions: number[];
} {
  if (input.hand.length !== BITEBLUFF_HAND_SIZE) {
    throw new Error("Burn & Draw requires a five-card hand.");
  }
  const positions = randomBurnPositions(input.seed, input.count);
  const replacements = seededBitebluffDeck(`${input.seed}:replacements`).filter((candidate) =>
    input.remaining.some((card) => bitebluffCardKey(card) === bitebluffCardKey(candidate)),
  );
  const nextHand = [...input.hand];
  const burned = positions.map((position) => nextHand[position]);
  positions.forEach((position, replacementIndex) => {
    nextHand[position] = replacements[replacementIndex];
  });
  const replacementKeys = new Set(
    replacements.slice(0, positions.length).map((card) => bitebluffCardKey(card)),
  );
  return {
    hand: nextHand,
    remaining: input.remaining.filter((card) => !replacementKeys.has(bitebluffCardKey(card))),
    burned,
    positions,
  };
}
