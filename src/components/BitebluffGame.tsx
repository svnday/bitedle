"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import {
  BITEBLUFF_ABSOLUTE_MIN_WAGER,
  BITEBLUFF_DEAL_INTERVAL_MS,
  BITEBLUFF_FLIP_INTERVAL_MS,
  BITEBLUFF_REDRAW_RATE,
  BITEBLUFF_REVEAL_PAUSE_MS,
} from "@/lib/bitebluff-constants";
import type {
  BitebluffLeaderboard,
  BitebluffPrivateState,
} from "@/lib/bitebluff-types";
import BitebluffLeaderboardModal from "./BitebluffLeaderboardModal";
import BitebluffHandStrength from "./BitebluffHandStrength";
import BitebluffPotRoster from "./BitebluffPotRoster";
import BitebluffSettlementResults from "./BitebluffSettlementResults";
import BitebluffTable from "./BitebluffTable";
import { useBitebluffRedrawAnimation } from "./useBitebluffRedrawAnimation";

type DealPhase = "idle" | "dealing" | "pause" | "flipping" | "done";

function easternTime(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(timestamp));
}

export default function BitebluffGame() {
  const [state, setState] = useState<BitebluffPrivateState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [wagerInput, setWagerInput] = useState("");
  const [reviewingWager, setReviewingWager] = useState(false);
  const [placingWager, setPlacingWager] = useState(false);
  const [selectedBurnPositions, setSelectedBurnPositions] = useState<number[]>(
    [],
  );
  const [redrawCount, setRedrawCount] = useState(1);
  const [reviewingRedraw, setReviewingRedraw] = useState(false);
  const [redrawing, setRedrawing] = useState(false);
  const {
    animation: redrawAnimation,
    start: startRedrawAnimation,
  } = useBitebluffRedrawAnimation();
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [leaderboard, setLeaderboard] = useState<BitebluffLeaderboard | null>(
    null,
  );
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState("");
  const [placedCount, setPlacedCount] = useState(0);
  const [revealedCount, setRevealedCount] = useState(0);
  const [phase, setPhase] = useState<DealPhase>("idle");
  const animated = useRef(false);

  const beginDeal = useCallback(() => {
    animated.current = true;
    setPlacedCount(0);
    setRevealedCount(0);
    setPhase("dealing");
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await api.bitebluffState();
      setState(next);
      setError("");
      if (next.round.status !== "settled") setResultsOpen(false);
      if (!next.entry) {
        setWagerInput((current) => current || String(next.wager.minimum));
      }
      if (next.entry && !animated.current) {
        if (next.entry.redraw) {
          animated.current = true;
          setPlacedCount(5);
          setRevealedCount(5);
          setPhase("done");
        } else {
          beginDeal();
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn’t load Bitebluff.");
    } finally {
      setLoading(false);
    }
  }, [beginDeal]);

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

  useEffect(() => {
    if (!leaderboardOpen && !resultsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLeaderboardOpen(false);
        setResultsOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [leaderboardOpen, resultsOpen]);

  const entry = state?.entry ?? null;
  const selectedWager = Number(wagerInput);
  const wagerIsValid =
    state !== null &&
    Number.isSafeInteger(selectedWager) &&
    selectedWager >= state.wager.minimum &&
    selectedWager <= state.wager.maximum;
  const redrawReserve = Number.isSafeInteger(selectedWager)
    ? Math.max(
        BITEBLUFF_ABSOLUTE_MIN_WAGER,
        Math.ceil(selectedWager * BITEBLUFF_REDRAW_RATE),
      )
    : 0;
  const revealTime = state ? easternTime(state.round.revealAt) : "11:00 PM ET";
  const redrawDeadline = state
    ? easternTime(state.burnAndDraw.deadline)
    : "10:55 PM ET";
  const selectedCardRedraw =
    state?.burnAndDraw.mode === "selected-cards";
  const redrawAnimationStatus = redrawAnimation
    ? redrawAnimation.phase === "burning"
      ? `Burning ${redrawAnimation.positions.length} selected ${
          redrawAnimation.positions.length === 1 ? "card" : "cards"
        }...`
      : redrawAnimation.phase === "drawing"
        ? `Pulling replacement ${redrawAnimation.step + 1} of ${
            redrawAnimation.positions.length
          } from the deck...`
        : `Revealing replacement ${redrawAnimation.step + 1} of ${
            redrawAnimation.positions.length
          }...`
    : null;

  async function confirmWager() {
    if (!state || !wagerIsValid || placingWager) return;
    setPlacingWager(true);
    setError("");
    try {
      const next = await api.bitebluffEnter(selectedWager);
      setState(next);
      setReviewingWager(false);
      if (next.entry) beginDeal();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn’t place that wager.");
    } finally {
      setPlacingWager(false);
    }
  }

  async function confirmRedraw() {
    if (
      !state?.entry ||
      !state.burnAndDraw.available ||
      (selectedCardRedraw &&
        (selectedBurnPositions.length < 1 ||
          selectedBurnPositions.length > 3)) ||
      redrawing
    ) {
      return;
    }
    const lockedPositions = [...selectedBurnPositions].sort((a, b) => a - b);
    const previousHand = [...state.entry.hand];
    setRedrawing(true);
    setError("");
    try {
      const next = await api.bitebluffRedraw(
        selectedCardRedraw
          ? { positions: lockedPositions }
          : { count: redrawCount },
      );
      setState(next);
      setReviewingRedraw(false);
      setPlacedCount(5);
      setRevealedCount(5);
      setPhase("done");
      const confirmedPositions =
        next.entry?.redraw?.positions ?? lockedPositions;
      startRedrawAnimation(previousHand, confirmedPositions, () => {
        setSelectedBurnPositions([]);
        setRedrawing(false);
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Burn & Draw failed.");
      setRedrawing(false);
    }
  }

  function toggleBurnPosition(position: number) {
    if (reviewingRedraw || redrawing) return;
    setError("");
    setSelectedBurnPositions((current) => {
      if (current.includes(position)) {
        return current.filter((selected) => selected !== position);
      }
      if (current.length >= 3) return current;
      return [...current, position].sort((a, b) => a - b);
    });
  }

  async function openLeaderboard() {
    setLeaderboardOpen(true);
    setLeaderboardLoading(true);
    setLeaderboardError("");
    try {
      setLeaderboard(await api.bitebluffLeaderboard());
    } catch (caught) {
      setLeaderboardError(
        caught instanceof Error ? caught.message : "Couldn’t load the leaderboard.",
      );
    } finally {
      setLeaderboardLoading(false);
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
              {state?.round.status === "settled"
                ? "Settlement is complete. Every final hand is now public until midnight Eastern."
                : `Your hand is private until the server-wide reveal at ${revealTime}.`}
            </p>
          </div>
          <div className="bitebluff-hero-actions">
            <button
              type="button"
              className="bitebluff-leaderboard-button"
              onClick={() => void openLeaderboard()}
            >
              View leaderboard
            </button>
            <div className="bitebluff-clock">
              <span>{state?.round.status === "settled" ? "Round" : "Reveal"}</span>
              <strong>{state?.round.status === "settled" ? "Final" : revealTime}</strong>
              <small>{state?.round.date ?? (loading ? "Loading…" : "Unavailable")}</small>
            </div>
          </div>
        </header>

        {state ? (
          <div className="bitebluff-stats">
            <div>
              <span>
                {state.round.status === "settled" || entry
                  ? "Current bankroll"
                  : "Available bankroll"}
              </span>
              <strong>
                {(state.round.status === "settled" || entry
                  ? state.account.balance
                  : state.wager.availableBalance
                ).toLocaleString()}{" "}
                Bites
              </strong>
            </div>
            <div>
              <span>Your wager</span>
              <strong>{entry ? `${entry.committed.toLocaleString()} Bites` : "—"}</strong>
            </div>
            <div>
              <span>
                {state.round.status === "settled" ? "Final pool" : "Sealed pool"}
              </span>
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
            <div className="bitebluff-private-layout">
              <BitebluffTable
                hand={entry.hand}
                placedCount={placedCount}
                revealedCount={revealedCount}
                dealing={phase === "dealing"}
                readyToFlip={phase === "pause"}
                flipping={phase === "flipping"}
                replacementPositions={entry.redraw?.positions ?? []}
                selectedBurnPositions={selectedBurnPositions}
                burnSelectionMode={
                  phase === "done" &&
                  !entry.redraw &&
                  Boolean(state?.burnAndDraw.available) &&
                  selectedCardRedraw
                }
                burnSelectionLocked={reviewingRedraw || redrawing}
                onToggleBurnPosition={toggleBurnPosition}
                redrawAnimation={redrawAnimation}
              />
              <BitebluffPotRoster participants={state?.participants ?? []} />
            </div>
            <section className="bitebluff-action-panel">
              <span className="bitebluff-private-label">
                {state?.round.status === "settled" ? "Daily result" : "Private hand"}
              </span>
              <h2>
                {state?.round.status === "settled"
                  ? entry.handLabel
                  : entry.redraw
                    ? "Your replacement hand is locked in"
                    : "Your cards are locked in"}
              </h2>
              <p>
                {state?.round.status === "settled"
                  ? `Payout: ${(entry.payout ?? 0).toLocaleString()} Bites · Net: ${
                      (entry.net ?? 0) > 0 ? "+" : ""
                    }${(entry.net ?? 0).toLocaleString()}`
                  : "Other players can see who entered and each original locked wager. Every hand stays encrypted until settlement."}
              </p>

              {state?.round.status === "settled" && state.results ? (
                <button
                  type="button"
                  className="bitebluff-primary-button bitebluff-results-button"
                  onClick={() => setResultsOpen(true)}
                >
                  View everyone&apos;s revealed hands
                </button>
              ) : null}

              {state?.round.status !== "settled" &&
              (phase !== "done" || redrawAnimationStatus) ? (
                <p className="bitebluff-deal-status">
                  {redrawAnimationStatus ??
                    (entry.redraw
                      ? "Dealing your replacement hand…"
                      : "Dealing your hand…")}
                </p>
              ) : null}

              {phase === "done" && !redrawAnimation ? (
                <BitebluffHandStrength hand={entry.hand} />
              ) : null}

              {state?.round.status !== "settled" &&
              phase === "done" &&
              !redrawAnimation ? (
                entry.redraw ? (
                  <div className="bitebluff-redraw-complete">
                    <strong>Burn &amp; Draw used</strong>
                    <span>
                      {entry.redraw.count}{" "}
                      {entry.redraw.count === 1 ? "card was" : "cards were"} replaced.
                      The {entry.redraw.surcharge.toLocaleString()} Bite surcharge is
                      now part of your wager.
                    </span>
                  </div>
                ) : state?.burnAndDraw.available ? (
                  <div className="bitebluff-redraw-box">
                    <strong>Burn &amp; Draw</strong>
                    <p>
                      {selectedCardRedraw ? (
                        <>
                          Pay {state.burnAndDraw.surcharge?.toLocaleString()} Bites
                          to burn and replace the 1–3 cards you select above.
                          Untouched cards stay in place, but the replacements can
                          make your hand worse.
                        </>
                      ) : (
                        <>
                          Pay {state.burnAndDraw.surcharge?.toLocaleString()} Bites
                          to replace 1–3 randomly selected cards. You cannot choose
                          or protect any card in today&apos;s round.
                        </>
                      )}
                    </p>
                    {reviewingRedraw ? (
                      <div className="bitebluff-redraw-confirm">
                        <p>
                          {selectedCardRedraw ? (
                            <>
                              Burn the {selectedBurnPositions.length} selected{" "}
                              {selectedBurnPositions.length === 1
                                ? "card"
                                : "cards"}
                              ?
                            </>
                          ) : (
                            <>
                              The server will randomly burn {redrawCount}{" "}
                              {redrawCount === 1 ? "card" : "cards"}.
                            </>
                          )}{" "}
                          This is irreversible and costs{" "}
                          {state.burnAndDraw.surcharge?.toLocaleString()} Bites.
                        </p>
                        <button
                          type="button"
                          className="bitebluff-primary-button"
                          disabled={redrawing}
                          onClick={() => void confirmRedraw()}
                        >
                          {redrawing
                            ? "Locking redraw…"
                            : selectedCardRedraw
                              ? `Burn & Draw ${selectedBurnPositions.length} ${
                                  selectedBurnPositions.length === 1
                                    ? "card"
                                    : "cards"
                                }`
                              : `Confirm random redraw of ${redrawCount}`}
                        </button>
                        <button
                          type="button"
                          className="bitebluff-secondary-button"
                          disabled={redrawing}
                          onClick={() => setReviewingRedraw(false)}
                        >
                          {selectedCardRedraw ? "Change selection" : "Go back"}
                        </button>
                      </div>
                    ) : (
                      <>
                        {selectedCardRedraw ? (
                          <div className="bitebluff-redraw-selection-status">
                            <strong>
                              {selectedBurnPositions.length} of 3 selected
                            </strong>
                            <span>
                              Select between 1 and 3 cards directly from your hand.
                            </span>
                          </div>
                        ) : (
                          <div
                            role="group"
                            aria-label="Number of random cards to redraw"
                          >
                            {[1, 2, 3].map((count) => (
                              <button
                                key={count}
                                type="button"
                                className={
                                  redrawCount === count ? "is-selected" : ""
                                }
                                onClick={() => setRedrawCount(count)}
                              >
                                {count} {count === 1 ? "card" : "cards"}
                              </button>
                            ))}
                          </div>
                        )}
                        <button
                          type="button"
                          className="bitebluff-primary-button"
                          disabled={
                            selectedCardRedraw &&
                            selectedBurnPositions.length === 0
                          }
                          onClick={() => setReviewingRedraw(true)}
                        >
                          Review Burn &amp; Draw
                        </button>
                      </>
                    )}
                    <small>Available once · closes at {redrawDeadline}</small>
                  </div>
                ) : state?.burnAndDraw.unavailableReason ? (
                  <p className="bitebluff-burn-notice">
                    {state.burnAndDraw.unavailableReason}
                  </p>
                ) : null
              ) : null}
            </section>
          </>
        ) : state ? (
          <section className="bitebluff-action-panel">
            {state.wager.entryOpen ? (
              reviewingWager ? (
                <>
                  <span className="bitebluff-private-label">Final confirmation</span>
                  <h2>Risk {selectedWager.toLocaleString()} Bites blindly?</h2>
                  <div className="bitebluff-blind-callout">
                    <span>
                      Your bankroll after this wager will be{" "}
                      {(state.wager.availableBalance - selectedWager).toLocaleString()}{" "}
                      Bites.
                    </span>
                    <small>
                      Burn &amp; Draw will remain available once for{" "}
                      {redrawReserve.toLocaleString()} additional Bites. Your five-card
                      hand is dealt only after confirmation, and the wager cannot be
                      changed afterward.
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
                        ? "Dealing…"
                        : `Confirm ${selectedWager.toLocaleString()} Bite wager`}
                    </button>
                    <button
                      type="button"
                      className="bitebluff-secondary-button"
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
                    {state.wager.maximum.toLocaleString()}{" "}Bites. The maximum keeps
                    enough bankroll available for one Burn &amp; Draw.
                  </p>
                  {state.wager.topUp > 0 ? (
                    <p className="bitebluff-burn-notice">
                      Today&apos;s safety net adds {state.wager.topUp.toLocaleString()}{" "}
                      Bites when you confirm, bringing your available bankroll to{" "}
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
                      [
                        "Half max",
                        Math.max(
                          state.wager.minimum,
                          Math.floor(state.wager.maximum / 2),
                        ),
                      ],
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
            ) : state.round.status === "settled" && state.results ? (
              <>
                <span className="bitebluff-private-label">
                  Settlement complete
                </span>
                <h2>Today&apos;s hands have been revealed</h2>
                <p>
                  You did not enter this round, but the completed guild results
                  are public until the next game opens at midnight Eastern.
                </p>
                <button
                  type="button"
                  className="bitebluff-primary-button bitebluff-results-button"
                  onClick={() => setResultsOpen(true)}
                >
                  View everyone&apos;s revealed hands
                </button>
              </>
            ) : (
              <>
                <h2>Today&apos;s entry window is closed</h2>
                <p>The next Bitebluff round opens at midnight Eastern.</p>
              </>
            )}
          </section>
        ) : (
          <section className="bitebluff-action-panel">
            <h2>{loading ? "Loading today’s Bitebluff round…" : "Bitebluff couldn’t load"}</h2>
            {!loading ? (
              <button type="button" className="bitebluff-primary-button" onClick={() => void load()}>
                Try again
              </button>
            ) : null}
          </section>
        )}

        {state ? (
          <p className="text-center text-xs text-[#8ea79b]">
            Round commitment: {state.round.secretCommitment}
          </p>
        ) : null}
        {error ? <p className="bitebluff-error">{error}</p> : null}
      </div>

      {leaderboardOpen ? (
        <BitebluffLeaderboardModal
          leaderboard={leaderboard}
          loading={leaderboardLoading}
          error={leaderboardError}
          onClose={() => setLeaderboardOpen(false)}
        />
      ) : null}
      {resultsOpen && state?.round.status === "settled" && state.results ? (
        <BitebluffSettlementResults
          results={state.results}
          totalPool={state.pot}
          onClose={() => setResultsOpen(false)}
        />
      ) : null}
    </main>
  );
}
