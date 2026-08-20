import { compute } from "./reference-engine.js";
import type {
  RngdleBadge,
  RngdleNumberRarity,
  RngdleResult,
} from "./types";

export const RNGDLE_MIN_NUMBER = 0;
export const RNGDLE_MAX_NUMBER = 1_000_000;

const CARD_TIERS: readonly [number, RngdleNumberRarity, string, string][] = [
  [2_098, "trash", "TRASH", "Bottom 1%"],
  [5_761, "common", "COMMON", "Bottom 50%"],
  [9_644, "uncommon", "UNCOMMON", "Top 50-25%"],
  [23_077, "rare", "RARE", "Top 25-10%"],
  [35_744, "epic", "EPIC", "Top 10-5%"],
  [164_953, "anomaly", "ANOMALY", "Top 5-1%"],
];

interface OracleBadge {
  id: string;
  label: string;
  emoji: string;
  ep: number;
  rarity: RngdleBadge["rarity"];
  desc?: string;
  prob?: number;
}

interface OracleResult {
  number: number;
  totalEP: number;
  badges: OracleBadge[];
}

export function classifyRngdleScore(rawEp: number): {
  rarity: RngdleNumberRarity;
  label: string;
  band: string;
} {
  for (const [cutoff, rarity, label, band] of CARD_TIERS) {
    if (rawEp < cutoff) return { rarity, label, band };
  }
  return { rarity: "mythic", label: "MYTHIC", band: "Top 1%" };
}

export function scoreRngdleNumber(
  number: number,
  penaltyPercent: number | null = null,
): RngdleResult {
  if (!Number.isSafeInteger(number) || number < RNGDLE_MIN_NUMBER || number > RNGDLE_MAX_NUMBER) {
    throw new RangeError(`RNGDLE number must be an integer from ${RNGDLE_MIN_NUMBER} to ${RNGDLE_MAX_NUMBER}.`);
  }
  if (
    penaltyPercent !== null &&
    (!Number.isSafeInteger(penaltyPercent) || penaltyPercent < 1 || penaltyPercent > 99)
  ) {
    throw new RangeError("RNGDLE reroll penalty must be an integer from 1 to 99.");
  }

  const scored = compute(number) as OracleResult;
  const classification = classifyRngdleScore(scored.totalEP);
  const creditedEp =
    penaltyPercent === null
      ? scored.totalEP
      : Math.floor((scored.totalEP * (100 - penaltyPercent)) / 100);

  return {
    number: scored.number,
    rawEp: scored.totalEP,
    creditedEp,
    rarity: classification.rarity,
    rarityLabel: classification.label,
    rarityBand: classification.band,
    badges: scored.badges.map((badge) => ({
      id: badge.id,
      label: badge.label,
      emoji: badge.emoji,
      ep: badge.ep,
      rarity: badge.rarity,
      desc: badge.desc ?? "A property of this number.",
      prob: badge.prob ?? 0,
    })),
    penaltyPercent,
  };
}

function secureRandomInt(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError("Random upper bound must be a positive integer.");
  }
  const range = 0x1_0000_0000;
  const limit = range - (range % maxExclusive);
  const values = new Uint32Array(1);
  do {
    crypto.getRandomValues(values);
  } while (values[0] >= limit);
  return values[0] % maxExclusive;
}

export function selectRngdleNumber(
  randomInt: (maxExclusive: number) => number = secureRandomInt,
): number {
  const value = randomInt(RNGDLE_MAX_NUMBER + 1);
  if (!Number.isSafeInteger(value) || value < 0 || value > RNGDLE_MAX_NUMBER) {
    throw new RangeError("RNGDLE number selector returned an invalid value.");
  }
  return value;
}

export function selectRngdlePenalty(
  randomInt: (maxExclusive: number) => number = secureRandomInt,
): number {
  const value = randomInt(99) + 1;
  if (!Number.isSafeInteger(value) || value < 1 || value > 99) {
    throw new RangeError("RNGDLE penalty selector returned an invalid value.");
  }
  return value;
}
