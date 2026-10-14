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
 * The rule this file exists to honour: a rigged roll must be indistinguishable
 * from an honest one on the result card. So a band rig picks no number — it
 * picks a *band*, then draws uniformly from inside it with the ordinary
 * selector. The player gets a real random number that happens to score where it
 * was told to, with no fixed value to recognise, no EP sitting suspiciously on a
 * tier boundary, and no second code path through scoring.
 *
 * The rarity bands are small (trash 1.04% of the range, mythic 1.00%), which is
 * what makes the draw-and-reject loop below cheap rather than desperate.
 *
 * An entry may instead name an exact number, which trades that indistinguish-
 * ability away on purpose: a chosen value is recognisable, and it is kept in the
 * roll row, so it keeps showing on the leaderboard and the profile long after
 * the joke. It is the right tool only when the specific number *is* the point —
 * rigging yourself, or a setup where someone is meant to notice eventually. In
 * exchange it is the only rig served in constant time at any risk: there is no
 * band to satisfy, so no draw to reject and no sweep to fall into.
 */

const RNGDLE_RIGGABLE_BANDS: readonly RngdleNumberRarity[] = [
  "trash", "common", "uncommon", "rare", "epic", "anomaly", "mythic",
];

/**
 * What a rigged roll is worth: a band to draw from, or one exact number.
 * Exactly one of the two is set — parsing rejects an outcome that names neither,
 * and the format cannot express both.
 */
export interface RngdleRigOutcome {
  band: RngdleNumberRarity | null;
  exactNumber: number | null;
}

export interface RngdleRiggedRoll {
  userId: string;
  /** What the roll the rig fires on is worth. */
  roll: RngdleRigOutcome;
  /**
   * First game day the rig may fire on. Rolls before it neither fire nor spend
   * the rig, which is what makes "their next roll" mean the next one after you
   * armed it rather than the next one ever.
   */
  armedFrom: string;
  /** Whether the day's reroll is dragged into a rigged outcome as well. */
  rigReroll: boolean;
  /**
   * What the day's reroll is worth. The same as `roll` unless the entry gave the
   * reroll its own outcome, so callers can read it without checking which.
   */
  reroll: RngdleRigOutcome;
  /**
   * Loss percentage the rigged reroll takes, or null for the reroll outcome's
   * default. Set it when the risk itself is part of the joke. A band is still
   * judged on the EP left after the loss, so a steep loss against a high band
   * leaves very few numbers scoring there — reachable, because raw EP runs to
   * ~186M, but only through the slow sweep below. Prefer an exact number there.
   */
  rerollPenalty: number | null;
}

// This module deliberately imports nothing outside src/lib/rngdle: the RNGDLE
// lib is pure and gets compiled standalone by scripts/verify-rngdle.mjs, so
// reusing SNOWFLAKE_RE from src/lib/discord.ts would drag next/server into that
// build for one regex.
const SNOWFLAKE_PATTERN = /^\d{5,25}$/;
const GAME_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// A trailing `name` or `name=value`. Names are letters only, so a stray field
// that is not a flag at all (`:97`) fails here rather than being taken for one.
const FLAG_PATTERN = /^([a-z]+)(?:=(.+))?$/;
// Two digits, so the 1-99 range the risk animation can show is enforced by the
// shape of the value rather than by a bound somebody has to remember to check.
const LOSS_PERCENT_PATTERN = /^\d{1,2}$/;
// Seven digits covers the 0-1,000,000 range; the bound check in
// parseExactNumber rejects the rest of what that admits.
const BARE_NUMBER_PATTERN = /^\d{1,7}$/;
// `=742069` where a band goes: hand over exactly this number. The leading `=`
// reads as "pinned to", the same as it does in `reroll=97`, and keeps the field
// impossible to confuse with a band name. Flag values carry no sigil, because
// their flag name has already said which of the two they are.
const EXACT_NUMBER_PATTERN = /^=(\d{1,7})$/;

function parseBand(raw: string): RngdleNumberRarity | null {
  return RNGDLE_RIGGABLE_BANDS.includes(raw as RngdleNumberRarity)
    ? (raw as RngdleNumberRarity)
    : null;
}

function parseExactNumber(raw: string): number | null {
  if (!BARE_NUMBER_PATTERN.test(raw)) return null;
  const value = Number(raw);
  return value >= RNGDLE_MIN_NUMBER && value <= RNGDLE_MAX_NUMBER ? value : null;
}

/** A band name, or `=N` for one exact number. */
function parseOutcome(raw: string | undefined): RngdleRigOutcome | null {
  const band = parseBand(raw ?? "");
  if (band !== null) return { band, exactNumber: null };
  const exactMatch = EXACT_NUMBER_PATTERN.exec(raw ?? "");
  if (!exactMatch) return null;
  const exactNumber = parseExactNumber(exactMatch[1]);
  return exactNumber === null ? null : { band: null, exactNumber };
}

interface ParsedRigFlags {
  rigReroll: boolean;
  rerollPenalty: number | null;
  /** The reroll's own outcome, or null to inherit the initial roll's. */
  rerollOutcome: RngdleRigOutcome | null;
}

