export const RNGDLE_REEL_MIN_SLOTS = 6;
export const RNGDLE_REEL_TICK_MS = 100;
export const RNGDLE_REEL_SPIN_MS = 2_000;
export const RNGDLE_DIGIT_SETTLE_MS = 500;
export const RNGDLE_POST_NUMBER_MS = 1_000;
export const RNGDLE_BADGE_CARD_MS = 350;
export const RNGDLE_BADGE_DIGIT_DELAY_MS = 100;
export const RNGDLE_BADGE_DIGIT_STAGGER_MS = 80;

export interface RngdleNumberRevealTimeline {
  digitOffsetsMs: number[];
  numberRevealMs: number;
  slotCount: number;
  spinMs: number;
}

export interface RngdleBadgeRevealTimeline {
  badgeOffsetsMs: number[];
  completeMs: number;
  lifetimeAnimateMs: number;
  lifetimeVisibleMs: number;
  rarityVisibleMs: number;
  summaryVisibleMs: number;
}

export function rngdleReelSlotCount(number: number): number {
  return Math.max(RNGDLE_REEL_MIN_SLOTS, String(number).length);
}

/**
 * The pinned live RNGDLE cadence: after the initial spin, slots lock from left
 * to right. The gap begins at one second and eases longer toward the last slot.
 */
export function rngdleDigitRevealOffsets(number: number): number[] {
  const slotCount = rngdleReelSlotCount(number);
  const offsets: number[] = [];
  let elapsed = 0;

  for (let index = 0; index < slotCount; index += 1) {
    offsets.push(elapsed);
    if (index < slotCount - 1) {
      elapsed += 1_000 + 1_000 * Math.pow(index / (slotCount - 1), 2);
    }
  }

  return offsets;
}

export function rngdleNumberRevealTimeline(
  number: number,
  reducedMotion: boolean,
): RngdleNumberRevealTimeline {
  const slotCount = rngdleReelSlotCount(number);
  if (reducedMotion) {
    const digitOffsetsMs = Array.from({ length: slotCount }, (_, index) => index * 60);
    return {
      digitOffsetsMs,
      numberRevealMs: digitOffsetsMs.at(-1)! + 180,
      slotCount,
      spinMs: 120,
    };
  }

  const digitOffsetsMs = rngdleDigitRevealOffsets(number);
  return {
    digitOffsetsMs,
    numberRevealMs: digitOffsetsMs.at(-1)! + RNGDLE_POST_NUMBER_MS,
    slotCount,
    spinMs: RNGDLE_REEL_SPIN_MS,
  };
}

/**
 * RNGDLE mounts the lowest-value badge first, then prepends each higher-value
 * badge. The pause grows with the list so the strongest badges land last.
 */
export function rngdleBadgeRevealOffsets(
  badgeCount: number,
  reducedMotion = false,
): number[] {
  if (badgeCount <= 0) return [];
  if (reducedMotion) return Array.from({ length: badgeCount }, (_, index) => index * 80);

  const offsets: number[] = [];
  let elapsed = 0;
  for (let index = 0; index < badgeCount; index += 1) {
    offsets.push(elapsed);
    if (index < badgeCount - 1) {
      elapsed += badgeCount <= 1
        ? 500
        : 500 + 1_000 * Math.pow(index / (badgeCount - 1), 1.5);
    }
  }
  return offsets;
}

export function rngdleBadgeRevealTimeline(
  badgeCount: number,
  reducedMotion = false,
): RngdleBadgeRevealTimeline {
  const badgeOffsetsMs = rngdleBadgeRevealOffsets(badgeCount, reducedMotion);
  const lastBadgeMs = badgeOffsetsMs.at(-1) ?? 0;
  if (reducedMotion) {
    const summaryVisibleMs = lastBadgeMs + 120;
    const rarityVisibleMs = summaryVisibleMs + 120;
    const lifetimeVisibleMs = rarityVisibleMs + 120;
    const lifetimeAnimateMs = lifetimeVisibleMs + 120;
    return {
      badgeOffsetsMs,
      summaryVisibleMs,
      rarityVisibleMs,
      lifetimeVisibleMs,
      lifetimeAnimateMs,
      completeMs: lifetimeAnimateMs + 180,
    };
  }

  const summaryVisibleMs = lastBadgeMs + 1_500;
  const rarityVisibleMs = summaryVisibleMs + 1_250;
  const lifetimeVisibleMs = rarityVisibleMs + 1_000;
  const lifetimeAnimateMs = lifetimeVisibleMs + 1_500;
  return {
    badgeOffsetsMs,
    summaryVisibleMs,
    rarityVisibleMs,
    lifetimeVisibleMs,
    lifetimeAnimateMs,
    completeMs: lifetimeAnimateMs + 2_000,
  };
}
