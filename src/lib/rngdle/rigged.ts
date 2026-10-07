import {
  RNGDLE_MAX_NUMBER,
  RNGDLE_MIN_NUMBER,
  scoreRngdleNumber,
  secureRandomInt,
  selectRngdleNumber,
} from "./scoring";
import type { RngdleNumberRarity } from "./types";

/**
 * Per-user roll rigging, for handing a specific Discord account a specific
 * rarity on their next roll.
 *
 * The one rule this file exists to honour: a rigged roll must be
 * indistinguishable from an honest one on the result card. So nothing here
 * picks a number — it picks a *band*, then draws uniformly from inside it with
 * the ordinary selector. The player gets a real random number that happens to
 * score where it was told to, with no fixed value to recognise, no EP sitting
 * suspiciously on a tier boundary, and no second code path through scoring.
 *
 * The rarity bands are small (trash 1.04% of the range, mythic 1.00%), which is
 * what makes the draw-and-reject loop below cheap rather than desperate.
 */

const RNGDLE_RIGGABLE_BANDS: readonly RngdleNumberRarity[] = [
  "trash", "common", "uncommon", "rare", "epic", "anomaly", "mythic",
];

export interface RngdleRiggedRoll {
  userId: string;
  band: RngdleNumberRarity;
  /**
   * First game day the rig may fire on. Rolls before it neither fire nor spend
   * the rig, which is what makes "their next roll" mean the next one after you
   * armed it rather than the next one ever.
   */
  armedFrom: string;
  /** Whether the day's reroll is dragged into the same band as well. */
  rigReroll: boolean;
}

// This module deliberately imports nothing outside src/lib/rngdle: the RNGDLE
// lib is pure and gets compiled standalone by scripts/verify-rngdle.mjs, so
// reusing SNOWFLAKE_RE from src/lib/discord.ts would drag next/server into that
// build for one regex.
const SNOWFLAKE_PATTERN = /^\d{5,25}$/;
const GAME_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseRiggedEntry(raw: string): RngdleRiggedRoll | null {
  const [userId, band, armedFrom, ...flags] = raw.split(":");
  if (!SNOWFLAKE_PATTERN.test(userId ?? "")) return null;
  if (!RNGDLE_RIGGABLE_BANDS.includes(band as RngdleNumberRarity)) return null;
  if (!GAME_DAY_PATTERN.test(armedFrom ?? "")) return null;
  if (flags.some((flag) => flag !== "reroll")) return null;
  return {
    userId,
    band: band as RngdleNumberRarity,
    armedFrom,
    rigReroll: flags.includes("reroll"),
  };
}

/**
 * Parsed from RNGDLE_RIGGED_ROLLS once at module load, like the Bitedle
 * blocklist — a redeploy picks up changes. Entries are
 * `userId:band:armedFromGameDay[:reroll]`, separated by commas or whitespace.
 *
 * A malformed entry is dropped with a warning rather than ignored silently: a
 * typo'd rig fails by simply never firing, which is invisible from Discord and
 * indistinguishable from bad luck.
 */
const RIGGED_ROLLS: ReadonlyMap<string, RngdleRiggedRoll> = new Map(
  (process.env.RNGDLE_RIGGED_ROLLS ?? "")
    .split(/[\s,]+/)
    .filter((entry) => entry.length > 0)
    .flatMap((entry) => {
      const parsed = parseRiggedEntry(entry);
      if (!parsed) {
        console.warn(`rngdle: ignoring malformed RNGDLE_RIGGED_ROLLS entry "${entry}"`);
        return [];
      }
      return [[parsed.userId, parsed] as const];
    }),
);

/** The rig armed for this Discord user, if any. */
export function riggedRngdleRollFor(userId: string | null | undefined): RngdleRiggedRoll | null {
  return typeof userId === "string" ? RIGGED_ROLLS.get(userId) ?? null : null;
}

/**
 * Whether a rig is eligible to act on `gameDay`, before the (more expensive)
 * check of whether it has already been spent.
 */
export function rngdleRigCoversDay(rig: RngdleRiggedRoll, gameDay: string): boolean {
  return gameDay >= rig.armedFrom;
}

// At a ~1% band this overshoots the median draw count (67) by ~30x, so the
// configured bands never reach the scan below. It is sized for the pathological
// case instead: a band left almost empty by a steep reroll penalty.
const MAX_BAND_DRAWS = 2_000;

/**
 * A uniform random number whose *credited* EP — after `penaltyPercent` — scores
 * as `band`. Conditioning on the credited value is what keeps a rigged reroll
 * honest: the band is the one the card will actually print, not the one the
 * number would have had at full value.
 */
export function selectRngdleNumberInBand(
  band: RngdleNumberRarity,
  penaltyPercent: number | null = null,
  randomInt?: (maxExclusive: number) => number,
): number {
  for (let draw = 0; draw < MAX_BAND_DRAWS; draw += 1) {
    const candidate = selectRngdleNumber(randomInt);
    if (scoreRngdleNumber(candidate, penaltyPercent).rarity === band) return candidate;
  }

  // Rejection sampling only runs dry on a band holding well under 0.1% of the
  // range, so the exhaustive sweep that replaces it collects at most a few
  // hundred numbers. Still uniform, just arrived at the slow way (~65ms).
  const members: number[] = [];
  for (let candidate = RNGDLE_MIN_NUMBER; candidate <= RNGDLE_MAX_NUMBER; candidate += 1) {
    if (scoreRngdleNumber(candidate, penaltyPercent).rarity === band) members.push(candidate);
  }
  if (members.length === 0) {
    throw new RangeError(`No RNGDLE number scores as ${band} at a ${penaltyPercent}% penalty.`);
  }
  return members[(randomInt ?? secureRandomInt)(members.length)];
}

/**
 * The risk a rigged reroll draws, chosen so the band stays reachable: trash is
 * the only band you arrive at by *losing* EP, so it takes the maximum 99% loss
 * and every other band takes the minimum 1%. Both are values the honest 1-99
 * draw produces, so neither looks out of place on the risk animation.
 */
export function riggedRngdleRerollPenalty(band: RngdleNumberRarity): number {
  return band === "trash" ? 99 : 1;
}
