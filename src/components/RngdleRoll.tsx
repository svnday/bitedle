"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  RNGDLE_DIGIT_SETTLE_MS,
  RNGDLE_REEL_TICK_MS,
  rngdleNumberRevealTimeline,
  rngdleReelSlotCount,
} from "@/lib/rngdle/reveal";
import type { RngdleResult, RngdleRevealState } from "@/lib/rngdle/types";

const SPINNING_STATES = new Set<RngdleRevealState>(["rolling", "rerolling"]);
const REVEALING_STATES = new Set<RngdleRevealState>([
  "revealing-number",
  "revealing-reroll",
]);

function randomDigit(): string {
  return String(Math.floor(Math.random() * 10));
}

function RngdleReelDigits({
  state,
  targetNumber,
  targetSlots,
}: {
  state: RngdleRevealState;
  targetNumber: number;
  targetSlots: string[];
}) {
  const [digits, setDigits] = useState<string[]>(() =>
    Array.from({ length: targetSlots.length }, randomDigit)
  );
  const [revealedCount, setRevealedCount] = useState(0);
  const [settlingSlots, setSettlingSlots] = useState<Set<number>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const revealedCountRef = useRef(0);
  const revealing = REVEALING_STATES.has(state);
  const leadingBlankCount = targetSlots.findIndex((digit) => digit !== "");

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setDigits((current) => current.map((digit, index) =>
        index < revealedCountRef.current ? digit : randomDigit()
      ));
    }, RNGDLE_REEL_TICK_MS);

    if (revealing) {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const { digitOffsetsMs } = rngdleNumberRevealTimeline(targetNumber, reducedMotion);
      digitOffsetsMs.forEach((offset, index) => {
        timersRef.current.push(setTimeout(() => {
          revealedCountRef.current = index + 1;
          setRevealedCount(index + 1);
          setDigits((current) => current.map((digit, slot) =>
            slot === index ? targetSlots[index] : digit
          ));
          setSettlingSlots((current) => new Set(current).add(index));
        }, offset));
        timersRef.current.push(setTimeout(() => {
          setSettlingSlots((current) => {
            const next = new Set(current);
            next.delete(index);
            return next;
          });
        }, offset + RNGDLE_DIGIT_SETTLE_MS));
      });
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      for (const timer of timersRef.current) clearTimeout(timer);
      intervalRef.current = null;
      timersRef.current = [];
    };
  }, [revealing, targetNumber, targetSlots]);

  return digits.map((digit, index) => {
    const leadingBlank = leadingBlankCount > 0 && index < leadingBlankCount && revealedCount > index;
    const slotSpinning = index >= revealedCount;
    return (
      <span
        key={index}
        className={`rngdle-digit-window${leadingBlank ? " rngdle-digit-window--blank" : ""}`}
      >
        <span
          className={`rngdle-digit${slotSpinning ? " rngdle-digit--spinning" : ""}${settlingSlots.has(index) ? " rngdle-digit--settling" : ""}`}
        >
          {digit || "\u00a0"}
        </span>
      </span>
    );
  });
}

export default function RngdleRoll({
  result,
  state,
}: {
  result: RngdleResult | null;
  state: RngdleRevealState;
}) {
  const hasResult = result !== null;
  const targetNumber = result?.number ?? 0;
  const target = String(targetNumber);
  const slotCount = hasResult ? rngdleReelSlotCount(targetNumber) : 6;
  const leadingBlankCount = hasResult ? slotCount - target.length : 0;
  const targetSlots = useMemo(
    () => hasResult ? [...Array(leadingBlankCount).fill(""), ...target] : Array(6).fill("0"),
    [hasResult, leadingBlankCount, target],
  );
  const spinning = SPINNING_STATES.has(state);
  const revealing = REVEALING_STATES.has(state);
  const reelsActive = spinning || revealing;
  const showRarity = !reelsActive;
  const showScore = showRarity && state !== "revealing-rarity";
  const showPenalty = result?.penaltyPercent !== null &&
    (state === "revealing-penalty" || state === "final-complete");
  const animationKey = `${targetNumber}-${result?.penaltyPercent ?? "initial"}`;
  const visibleTier = showRarity ? result?.rarity ?? "common" : "common";
  const finale = state === "revealing-rarity";

  return (
    <div className={`rngdle-number-card rngdle-tier--${visibleTier}${reelsActive ? " rngdle-number-card--reeling" : ""}${finale ? " rngdle-number-card--finale" : ""}`}>
      <div className="rngdle-card-gloss" aria-hidden="true" />
      <div className="rngdle-digit-row" aria-hidden="true">
        {reelsActive ? (
          <RngdleReelDigits
            key={animationKey}
            state={state}
            targetNumber={targetNumber}
            targetSlots={targetSlots}
          />
        ) : targetSlots.map((digit, index) => (
          <span
            key={index}
            className={`rngdle-digit-window${index < leadingBlankCount ? " rngdle-digit-window--blank rngdle-digit-window--collapsed" : ""}`}
          >
            <span className="rngdle-digit">{digit || "\u00a0"}</span>
          </span>
        ))}
      </div>
      <p className="sr-only">
        {reelsActive ? "A random number is rolling." : result ? `Rolled ${result.number}.` : "Ready to roll."}
      </p>

      <div className={`rngdle-rarity-line${showRarity ? " rngdle-reveal-visible" : ""}`}>
        <strong>{result?.rarityLabel ?? "COMMON"}</strong>
        <span aria-hidden="true">{"\u2022"}</span>
        <span>{result?.rarityBand ?? "Awaiting roll"}</span>
      </div>

      <div className={`rngdle-score-block${showScore ? " rngdle-reveal-visible" : ""}`}>
        {showPenalty && result ? (
          <>
            <span className="rngdle-raw-score">{result.rawEp.toLocaleString()} EP</span>
            <span className="rngdle-penalty-chip">{"\u2212"}{result.penaltyPercent}%</span>
            <strong>{result.creditedEp.toLocaleString()} EP</strong>
            <small>credited after reroll penalty</small>
          </>
        ) : (
          <>
            <strong>{result?.rawEp.toLocaleString() ?? "0"} EP</strong>
            <small>{result?.penaltyPercent ? "raw reroll score" : "entropy points"}</small>
          </>
        )}
      </div>
    </div>
  );
}