/**
 * The trailing flags, in any order: `reroll`, `reroll=lossPercent`,
 * `rerollband=band`, `rerollnumber=N`. Naming an outcome for the reroll implies
 * rigging it, so `rerollnumber=2063` needs no bare `reroll` beside it.
 *
 * Each flag may appear once. A repeat is a mistake worth failing on rather than
 * resolving silently, because the losing half of it would never be visible.
 */
function parseRigFlags(flags: readonly string[]): ParsedRigFlags | null {
  let rigReroll = false;
  let rerollPenalty: number | null = null;
  let rerollOutcome: RngdleRigOutcome | null = null;
  const seen = new Set<string>();

  for (const flag of flags) {
    const match = FLAG_PATTERN.exec(flag);
    if (!match) return null;
    const [, name, value] = match;
    if (seen.has(name)) return null;
    seen.add(name);

    if (name === "reroll") {
      rigReroll = true;
      if (value === undefined) continue;
      if (!LOSS_PERCENT_PATTERN.test(value)) return null;
      const penalty = Number(value);
      if (penalty < 1 || penalty > 99) return null;
      rerollPenalty = penalty;
      continue;
    }

    if (name === "rerollband") {
      const band = parseBand(value ?? "");
      if (band === null) return null;
      rerollOutcome = { band, exactNumber: null };
      rigReroll = true;
      continue;
    }

    if (name === "rerollnumber") {
      const exactNumber = parseExactNumber(value ?? "");
      if (exactNumber === null) return null;
      rerollOutcome = { band: null, exactNumber };
      rigReroll = true;
      continue;
    }

    return null;
  }

  // Both name the reroll's outcome, and `seen` only catches a repeat of one.
  if (seen.has("rerollband") && seen.has("rerollnumber")) return null;
  return { rigReroll, rerollPenalty, rerollOutcome };
}

function parseRiggedEntry(raw: string): RngdleRiggedRoll | null {
  const [userId, outcome, armedFrom, ...flags] = raw.split(":");
  if (!SNOWFLAKE_PATTERN.test(userId ?? "")) return null;
  const roll = parseOutcome(outcome);
  if (roll === null) return null;
  if (!GAME_DAY_PATTERN.test(armedFrom ?? "")) return null;
  const parsed = parseRigFlags(flags);
  if (parsed === null) return null;
  return {
    userId,
    roll,
    armedFrom,
    rigReroll: parsed.rigReroll,
    reroll: parsed.rerollOutcome ?? roll,
    rerollPenalty: parsed.rerollPenalty,
  };
}

/**
 * Parsed from RNGDLE_RIGGED_ROLLS once at module load, like the Bitedle
 * blocklist — a redeploy picks up changes. Entries are
 * `userId:band|=exactNumber:armedFromGameDay[:flag...]`, separated by commas or
 * whitespace. Flags: `reroll`, `reroll=lossPercent`, `rerollband=band`,
 * `rerollnumber=N`.
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
  // hundred numbers — but it scores all 1,000,001 to find them, which measures
  // at ~50s, not the ~65ms claimed here until 2026-10-11. Still uniform, just
  // arrived at a way that is far too slow to serve a reroll on.
  //
  // Nothing configurable reaches here today: the band defaults (99% trash, 1%
  // otherwise) and an exact number all resolve in roughly one draw. It is a
  // steep `reroll=NN` against a high band that lands in it — mythic keeps 456
  // numbers at a 93% loss and 89 at 99%, so 2,000 draws miss often — and that
  // pairing wants an exact number instead.
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
 * The number an outcome hands over: its exact value, or a fresh uniform draw
 * from its band conditioned on `penaltyPercent`. The only place the two kinds of
 * outcome differ, which is why the route resolves both through here — it passes
 * `rig.roll` for the roll the rig fires on and `rig.reroll` for the reroll.
 */
export function riggedRngdleNumber(
  outcome: RngdleRigOutcome,
  penaltyPercent: number | null = null,
  randomInt?: (maxExclusive: number) => number,
): number {
  if (outcome.exactNumber !== null) return outcome.exactNumber;
  if (outcome.band === null) {
    throw new TypeError("A rigged outcome must name either a band or an exact number.");
  }
  return selectRngdleNumberInBand(outcome.band, penaltyPercent, randomInt);
}

/**
 * The risk a rigged reroll draws: the entry's own `reroll=lossPercent` when it
 * names one, else the default that keeps the reroll's band reachable. Trash is
 * the only band you arrive at by *losing* EP, so it defaults to the maximum 99%
 * loss and every other band to the minimum 1%.
 *
 * Any value here is one the honest 1-99 draw also produces, so no rigged risk
 * looks out of place on the risk animation — which is the reason the override is
 * a loss percentage rather than a free-form number.
 */
export function riggedRngdleRerollPenalty(rig: RngdleRiggedRoll): number {
  if (rig.rerollPenalty !== null) return rig.rerollPenalty;
  // Keyed off what the *reroll* is worth, which is the band that has to stay
  // reachable. An exact number has no band to keep reachable — it is handed over
  // whatever the risk does — so it defaults to the smallest loss of its own EP.
  if (rig.reroll.band === null) return 1;
  return rig.reroll.band === "trash" ? 99 : 1;
}
