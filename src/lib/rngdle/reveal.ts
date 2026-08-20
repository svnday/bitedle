export const RNGDLE_REEL_MIN_SLOTS = 6;
export const RNGDLE_REEL_TICK_MS = 100;
export const RNGDLE_REEL_SPIN_MS = 2_000;
export const RNGDLE_DIGIT_SETTLE_MS = 500;
export const RNGDLE_POST_NUMBER_MS = 1_000;

export interface RngdleNumberRevealTimeline {
  digitOffsetsMs: number[];
  numberRevealMs: number;
  slotCount: number;
  spinMs: number;
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
