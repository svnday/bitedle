"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeBitebluffBurnPositions } from "@/lib/bitebluff-cards";
import {
  BITEBLUFF_BURN_DURATION_MS,
  BITEBLUFF_BURN_STAGGER_MS,
  BITEBLUFF_DEAL_INTERVAL_MS,
  BITEBLUFF_FLIP_INTERVAL_MS,
  type BitebluffCard,
} from "@/lib/bitebluff-constants";

export type BitebluffRedrawAnimationPhase =
  | "burning"
  | "drawing"
  | "flipping";

export interface BitebluffRedrawAnimationState {
  previousHand: BitebluffCard[];
  positions: number[];
  phase: BitebluffRedrawAnimationPhase;
  step: number;
}

export function useBitebluffRedrawAnimation() {
  const [animation, setAnimation] =
    useState<BitebluffRedrawAnimationState | null>(null);
  const onComplete = useRef<(() => void) | null>(null);

  const start = useCallback(
    (
      previousHand: readonly BitebluffCard[],
      positions: readonly number[],
      complete?: () => void,
    ) => {
      onComplete.current = complete ?? null;
      setAnimation({
        previousHand: [...previousHand],
        positions: normalizeBitebluffBurnPositions(positions),
        phase: "burning",
        step: 0,
      });
    },
    [],
  );

  useEffect(() => {
    if (!animation) return;
    if (animation.phase === "burning") {
      const burn = window.setTimeout(
        () =>
          setAnimation((current) =>
            current ? { ...current, phase: "drawing", step: 0 } : current,
          ),
        BITEBLUFF_BURN_DURATION_MS +
          (animation.positions.length - 1) * BITEBLUFF_BURN_STAGGER_MS,
      );
      return () => window.clearTimeout(burn);
    }
    if (animation.phase === "drawing") {
      const draw = window.setTimeout(
        () =>
          setAnimation((current) =>
            current ? { ...current, phase: "flipping" } : current,
          ),
        BITEBLUFF_DEAL_INTERVAL_MS,
      );
      return () => window.clearTimeout(draw);
    }
    const flip = window.setTimeout(() => {
      if (animation.step < animation.positions.length - 1) {
        setAnimation({
          ...animation,
          phase: "drawing",
          step: animation.step + 1,
        });
        return;
      }
      setAnimation(null);
      const complete = onComplete.current;
      onComplete.current = null;
      complete?.();
    }, BITEBLUFF_FLIP_INTERVAL_MS);
    return () => window.clearTimeout(flip);
  }, [animation]);

  return {
    animation,
    animating: animation !== null,
    start,
  };
}
