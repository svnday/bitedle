import type { BitebluffCard } from "./bitebluff-constants";
import { compareBitebluffHands, evaluateBitebluffHand } from "./bitebluff-poker";

export interface BitebluffSettlementEntrant {
  id: string;
  committed: number;
  hand: readonly BitebluffCard[];
}

export interface BitebluffLayer {
  index: number;
  from: number;
  to: number;
  amount: number;
  eligibleIds: string[];
  winnerIds: string[];
  awards: Record<string, number>;
  unmatched: boolean;
}

export interface BitebluffSettlement {
  totalPool: number;
  payouts: Record<string, number>;
  contestedPayouts: Record<string, number>;
  unmatchedReturns: Record<string, number>;
  layers: BitebluffLayer[];
}

export function settleBitebluffLayers(
  entrants: readonly BitebluffSettlementEntrant[],
): BitebluffSettlement {
  const ids = new Set<string>();
  for (const entrant of entrants) {
    if (!entrant.id || ids.has(entrant.id)) throw new Error("Settlement entrant IDs must be unique.");
    if (!Number.isInteger(entrant.committed) || entrant.committed <= 0) {
      throw new Error("Committed Bite amounts must be positive integers.");
    }
    ids.add(entrant.id);
  }
  const payouts = Object.fromEntries(entrants.map((entrant) => [entrant.id, 0]));
  const contestedPayouts = Object.fromEntries(entrants.map((entrant) => [entrant.id, 0]));
  const unmatchedReturns = Object.fromEntries(entrants.map((entrant) => [entrant.id, 0]));
  const evaluations = new Map(
    entrants.map((entrant) => [entrant.id, evaluateBitebluffHand(entrant.hand)]),
  );
  const thresholds = [...new Set(entrants.map((entrant) => entrant.committed))].sort(
    (a, b) => a - b,
  );
  const layers: BitebluffLayer[] = [];
  let previous = 0;

  thresholds.forEach((threshold, index) => {
    const eligible = entrants
      .filter((entrant) => entrant.committed >= threshold)
      .sort((a, b) => a.id.localeCompare(b.id));
    const amount = (threshold - previous) * eligible.length;
    const unmatched = eligible.length === 1;
    let winners = eligible;
    if (!unmatched) {
      const best = eligible.reduce((current, contender) =>
        compareBitebluffHands(
          evaluations.get(contender.id)!,
          evaluations.get(current.id)!,
        ) > 0
          ? contender
          : current,
      );
      winners = eligible.filter(
        (entrant) =>
          compareBitebluffHands(evaluations.get(entrant.id)!, evaluations.get(best.id)!) === 0,
      );
    }
    const awards: Record<string, number> = {};
    const base = Math.floor(amount / winners.length);
    let remainder = amount - base * winners.length;
    winners
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .forEach((winner) => {
        const award = base + (remainder > 0 ? 1 : 0);
        remainder = Math.max(0, remainder - 1);
        awards[winner.id] = award;
        payouts[winner.id] += award;
        if (unmatched) unmatchedReturns[winner.id] += award;
        else contestedPayouts[winner.id] += award;
      });
    layers.push({
      index,
      from: previous,
      to: threshold,
      amount,
      eligibleIds: eligible.map((entrant) => entrant.id),
      winnerIds: winners.map((entrant) => entrant.id).sort(),
      awards,
      unmatched,
    });
    previous = threshold;
  });

  return {
    totalPool: entrants.reduce((total, entrant) => total + entrant.committed, 0),
    payouts,
    contestedPayouts,
    unmatchedReturns,
    layers,
  };
}

export interface BitebluffPublicPreview {
  title: "Bitebluff";
  revealLabel: string;
  pot: number;
  participantCount: number;
  participants: Array<{ id: string; name: string; avatar: string; wager: number }>;
}

export function bitebluffPublicPreview(
  entrants: ReadonlyArray<{
    id: string;
    name: string;
    avatar: string;
    wager: number;
    redrawSurcharge?: number;
  }>,
): BitebluffPublicPreview {
  return {
    title: "Bitebluff",
    revealLabel: "Hands sealed until 11:00 PM ET",
    pot: entrants.reduce(
      (total, entrant) => total + entrant.wager + (entrant.redrawSurcharge ?? 0),
      0,
    ),
    participantCount: entrants.length,
    participants: entrants.map((entrant) => ({
      id: entrant.id,
      name: entrant.name,
      avatar: entrant.avatar,
      wager: entrant.wager + (entrant.redrawSurcharge ?? 0),
    })),
  };
}
