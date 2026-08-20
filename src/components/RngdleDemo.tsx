"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  scoreRngdleNumber,
  selectRngdleNumber,
  selectRngdlePenalty,
} from "@/lib/rngdle/scoring";
import {
  canRerollRngdle,
  formatRngdleCountdown,
  rngdleGameDay,
  rngdleNextResetAt,
  rngdleRerollDeadline,
} from "@/lib/rngdle/time";
import { rngdleNumberRevealTimeline } from "@/lib/rngdle/reveal";
import type { RngdleDayState, RngdleRevealState } from "@/lib/rngdle/types";
import type { GameMode } from "@/lib/types";
import GameNav from "./GameNav";
import RngdleBadgeBreakdown from "./RngdleBadgeBreakdown";
import RngdleRoll from "./RngdleRoll";

const STORAGE_KEY = "bitedle:rngdle:website-lab:v1";
const LIFETIME_STORAGE_KEY = "bitedle:rngdle:website-lab:lifetime:v1";
const RARITY_REVEAL_MS = 650;
const BADGE_REVEAL_MS = 1_100;
const PENALTY_REVEAL_MS = 900;

function readForcedInteger(name: string, min: number, max: number): number | null {
  const raw = new URLSearchParams(window.location.search).get(name);
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function safeStoredState(raw: string | null): RngdleDayState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as RngdleDayState;
    if (
      typeof value.gameDay !== "string" ||
      typeof value.initialRolledAt !== "number" ||
      typeof value.initial?.number !== "number"
    ) return null;
    return value;
  } catch {
    return null;
  }
}

