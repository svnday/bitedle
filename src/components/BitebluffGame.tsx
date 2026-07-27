"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import {
  BITEBLUFF_DEAL_INTERVAL_MS,
  BITEBLUFF_FLIP_INTERVAL_MS,
  BITEBLUFF_REVEAL_PAUSE_MS,
} from "@/lib/bitebluff-constants";
import type { BitebluffPrivateState } from "@/lib/bitebluff-types";
import BitebluffTable from "./BitebluffTable";

export default function BitebluffGame() {
  const [state, setState] = useState<BitebluffPrivateState | null>(null);
  const [error, setError] = useState("");
  const [wagerInput, setWagerInput] = useState("");
  const [reviewingWager, setReviewingWager] = useState(false);
  const [placingWager, setPlacingWager] = useState(false);
  const [placedCount, setPlacedCount] = useState(0);
  const [revealedCount, setRevealedCount] = useState(0);
  const [phase, setPhase] = useState<"idle" | "dealing" | "pause" | "flipping" | "done">(
    "idle",
  );
  const animated = useRef(false);

  const load = useCallback(async () => {
    try {
      const next = await api.bitebluffState();
      setState(next);
      setError("");
      if (!next.entry) {
        setWagerInput((current) => current || String(next.wager.minimum));
      }
      if (next.entry && !animated.current) {
        animated.current = true;
        setPhase("dealing");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't load Bitebluff.");
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    if (phase === "dealing") {
      if (placedCount >= 5) {
        const pause = window.setTimeout(
          () => setPhase("pause"),
          BITEBLUFF_REVEAL_PAUSE_MS,
        );
        return () => window.clearTimeout(pause);
      }
      const deal = window.setTimeout(
        () => setPlacedCount((count) => count + 1),
        placedCount === 0 ? 120 : BITEBLUFF_DEAL_INTERVAL_MS,
      );
      return () => window.clearTimeout(deal);
    }
    if (phase === "pause") {
      const flipStart = window.setTimeout(() => setPhase("flipping"), 220);
      return () => window.clearTimeout(flipStart);
    }
    if (phase === "flipping") {
      if (revealedCount >= 5) {
        const finish = window.setTimeout(() => setPhase("done"), 0);
        return () => window.clearTimeout(finish);
      }
      const flip = window.setTimeout(
        () => setRevealedCount((count) => count + 1),
        BITEBLUFF_FLIP_INTERVAL_MS,
      );
      return () => window.clearTimeout(flip);
    }
  }, [phase, placedCount, revealedCount]);

  const entry = state?.entry ?? null;
  const selectedWager = Number(wagerInput);
  const wagerIsValid =
    state !== null &&
    Number.isSafeInteger(selectedWager) &&
    selectedWager >= state.wager.minimum &&
    selectedWager <= state.wager.maximum;
  const revealTime = state
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(new Date(state.round.revealAt))
    : "11:00 PM ET";

  async function confirmWager() {
    if (!state || !wagerIsValid || placingWager) return;
    setPlacingWager(true);
    setError("");
    try {
      const next = await api.bitebluffEnter(selectedWager);
      setState(next);
      setReviewingWager(false);
      if (next.entry) {
        animated.current = true;
        setPlacedCount(0);
        setRevealedCount(0);
        setPhase("dealing");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't place that wager.");
    } finally {
      setPlacingWager(false);
    }
  }

  return (
    <main className="bitebluff-lab min-h-screen">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
        <header className="bitebluff-hero">
          <div>
            <p className="bitebluff-kicker">Discord daily blind draw</p>
            <h1>Bitebluff</h1>
            <p>
              Your hand is private until the server-wide reveal at {revealTime}.
            </p>
          </div>
          <div className="bitebluff-clock">
            <span>{state?.round.status === "settled" ? "Round" : "Reveal"}</span>
            <strong>{state?.round.status === "settled" ? "Final" : revealTime}</strong>
            <small>{state?.round.date ?? "Loading…"}</small>
          </div>
        </header>

        {state ? (
          <div className="bitebluff-stats">
            <div>
              <span>{entry ? "Current balance" : "Available balance"}</span>
              <strong>
                {(entry
                  ? state.account.balance
                  : state.wager.availableBalance
                ).toLocaleString()} Bites
              </strong>
            </div>
            <div>
              <span>Your wager</span>
              <strong>{entry ? `${entry.wager.toLocaleString()} Bites` : "—"}</strong>
            </div>
            <div>
              <span>Sealed pool</span>
              <strong>{state.pot.toLocaleString()} Bites</strong>
            </div>
            <div>
              <span>Players</span>
              <strong>{state.participantCount}</strong>
            </div>
          </div>
        ) : null}

        {entry ? (
          <>
            <BitebluffTable
              hand={entry.hand}
              placedCount={placedCount}
              revealedCount={revealedCount}
              dealing={phase === "dealing"}
              readyToFlip={phase === "pause"}
              flipping={phase === "flipping"}
            />
            <section className="bitebluff-action-panel">
              <span className="bitebluff-private-label">
                {state?.round.status === "settled" ? "Daily result" : "Private hand"}
              </span>
              <h2>
                {state?.round.status === "settled"
                  ? entry.handLabel
                  : "Your cards are locked in"}
              </h2>
              <p>
                {state?.round.status === "settled"
                  ? `Payout: ${(entry.payout ?? 0).toLocaleString()} Bites · Net: ${
                      (entry.net ?? 0) > 0 ? "+" : ""
                    }${(entry.net ?? 0).toLocaleString()}`
                  : "Other players can only see your profile and wager. Your hand stays encrypted at rest until settlement."}
              </p>
            </section>
          </>
        ) : (
          <section className="bitebluff-action-panel">
            {state?.wager.entryOpen ? (
              reviewingWager ? (
                <>
                  <span className="bitebluff-private-label">Final confirmation</span>
                  <h2>Risk {selectedWager.toLocaleString()} Bites blindly?</h2>
                  <div className="bitebluff-blind-callout">
                    <span>
                      Your balance after this wager will be{" "}
                      {(state.wager.availableBalance - selectedWager).toLocaleString()} Bites.
                    </span>
                    <small>
                      Your five-card hand is dealt only after confirmation. You cannot
                      cancel or change this wager afterward.
                    </small>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      className="bitebluff-primary-button"
                      disabled={placingWager}
                      onClick={() => void confirmWager()}
                    >
                      {placingWager
                        ? "Dealingâ€¦"
                        : `Confirm ${selectedWager.toLocaleString()} Bite wager`}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-[#526c5e] px-5 py-3 font-semibold text-[#dce7df]"
                      disabled={placingWager}
                      onClick={() => setReviewingWager(false)}
                    >
                      Go back
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span className="bitebluff-private-label">Place today&apos;s wager</span>
                  <h2>Choose your risk before seeing any cards</h2>
                  <p>
                    Bet between {state.wager.minimum.toLocaleString()} and{" "}
                    {state.wager.maximum.toLocaleString()} Bites. The maximum keeps
                    the approved Burn &amp; Draw reserve available for its future
                    release.
                  </p>
                  {state.wager.topUp > 0 ? (
                    <p className="bitebluff-burn-notice">
                      Today&apos;s safety net adds {state.wager.topUp.toLocaleString()}{" "}
                      Bites when you confirm, bringing your available balance to{" "}
                      {state.wager.availableBalance.toLocaleString()}.
                    </p>
                  ) : null}
                  <label className="bitebluff-field max-w-sm">
                    <span>Wager</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={state.wager.minimum}
                      max={state.wager.maximum}
                      step={1}
                      value={wagerInput}
                      onChange={(event) => {
                        setWagerInput(event.target.value);
                        setError("");
                      }}
                    />
                    <small>
                      {state.wager.minimum.toLocaleString()} minimum ·{" "}
                      {state.wager.maximum.toLocaleString()} maximum
                    </small>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      ["Minimum", state.wager.minimum],
                      ["Half max", Math.max(state.wager.minimum, Math.floor(state.wager.maximum / 2))],
                      ["Maximum", state.wager.maximum],
                    ].map(([label, value]) => (
                      <button
                        key={label}
                        type="button"
                        className="rounded-full border border-[#526c5e] px-4 py-2 text-sm font-semibold text-[#dce7df]"
                        onClick={() => setWagerInput(String(value))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="bitebluff-primary-button"
                    disabled={!wagerIsValid}
                    onClick={() => setReviewingWager(true)}
                  >
                    Review wager
                  </button>
                </>
              )
            ) : (
              <>
                <h2>Today&apos;s entry window is closed</h2>
                <p>The next Bitebluff round opens at midnight Eastern.</p>
              </>
            )}
          </section>
        )}

        {state ? (
          <p className="text-center text-xs text-[#8ea79b]">
            Round commitment: {state.round.secretCommitment}
          </p>
        ) : null}
        {error ? <p className="bitebluff-error">{error}</p> : null}
      </div>
    </main>
  );
}
