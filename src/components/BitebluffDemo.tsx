"use client";

import { useEffect, useMemo, useState } from "react";
import {
  applyRandomBitebluffRedraw,
  bitebluffCardKey,
  dealBitebluffHand,
  seededBitebluffDeck,
} from "@/lib/bitebluff-cards";
import {
  BITEBLUFF_DEAL_INTERVAL_MS,
  BITEBLUFF_FLIP_INTERVAL_MS,
  BITEBLUFF_HAND_SIZE,
  BITEBLUFF_REVEAL_PAUSE_MS,
  type BitebluffCard,
  type BitebluffCategory,
} from "@/lib/bitebluff-constants";
import {
  bitebluffRedrawSurcharge,
  bitebluffTopUp,
  bitebluffWagerBounds,
  isBitebluffActive,
} from "@/lib/bitebluff-economy";
import {
  bitebluffFinalPreview,
  bitebluffPublicPreview,
  settleBitebluffLayers,
  type BitebluffSettlement,
} from "@/lib/bitebluff-payout";
import { evaluateBitebluffHand } from "@/lib/bitebluff-poker";
import type { GameMode } from "@/lib/types";
import BitebluffCardView from "./BitebluffCard";
import BitebluffTable from "./BitebluffTable";
import GameNav from "./GameNav";

type LabStatus = "setup" | "dealing" | "placed" | "flipping" | "sealed" | "settled";
type LabScenario = "random" | "layered" | "tie" | BitebluffCategory;

interface LabPlayer {
  id: string;
  name: string;
  avatar: string;
  balance: number;
  wager: number;
  redrawSurcharge: number;
  hand: BitebluffCard[];
  remaining: BitebluffCard[];
  payout: number;
  contestedPayout: number;
  unmatchedReturn: number;
  lastPlayedDay: number;
}

const CATEGORY_OPTIONS: Array<[BitebluffCategory, string]> = [
  ["royal-flush", "Royal Flush"],
  ["straight-flush", "Straight Flush"],
  ["four-of-a-kind", "Four of a Kind"],
  ["full-house", "Full House"],
  ["flush", "Flush"],
  ["straight", "Straight"],
  ["three-of-a-kind", "Three of a Kind"],
  ["two-pair", "Two Pair"],
  ["pair", "One Pair"],
  ["high-card", "High Card"],
];

const INITIAL_PLAYERS: LabPlayer[] = [
  labPlayer("you", "You", "Y", 500, 25, 0),
  labPlayer("moss", "Moss", "M", 500, 75, 1),
  labPlayer("juno", "Juno", "J", 500, 125, 3),
];

function labPlayer(
  id: string,
  name: string,
  avatar: string,
  balance: number,
  wager: number,
  lastPlayedDay: number,
): LabPlayer {
  return {
    id,
    name,
    avatar,
    balance,
    wager,
    redrawSurcharge: 0,
    hand: [],
    remaining: [],
    payout: 0,
    contestedPayout: 0,
    unmatchedReturn: 0,
    lastPlayedDay,
  };
}

function card(rank: BitebluffCard["rank"], suit: BitebluffCard["suit"]): BitebluffCard {
  return { rank, suit };
}