export default function RngdleDemo({
  onModeChange,
}: {
  onModeChange: (mode: GameMode) => void;
}) {
  const [dayState, setDayState] = useState<RngdleDayState | null | undefined>(undefined);
  const [lifetimeEp, setLifetimeEp] = useState(0);
  const [revealState, setRevealState] = useState<RngdleRevealState>("ready");
  const [now, setNow] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const resultRef = useRef<HTMLDivElement>(null);
  const confirmationRef = useRef<HTMLButtonElement>(null);

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      const current = Date.now();
      const gameDay = rngdleGameDay(new Date(current));
      const stored = safeStoredState(window.localStorage.getItem(STORAGE_KEY));
      const rawLifetime = window.localStorage.getItem(LIFETIME_STORAGE_KEY);
      const storedLifetime = rawLifetime === null
        ? stored?.reroll?.creditedEp ?? stored?.initial.creditedEp ?? 0
        : Number(rawLifetime);
      setLifetimeEp(Number.isSafeInteger(storedLifetime) && storedLifetime >= 0 ? storedLifetime : 0);
      if (stored?.gameDay === gameDay) {
        setDayState(stored);
        setRevealState(stored.reroll ? "final-complete" : "initial-complete");
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
        setDayState(null);
        setRevealState("ready");
      }
      setNow(current);
    });
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!now || !dayState) return;
    const gameDayExpired = dayState.gameDay !== rngdleGameDay(new Date(now));
    const confirmationExpired =
      revealState === "reroll-confirmation" &&
      !canRerollRngdle(dayState.initialRolledAt, dayState.rerolledAt, now);
    if (!gameDayExpired && !confirmationExpired) return;
    const timeout = window.setTimeout(() => {
      if (gameDayExpired) {
        clearTimers();
        window.localStorage.removeItem(STORAGE_KEY);
        setDayState(null);
        setRevealState("ready");
      } else {
        setRevealState("initial-complete");
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [clearTimers, dayState, now, revealState]);

  useEffect(() => {
    if (revealState === "initial-complete" || revealState === "final-complete") {
      resultRef.current?.focus();
    } else if (revealState === "reroll-confirmation") {
      confirmationRef.current?.focus();
    }
  }, [revealState]);

  const persist = (next: RngdleDayState) => {
    setDayState(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const queueInitialReveal = (number: number) => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const { spinMs: rollMs, numberRevealMs: numberMs } =
      rngdleNumberRevealTimeline(number, reducedMotion);
    const rarityMs = reducedMotion ? 140 : RARITY_REVEAL_MS;
    const badgeMs = reducedMotion ? 180 : BADGE_REVEAL_MS;
    setRevealState("rolling");
    timers.current.push(
      setTimeout(() => setRevealState("revealing-number"), rollMs),
      setTimeout(() => setRevealState("revealing-rarity"), rollMs + numberMs),
      setTimeout(
        () => setRevealState("revealing-badges"),
        rollMs + numberMs + rarityMs,
      ),
      setTimeout(
        () => setRevealState("initial-complete"),
        rollMs + numberMs + rarityMs + badgeMs,
      ),
    );
  };

  const queueRerollReveal = (number: number) => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const { spinMs: rollMs, numberRevealMs: numberMs } =
      rngdleNumberRevealTimeline(number, reducedMotion);
    const rarityMs = reducedMotion ? 140 : RARITY_REVEAL_MS;
    const badgeMs = reducedMotion ? 180 : BADGE_REVEAL_MS;
    const penaltyMs = reducedMotion ? 180 : PENALTY_REVEAL_MS;
    setRevealState("rerolling");
    timers.current.push(
      setTimeout(() => setRevealState("revealing-reroll"), rollMs),
      setTimeout(() => setRevealState("revealing-rarity"), rollMs + numberMs),
      setTimeout(
        () => setRevealState("revealing-badges"),
        rollMs + numberMs + rarityMs,
      ),
      setTimeout(
        () => setRevealState("revealing-penalty"),
        rollMs + numberMs + rarityMs + badgeMs,
      ),
      setTimeout(
        () => setRevealState("final-complete"),
        rollMs + numberMs + rarityMs + badgeMs + penaltyMs,
      ),
    );
  };

  const roll = () => {
    if (dayState || revealState !== "ready") return;
    clearTimers();
    const rolledAt = Date.now();
    const forced = readForcedInteger("rngNumber", 0, 1_000_000);
    const result = scoreRngdleNumber(forced ?? selectRngdleNumber());
    persist({
      gameDay: rngdleGameDay(new Date(rolledAt)),
      initial: result,
      initialRolledAt: rolledAt,
      reroll: null,
      rerolledAt: null,
    });
    const nextLifetime = lifetimeEp + result.creditedEp;
    setLifetimeEp(nextLifetime);
    window.localStorage.setItem(LIFETIME_STORAGE_KEY, String(nextLifetime));
    queueInitialReveal(result.number);
  };

  const confirmReroll = () => {
    if (
      !dayState ||
      !canRerollRngdle(dayState.initialRolledAt, dayState.rerolledAt, Date.now())
    ) {
      setRevealState("initial-complete");
      return;
    }
    clearTimers();
    const rerolledAt = Date.now();
    const forcedNumber = readForcedInteger("rngReroll", 0, 1_000_000);
    const forcedPenalty = readForcedInteger("rngPenalty", 1, 99);
    const penalty = forcedPenalty ?? selectRngdlePenalty();
    const result = scoreRngdleNumber(forcedNumber ?? selectRngdleNumber(), penalty);
    persist({ ...dayState, reroll: result, rerolledAt });
    const nextLifetime = Math.max(0, lifetimeEp - dayState.initial.creditedEp + result.creditedEp);
    setLifetimeEp(nextLifetime);
    window.localStorage.setItem(LIFETIME_STORAGE_KEY, String(nextLifetime));
    queueRerollReveal(result.number);
  };

  const resetLab = () => {
    clearTimers();
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(LIFETIME_STORAGE_KEY);
    setDayState(null);
    setLifetimeEp(0);
    setRevealState("ready");
    setNow(Date.now());
  };

  const result = dayState?.reroll ?? dayState?.initial ?? null;
  const isAnimating = [
    "rolling",
    "revealing-number",
    "revealing-rarity",
    "revealing-badges",
    "rerolling",
    "revealing-reroll",
    "revealing-penalty",
  ].includes(revealState);
  const rerollAvailable = Boolean(
    dayState && now && canRerollRngdle(dayState.initialRolledAt, dayState.rerolledAt, now),
  );
  const rerollRemaining = dayState
    ? formatRngdleCountdown(rngdleRerollDeadline(dayState.initialRolledAt) - now)
    : "10:00";
  const nextReset = now ? formatRngdleCountdown(rngdleNextResetAt(new Date(now)) - now) : "—";
  const announcement = useMemo(() => {
    if (!result || (revealState !== "initial-complete" && revealState !== "final-complete")) return "";
    const penalty = result.penaltyPercent
      ? ` A ${result.penaltyPercent} percent reroll penalty reduces it to ${result.creditedEp.toLocaleString()} credited EP.`
      : "";
    return `Rolled ${result.number}. ${result.rarityLabel}. ${result.rawEp.toLocaleString()} raw EP from ${result.badges.length} badges.${penalty}`;
  }, [result, revealState]);

  if (dayState === undefined) return null;

  return (
    <div className="rngdle-lab flex min-h-screen flex-col">
      <GameNav mode="rngdle" onModeChange={onModeChange} />
      <main className="rngdle-main">
        <div className="rngdle-shell">
          <h1 className="sr-only">RNGDLE</h1>

          <section className="rngdle-stage" aria-labelledby="rngdle-stage-title">
            <div className="rngdle-stage-topline">
              <button type="button" className="rngdle-lab-reset" onClick={resetLab} disabled={isAnimating}>
                Reset lab
              </button>
            </div>
            <h2 id="rngdle-stage-title" className="sr-only">Daily RNGDLE roll</h2>

            <div ref={resultRef} className="rngdle-result-focus" tabIndex={dayState ? -1 : undefined}>
              <RngdleRoll
                result={result}
                state={revealState}
                nextReset={nextReset}
                lifetimeEp={lifetimeEp}
              />
            </div>

            {!dayState ? (
              <div className="rngdle-primary-actions">
                <button type="button" className="rngdle-roll-button" onClick={roll}>
                  GENERATE
                </button>
                <p>Website lab · your roll is saved in this browser</p>
              </div>
            ) : null}

            {isAnimating ? (
              <p className="rngdle-stage-status" aria-live="polite">
                {revealState === "rolling" || revealState === "rerolling"
                  ? "Gathering entropy…"
                  : revealState === "revealing-penalty"
                    ? "Applying the reroll penalty…"
                    : "Analyzing number patterns…"}
              </p>
            ) : null}

            {revealState === "initial-complete" && rerollAvailable ? (
              <div className="rngdle-reroll-offer">
                <div>
                  <span>ONE REROLL AVAILABLE</span>
                  <strong>{rerollRemaining}</strong>
                </div>
                <p>Replace this roll permanently. The new score loses a random 1–99%.</p>
                <button type="button" onClick={() => setRevealState("reroll-confirmation")}>
                  Risk a reroll
                </button>
              </div>
            ) : null}

            {revealState === "reroll-confirmation" ? (
              <div
                className="rngdle-confirmation"
                role="dialog"
                aria-modal="true"
                aria-labelledby="rngdle-confirm-title"
                onKeyDown={(event) => {
                  if (event.key === "Escape") setRevealState("initial-complete");
                }}
              >
                <p className="rngdle-confirm-kicker">THE POINT OF NO RETURN</p>
                <h2 id="rngdle-confirm-title">Replace {dayState?.initial.number}?</h2>
                <p>
                  Your original {dayState?.initial.rawEp.toLocaleString()} EP result becomes uncredited.
                  The new number is final, then loses a random 1–99% of its raw EP.
                </p>
                <div>
                  <button
                    ref={confirmationRef}
                    type="button"
                    className="rngdle-confirm-cancel"
                    onClick={() => setRevealState("initial-complete")}
                  >
                    Keep this roll
                  </button>
                  <button type="button" className="rngdle-confirm-risk" onClick={confirmReroll}>
                    Replace it forever
                  </button>
                </div>
              </div>
            ) : null}

            {dayState?.reroll && (revealState === "revealing-penalty" || revealState === "final-complete") ? (
              <div className="rngdle-original-audit">
                <span>ORIGINAL · UNCREDITED</span>
                <strong>{dayState.initial.number}</strong>
                <span>{dayState.initial.rawEp.toLocaleString()} EP</span>
              </div>
            ) : null}
          </section>

          {result && ["revealing-badges", "initial-complete", "revealing-penalty", "final-complete"].includes(revealState) ? (
            <RngdleBadgeBreakdown badges={result.badges} number={result.number} state={revealState} />
          ) : null}

          <footer className="rngdle-footer">
            <span>230 badge rules</span>
            <span aria-hidden="true">◆</span>
            <span>Scoring oracle pinned 2026-08-19</span>
            <span aria-hidden="true">◆</span>
            <span>Local website lab · Discord deferred</span>
          </footer>
        </div>
        <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
      </main>
    </div>
  );
}
