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

// Smallest EP value that rounds to each population percentile from 1 through
// 100. Derived from the permitted full-range rngdle.com percentile snapshot on
// 2026-08-19; this keeps the client payload compact while preserving the
// integer percentile labels used by the reference result card.
const ROUNDED_PERCENTILE_EP_BREAKS = [
  1_999, 2_148, 2_282, 2_393, 2_495, 2_655, 2_749, 2_851, 2_948, 3_015,
  3_084, 3_152, 3_198, 3_267, 3_338, 3_409, 3_491, 3_564, 3_640, 3_712,
  3_770, 3_835, 3_905, 3_960, 4_017, 4_071, 4_137, 4_198, 4_262, 4_325,
  4_386, 4_454, 4_510, 4_576, 4_645, 4_704, 4_774, 4_843, 4_906, 4_975,
  5_042, 5_106, 5_174, 5_241, 5_315, 5_389, 5_472, 5_550, 5_637, 5_719,
  5_801, 5_887, 5_970, 6_054, 6_147, 6_244, 6_346, 6_452, 6_562, 6_680,
  6_788, 6_909, 7_030, 7_169, 7_313, 7_474, 7_638, 7_809, 7_990, 8_178,
  8_388, 8_639, 8_887, 9_163, 9_471, 9_818, 10_193, 10_633, 11_100, 11_674,
  12_319, 12_988, 13_724, 14_509, 15_350, 16_323, 17_434, 18_657, 20_106, 21_861,
  24_724, 27_889, 29_413, 31_088, 33_905, 38_362, 45_020, 61_783, 121_166, 337_576,
] as const;

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

export function formatRngdlePercentile(
  rawEp: number,
  rarity: RngdleNumberRarity = classifyRngdleScore(rawEp).rarity,
): string {
  let low = 0;
  let high: number = ROUNDED_PERCENTILE_EP_BREAKS.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (ROUNDED_PERCENTILE_EP_BREAKS[middle] <= rawEp) low = middle + 1;
    else high = middle;
  }

  const roundedPercentile = low;
  return rarity === "trash" || rarity === "common"
    ? `Bottom ${Math.max(1, roundedPercentile)}%`
    : `Top ${Math.max(1, 100 - roundedPercentile)}%`;
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
    rarityBand: formatRngdlePercentile(scored.totalEP, classification.rarity),
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