const FORCED_HANDS: Record<BitebluffCategory, BitebluffCard[]> = {
  "royal-flush": [card(14, "hearts"), card(13, "hearts"), card(12, "hearts"), card(11, "hearts"), card(10, "hearts")],
  "straight-flush": [card(9, "clubs"), card(8, "clubs"), card(7, "clubs"), card(6, "clubs"), card(5, "clubs")],
  "four-of-a-kind": [card(12, "clubs"), card(12, "diamonds"), card(12, "hearts"), card(12, "spades"), card(3, "clubs")],
  "full-house": [card(10, "clubs"), card(10, "diamonds"), card(10, "spades"), card(4, "hearts"), card(4, "clubs")],
  flush: [card(14, "spades"), card(11, "spades"), card(8, "spades"), card(5, "spades"), card(2, "spades")],
  straight: [card(8, "clubs"), card(7, "diamonds"), card(6, "hearts"), card(5, "spades"), card(4, "clubs")],
  "three-of-a-kind": [card(7, "clubs"), card(7, "diamonds"), card(7, "spades"), card(13, "hearts"), card(2, "clubs")],
  "two-pair": [card(11, "clubs"), card(11, "diamonds"), card(5, "hearts"), card(5, "spades"), card(14, "clubs")],
  pair: [card(9, "clubs"), card(9, "hearts"), card(14, "diamonds"), card(6, "spades"), card(3, "clubs")],
  "high-card": [card(14, "clubs"), card(11, "diamonds"), card(8, "hearts"), card(5, "spades"), card(2, "clubs")],
};

function handForScenario(
  scenario: LabScenario,
  playerIndex: number,
  generated: BitebluffCard[],
): BitebluffCard[] {
  if (scenario === "tie" && playerIndex < 2) return [...FORCED_HANDS["royal-flush"]];
  if (scenario === "tie" && playerIndex === 2) return [...FORCED_HANDS["four-of-a-kind"]];
  if (scenario === "layered") {
    const categories: BitebluffCategory[] = ["straight-flush", "four-of-a-kind", "full-house"];
    return [...FORCED_HANDS[categories[playerIndex] ?? "high-card"]];
  }
  if (scenario !== "random" && scenario !== "tie" && playerIndex === 0) {
    return [...FORCED_HANDS[scenario]];
  }
  return generated;
}

function nextSeed(): string {
  return globalThis.crypto?.randomUUID?.() ?? `bitebluff-${Date.now()}`;
}

export default function BitebluffDemo({
  onModeChange,
}: {
  onModeChange: (mode: GameMode) => void;
}) {
  const [status, setStatus] = useState<LabStatus>("setup");
  const [players, setPlayers] = useState<LabPlayer[]>(INITIAL_PLAYERS);
  const [seed, setSeed] = useState("bitebluff-lab-001");
  const [scenario, setScenario] = useState<LabScenario>("layered");
  const [placedCount, setPlacedCount] = useState(0);
  const [revealedCount, setRevealedCount] = useState(0);
  const [settlement, setSettlement] = useState<BitebluffSettlement | null>(null);
  const [redrawEnabled, setRedrawEnabled] = useState(false);
  const [redrawUsed, setRedrawUsed] = useState(false);
  const [burnNotice, setBurnNotice] = useState<string | null>(null);
  const [day, setDay] = useState(7);
  const [error, setError] = useState<string | null>(null);

  const you = players[0];
  const publicPreview = useMemo(
    () =>
      bitebluffPublicPreview(
        players.map(({ id, name, avatar, wager, redrawSurcharge }) => ({
          id,
          name,
          avatar,
          wager,
          redrawSurcharge,
        })),
      ),
    [players],
  );
  const localEvaluation = you.hand.length === 5 ? evaluateBitebluffHand(you.hand) : null;
  const redrawReserve = bitebluffRedrawSurcharge(you.wager);
  const finalPreview = useMemo(
    () =>
      settlement
        ? bitebluffFinalPreview(
            players.map(({ id, name, avatar, wager, redrawSurcharge, hand }) => ({
              id,
              name,
              avatar,
              wager,
              redrawSurcharge,
              hand,
            })),
            settlement,
          )
        : null,
    [players, settlement],
  );

  useEffect(() => {
    if (status === "placed") {
      const reveal = setTimeout(() => setStatus("flipping"), BITEBLUFF_REVEAL_PAUSE_MS);
      return () => clearTimeout(reveal);
    }

    if (status !== "dealing" && status !== "flipping") return;

    const placing = status === "dealing";
    const interval = placing ? BITEBLUFF_DEAL_INTERVAL_MS : BITEBLUFF_FLIP_INTERVAL_MS;
    const timers = Array.from({ length: BITEBLUFF_HAND_SIZE }, (_, index) =>
      setTimeout(
        () => (placing ? setPlacedCount(index + 1) : setRevealedCount(index + 1)),
        index * interval,
      ),
    );
    const finish = setTimeout(
      () => setStatus(placing ? "placed" : "sealed"),
      BITEBLUFF_HAND_SIZE * interval,
    );
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(finish);
    };
  }, [status]);

  const updatePlayer = (id: string, change: Partial<LabPlayer>) => {
    setPlayers((current) =>
      current.map((player) => (player.id === id ? { ...player, ...change } : player)),
    );
  };

  const commitRound = () => {
    setError(null);
    for (const player of players) {
      const topUp = bitebluffTopUp(player.balance);
      const toppedBalance = player.balance + topUp;
      const bounds = bitebluffWagerBounds(toppedBalance);
      if (
        !Number.isInteger(player.wager) ||
        player.wager < bounds.minimum ||
        player.wager > bounds.maximum
      ) {
        setError(
          `${player.name}'s wager must be between ${bounds.minimum} and ${bounds.maximum} Bites.`,
        );
        return;
      }
    }

    setPlayers((current) =>
      current.map((player, playerIndex) => {
        const toppedBalance = player.balance + bitebluffTopUp(player.balance);
        const dealt = dealBitebluffHand(seed, player.id);
        const chosenHand = handForScenario(scenario, playerIndex, dealt.hand);
        const chosenKeys = new Set(chosenHand.map(bitebluffCardKey));
        const remaining = seededBitebluffDeck(`${seed}:entrant:${player.id}:forced-remaining`).filter(
          (playingCard) => !chosenKeys.has(bitebluffCardKey(playingCard)),
        );
        return {
          ...player,
          balance: toppedBalance - player.wager,
          hand: chosenHand,
          remaining: scenario === "random" ? dealt.remaining : remaining,
          payout: 0,
          contestedPayout: 0,
          unmatchedReturn: 0,
          redrawSurcharge: 0,
        };
      }),
    );
    setSettlement(null);
    setRedrawUsed(false);
    setBurnNotice(null);
    setPlacedCount(0);
    setRevealedCount(0);
    setStatus("dealing");
  };

  const redraw = (count: number) => {
    const surcharge = bitebluffRedrawSurcharge(you.wager);
    if (you.balance < surcharge) {
      setError(`You need ${surcharge} available Bites to Burn & Draw.`);
      return;
    }
    const result = applyRandomBitebluffRedraw({
      hand: you.hand,
      remaining: you.remaining,
      seed: `${seed}:day:${day}:entrant:${you.id}:redraw`,
      count,
    });
    updatePlayer(you.id, {
      hand: result.hand,
      remaining: result.remaining,
      balance: you.balance - surcharge,
      redrawSurcharge: surcharge,
    });
    setRedrawUsed(true);
    setBurnNotice(
      `${count} random ${count === 1 ? "card was" : "cards were"} burned. The surcharge added ${surcharge} Bites to the pool.`,
    );
    setPlacedCount(0);
    setRevealedCount(0);
    setStatus("dealing");
  };

  const settle = () => {
    const result = settleBitebluffLayers(
      players.map((player) => ({
        id: player.id,
        committed: player.wager + player.redrawSurcharge,
        hand: player.hand,
      })),
    );
    setSettlement(result);
    setPlayers((current) =>
      current.map((player) => ({
        ...player,
        balance: player.balance + result.payouts[player.id],
        payout: result.payouts[player.id],
        contestedPayout: result.contestedPayouts[player.id],
        unmatchedReturn: result.unmatchedReturns[player.id],
        lastPlayedDay: day,
      })),
    );
    setStatus("settled");
  };

  const nextDay = () => {
    const next = day + 1;
    setPlayers((current) =>
      current.map((player) => {
        const nextBalance = player.balance + bitebluffTopUp(player.balance);
        const bounds = bitebluffWagerBounds(nextBalance);
        return {
          ...player,
          balance: nextBalance,
          wager: Math.min(bounds.maximum, Math.max(bounds.minimum, player.wager)),
          redrawSurcharge: 0,
          hand: [],
          remaining: [],
          payout: 0,
          contestedPayout: 0,
          unmatchedReturn: 0,
        };
      }),
    );
    setDay(next);
    setSeed(nextSeed());
    setSettlement(null);
    setRedrawUsed(false);
    setBurnNotice(null);
    setPlacedCount(0);
    setRevealedCount(0);
    setStatus("setup");
  };

  const addDummy = () => {
    const index = players.length;
    setPlayers((current) => [
      ...current,
      labPlayer(`dummy-${index}`, `Player ${index + 1}`, String(index + 1), 500, 25, day - 8),
    ]);
  };

  return (
    <div className="bitebluff-lab min-h-screen">
      <GameNav mode="bitebluff" onModeChange={onModeChange} />
      <main className="mx-auto w-full max-w-7xl px-3 py-5 sm:px-6">
        <header className="bitebluff-hero">
          <div>
            <p className="bitebluff-kicker">Website settlement lab · Dummy Bites only</p>
            <h1>BITEBLUFF</h1>
            <p>
              Lock a blind wager, reveal your private hand, then see how unequal
              bets settle through main and side pots at 11 PM ET.
            </p>
          </div>
          <div className="bitebluff-clock">
            <span>SIMULATED REVEAL</span>
            <strong>11:00 PM ET</strong>
            <small>Lab day {day}</small>
          </div>
        </header>

        <div className="bitebluff-layout">
          <section className="bitebluff-primary">
            <div className="bitebluff-stats">
              <Stat label="Available" value={`${you.balance} B`} />
              <Stat label="Initial wager" value={`${you.wager} B`} />
              <Stat
                label="Redraw reserve"
                value={
                  status === "settled"
                    ? "Released"
                    : redrawUsed
                      ? "Spent"
                      : `${redrawReserve} B`
                }
              />
              <Stat label="Pool" value={`${publicPreview.pot} B`} />
              <Stat
                label="Active board"
                value={isBitebluffActive(you.lastPlayedDay, day) ? "Eligible" : "Inactive"}
              />
            </div>

            <BitebluffTable
              hand={you.hand}
              placedCount={placedCount}
              revealedCount={revealedCount}
              dealing={status === "dealing"}
              readyToFlip={status === "placed"}
              flipping={status === "flipping"}
            />

            <section className="bitebluff-action-panel">
              {status === "setup" && (
                <>
                  <div className="bitebluff-blind-callout">
                    <span>BLIND WAGER</span>
                    <strong>Your hand does not exist until you confirm.</strong>
                    <small>
                      Once locked, the wager cannot be reduced or withdrawn.
                      Your {redrawReserve}-Bite reserve remains available unless
                      Burn &amp; Draw is confirmed.
                    </small>
                  </div>
                  <button type="button" className="bitebluff-primary-button" onClick={commitRound}>
                    Lock wagers &amp; deal
                  </button>
                </>
              )}
              {status === "dealing" && (
                <p className="bitebluff-deal-status">
                  Placing card {Math.max(1, placedCount)} of 5…
                </p>
              )}
              {status === "flipping" && (
                <p className="bitebluff-deal-status">
                  Flipping card {Math.max(1, revealedCount)} of 5…
                </p>
              )}
              {status === "placed" && (
                <p className="bitebluff-deal-status">
                  All 5 cards placed face-down · Revealing next…
                </p>
              )}
              {status === "sealed" && (
                <>
                  <div>
                    <span className="bitebluff-private-label">Private hand</span>
                    <h2>{localEvaluation?.label}</h2>
                    <p>Your cards remain sealed from every dummy opponent.</p>
                  </div>
                  {redrawEnabled && !redrawUsed && (
                    <div className="bitebluff-redraw-box">
                      <strong>Burn &amp; Draw experiment</strong>
                      <p>
                        Choose only a count. The lab randomly burns those cards;
                        even your strongest card can disappear. Cost:{" "}
                        {bitebluffRedrawSurcharge(you.wager)} Bites.
                      </p>
                      <div>
                        {[1, 2, 3].map((count) => (
                          <button key={count} type="button" onClick={() => redraw(count)}>
                            Randomly burn {count}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {burnNotice && <p className="bitebluff-burn-notice">{burnNotice}</p>}
                  <button type="button" className="bitebluff-primary-button" onClick={settle}>
                    Advance to 11 PM &amp; settle
                  </button>
                </>
              )}
              {status === "settled" && settlement && (
                <SettlementSummary players={players} settlement={settlement} />
              )}
              {error && <p className="bitebluff-error" role="alert">{error}</p>}
            </section>
          </section>

          <aside className="bitebluff-sidebar">
            {status === "setup" ? (
              <SetupPanel
                players={players}
                scenario={scenario}
                seed={seed}
                redrawEnabled={redrawEnabled}
                onScenario={setScenario}
                onSeed={setSeed}
                onRedrawEnabled={setRedrawEnabled}
                onPlayer={updatePlayer}
                onAdd={addDummy}
                onRemove={(id) => setPlayers((current) => current.filter((player) => player.id !== id))}
              />
            ) : status === "settled" && finalPreview ? (
              <FinalGeneratedPreview preview={finalPreview} />
            ) : (
              <PublicPreview preview={publicPreview} />
            )}

            <LeaderboardLab players={players} day={day} />

            {status === "settled" && (
              <button type="button" className="bitebluff-next-button" onClick={nextDay}>
                Start next simulated day
              </button>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SetupPanel({
  players,
  scenario,
  seed,
  redrawEnabled,
  onScenario,
  onSeed,
  onRedrawEnabled,
  onPlayer,
  onAdd,
  onRemove,
}: {
  players: LabPlayer[];
  scenario: LabScenario;
  seed: string;
  redrawEnabled: boolean;
  onScenario: (value: LabScenario) => void;
  onSeed: (value: string) => void;
  onRedrawEnabled: (value: boolean) => void;
  onPlayer: (id: string, change: Partial<LabPlayer>) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <section className="bitebluff-panel">
      <div className="bitebluff-panel-heading">
        <div>
          <span>TEST CONTROLS</span>
          <h2>Build the pool</h2>
        </div>
        <button type="button" onClick={onAdd}>+ Dummy</button>
      </div>

      <label className="bitebluff-field">
        <span>Forced scenario</span>
        <select value={scenario} onChange={(event) => onScenario(event.target.value as LabScenario)}>
          <option value="random">Seeded random hands</option>
          <option value="layered">Layered-pot example</option>
          <option value="tie">Exact royal-flush tie</option>
          <optgroup label="Force your private hand">
            {CATEGORY_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </optgroup>
        </select>
      </label>
      <label className="bitebluff-field">
        <span>Simulator seed</span>
        <input value={seed} onChange={(event) => onSeed(event.target.value)} />
      </label>
      <label className="bitebluff-toggle">
        <input
          type="checkbox"
          checked={redrawEnabled}
          onChange={(event) => onRedrawEnabled(event.target.checked)}
        />
        <span>
          <strong>Enable Burn &amp; Draw experiment</strong>
          <small>Off by default; not an approved production rule.</small>
        </span>
      </label>

      <div className="bitebluff-player-editor">
        {players.map((player, index) => {
          const topped = player.balance + bitebluffTopUp(player.balance);
          const bounds = bitebluffWagerBounds(topped);
          return (
            <div key={player.id} className="bitebluff-player-edit">
              <span className="bitebluff-avatar">{player.avatar}</span>
              <label>
                <span>{player.name}</span>
              <small>{player.balance} B · allowed {bounds.minimum}–{bounds.maximum}</small>
              </label>
              <input
                aria-label={`${player.name} wager`}
                type="number"
                min={bounds.minimum}
                max={bounds.maximum}
                value={player.wager}
                onChange={(event) => onPlayer(player.id, { wager: Number(event.target.value) })}
              />
              {index > 0 && (
                <button type="button" aria-label={`Remove ${player.name}`} onClick={() => onRemove(player.id)}>
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PublicPreview({
  preview,
}: {
  preview: ReturnType<typeof bitebluffPublicPreview>;
}) {
  return (
    <section className="bitebluff-panel bitebluff-preview">
      <div className="bitebluff-preview-title">
        <div>
          <span>PUBLIC IMAGE PREVIEW</span>
          <h2>{preview.title}</h2>
        </div>
        <strong>{preview.pot} B</strong>
      </div>
      <p>{preview.revealLabel}</p>
      <div className="bitebluff-preview-list">
        {preview.participants.map((participant) => (
          <div key={participant.id}>
            <span className="bitebluff-avatar">{participant.avatar}</span>
            <strong>{participant.name}</strong>
            <b>{participant.wager} B</b>
          </div>
        ))}
      </div>
      <small>
        {preview.participantCount} entrants · Avatar and wager only · No hand data
      </small>
    </section>
  );
}

function FinalGeneratedPreview({
  preview,
}: {
  preview: ReturnType<typeof bitebluffFinalPreview>;
}) {
  return (
    <section className="bitebluff-panel border-amber-300/30 bg-[#1b211d]">
      <div className="bitebluff-preview-title">
        <div>
          <span>GENERATED IMAGE PREVIEW</span>
          <h2>{preview.title} results</h2>
        </div>
        <strong>{preview.totalPool} B</strong>
      </div>
      <p className="mb-3 mt-2 text-[0.58rem] font-black tracking-[0.08em] text-[#b9a77d]">
        {preview.statusLabel}
      </p>
      <div className="grid gap-2">
        {preview.participants.map((participant) => (
          <article
            key={participant.id}
            className={`overflow-hidden rounded-xl border p-2 ${
              participant.winner
                ? "border-amber-300/40 bg-[linear-gradient(135deg,rgba(104,76,23,0.2),transparent_65%)]"
                : "border-white/10 bg-[#0e1411]/75"
            }`}
          >
            <header className="flex items-center gap-2">
              <span className="bitebluff-avatar">{participant.avatar}</span>
              <div className="min-w-0 flex-1">
                <strong className="block">{participant.name}</strong>
                <small className="block text-[0.58rem] text-[#8b9991]">
                  {participant.handLabel}
                </small>
              </div>
              <b
                className={`text-[0.62rem] tracking-[0.06em] ${
                  participant.winner ? "text-[#edc96f]" : "text-[#b9978d]"
                }`}
              >
                {participant.winner ? "WINNER" : `-${participant.amountLost} B`}
              </b>
            </header>
            <div className="mt-2 flex gap-0.5">
              {participant.hand.map((playingCard, index) => (
                <BitebluffCardView
                  key={`${playingCard.rank}:${playingCard.suit}:${index}`}
                  card={playingCard}
                  className="!w-auto min-w-0 flex-1"
                />
              ))}
            </div>
            {participant.winner ? (
              <footer className="mt-2 grid grid-cols-[auto_1fr] items-baseline gap-x-2 gap-y-0.5">
                <strong className="text-[0.66rem] text-[#edd083]">
                  Total payout {participant.payout} B
                </strong>
                <span className="text-right text-[0.58rem] text-[#a9b4ae]">
                  Won {participant.contestedPayout} B · {participant.layerWins.join(" + ")}
                </span>
                <small className="col-span-2 text-[0.54rem] text-[#76847d]">
                  Wagered {participant.committed} B
                  {participant.unmatchedReturn > 0
                    ? ` · ${participant.unmatchedReturn} B unmatched and returned`
                    : ""}{" "}
                  · Net{" "}
                  {participant.net >= 0 ? "+" : ""}
                  {participant.net} B
                </small>
              </footer>
            ) : (
              <footer className="mt-2 grid grid-cols-[auto_1fr] items-baseline gap-x-2 gap-y-0.5">
                <strong className="text-[0.66rem] text-[#edd083]">
                  Wagered {participant.committed} B
                </strong>
                <span className="text-right text-[0.58rem] text-[#a9b4ae]">
                  Lost {participant.amountLost} B
                </span>
                {participant.unmatchedReturn > 0 && (
                  <small className="col-span-2 text-[0.54rem] text-[#76847d]">
                    {participant.unmatchedReturn} B unmatched and returned
                  </small>
                )}
              </footer>
            )}
          </article>
        ))}
      </div>
      <small className="mt-3 block text-[0.54rem] leading-relaxed text-[#746c59]">
        Automatic zero-ping result post · Every hand shown · Dummy website data
      </small>
    </section>
  );
}

function LeaderboardLab({ players, day }: { players: LabPlayer[]; day: number }) {
  const rows = [...players].sort((a, b) => b.balance - a.balance);
  return (
    <section className="bitebluff-panel bitebluff-leaderboard">
      <div className="bitebluff-panel-heading">
        <div>
          <span>LEADERBOARD LAB</span>
          <h2>Active bankroll</h2>
        </div>
        <small>7-day window</small>
      </div>
      {rows.map((player, index) => {
        const active = isBitebluffActive(player.lastPlayedDay, day);
        return (
          <div key={player.id} className={!active ? "bitebluff-inactive" : ""}>
            <span>{active ? index + 1 : "—"}</span>
            <strong>{player.name}</strong>
            <b>{player.balance} B</b>
            <small>{active ? "Ranked" : "Balance kept · inactive"}</small>
          </div>
        );
      })}
      <p>Season earnings exclude safety-net top-ups. Unmatched returns are not wins.</p>
    </section>
  );
}

function SettlementSummary({
  players,
  settlement,
}: {
  players: LabPlayer[];
  settlement: BitebluffSettlement;
}) {
  const byId = new Map(players.map((player) => [player.id, player]));
  return (
    <div className="bitebluff-settlement">
      <div>
        <span className="bitebluff-private-label">Settlement complete</span>
        <h2>{settlement.totalPool} Bites accounted for</h2>
        <p>The best overall hand wins only the layers its wager covered.</p>
      </div>
      <div className="bitebluff-reveal-grid">
        {players.map((player) => (
          <article key={player.id}>
            <header>
              <span className="bitebluff-avatar">{player.avatar}</span>
              <div>
                <strong>{player.name}</strong>
                <small>{evaluateBitebluffHand(player.hand).label}</small>
              </div>
              <b>+{player.payout} B</b>
            </header>
            <div className="bitebluff-mini-hand">
              {player.hand.map((playingCard, index) => (
                <BitebluffCardView key={`${playingCard.rank}:${playingCard.suit}:${index}`} card={playingCard} />
              ))}
            </div>
            <footer>
              <span>Contested {player.contestedPayout} B</span>
              <span>Returned {player.unmatchedReturn} B</span>
            </footer>
          </article>
        ))}
      </div>
      <div className="bitebluff-layer-list">
        {settlement.layers.map((layer) => (
          <div key={layer.index}>
            <span>{layer.index === 0 ? "Main pot" : `Layer ${layer.index + 1}`}</span>
            <strong>{layer.amount} B</strong>
            <small>
              {layer.unmatched
                ? `Unmatched wager returned to ${byId.get(layer.winnerIds[0])?.name}`
                : `Won by ${layer.winnerIds.map((id) => byId.get(id)?.name).join(" + ")}`}
            </small>
          </div>
        ))}
      </div>
    </div>
  );
}
