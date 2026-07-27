import type { BitebluffCard } from "./bitebluff-constants";
import {
  bitebluffSecretCommitment,
  createBitebluffRoundSecret,
  dealCommittedBitebluffHand,
  decryptBitebluffValue,
  encryptBitebluffValue,
  redrawCommittedBitebluffHand,
} from "./bitebluff-crypto";
import {
  bitebluffRedrawSurcharge,
  bitebluffTopUp,
  bitebluffWagerBounds,
  isBitebluffActive,
} from "./bitebluff-economy";
import { settleBitebluffLayers } from "./bitebluff-payout";
import { evaluateBitebluffHand } from "./bitebluff-poker";
import {
  BITEBLUFF_ACTIVE_DAYS,
  BITEBLUFF_REDRAW_CLOSE_MS,
  BITEBLUFF_REDRAW_MAX,
  BITEBLUFF_REDRAW_MIN,
} from "./bitebluff-constants";
import { discordAvatarUrl } from "./discord";
import {
  getBitebluffRepository,
  type BitebluffDestinationInput,
} from "./bitebluff-store";
import {
  bitebluffDate,
  bitebluffRoundWindow,
} from "./bitebluff-time";
import type {
  BitebluffDestinationRecord,
  BitebluffEnterResult,
  BitebluffEntryQuote,
  BitebluffLeaderboard,
  BitebluffPrivateState,
  BitebluffRedrawResult,
  BitebluffRoundRecord,
  BitebluffSettlementResult,
} from "./bitebluff-types";

export interface BitebluffPlayerIdentity {
  userId: string;
  discordUserId: string;
  displayName: string;
  avatarHash: string | null;
}

function newRound(date: string, now: number): BitebluffRoundRecord {
  const secret = createBitebluffRoundSecret();
  const window = bitebluffRoundWindow(date);
  return {
    id: date,
    date,
    status: "open",
    opensAt: window.opensAt,
    revealAt: window.revealAt,
    secretCommitment: bitebluffSecretCommitment(secret),
    encryptedSecret: encryptBitebluffValue(secret),
    publishedSecret: null,
    settlingStartedAt: null,
    settledAt: null,
    createdAt: now,
  };
}

export async function ensureBitebluffRound(
  now: Date = new Date(),
): Promise<BitebluffRoundRecord> {
  const date = bitebluffDate(now);
  return getBitebluffRepository().ensureRound(newRound(date, now.getTime()));
}

export async function quoteBitebluffEntry(
  userId: string,
  now: Date = new Date(),
): Promise<BitebluffEntryQuote> {
  const repository = getBitebluffRepository();
  const round = await ensureBitebluffRound(now);
  const [account, existingEntry] = await Promise.all([
    repository.getAccount(userId),
    repository.getEntry(round.id, userId),
  ]);
  const existingBalance = account?.balance ?? 0;
  const topUp =
    account?.lastTopUpDate === round.date ? 0 : bitebluffTopUp(existingBalance);
  const balance = existingBalance + topUp;
  const bounds = bitebluffWagerBounds(balance);
  return {
    round: {
      id: round.id,
      date: round.date,
      status: round.status,
      revealAt: round.revealAt,
      secretCommitment: round.secretCommitment,
    },
    balance,
    topUp,
    minimumWager: bounds.minimum,
    maximumWager: bounds.maximum,
    existingEntry,
  };
}

export async function enterBitebluff(
  identity: BitebluffPlayerIdentity,
  wager: number,
  now: Date = new Date(),
): Promise<BitebluffEnterResult> {
  const repository = getBitebluffRepository();
  const round = await ensureBitebluffRound(now);
  const existing = await repository.getEntry(round.id, identity.userId);
  if (existing) {
    const account = await repository.getAccount(identity.userId);
    if (!account) throw new Error("Bitebluff account missing for an existing entry.");
    return { entry: existing, account, created: false, topUp: 0 };
  }
  if (round.status !== "open" || now.getTime() >= round.revealAt) {
    throw new Error("Today’s Bitebluff entry window has closed.");
  }
  if (!Number.isSafeInteger(wager) || wager <= 0) {
    throw new Error("The wager must be a whole number of Bites.");
  }
  const secret = decryptBitebluffValue<string>(round.encryptedSecret);
  const hand = dealCommittedBitebluffHand(secret, identity.userId);
  const result = await repository.enter({
    roundId: round.id,
    date: round.date,
    now: now.getTime(),
    userId: identity.userId,
    discordUserId: identity.discordUserId,
    displayName: identity.displayName.slice(0, 80),
    avatarHash: identity.avatarHash,
    wager,
    encryptedHand: encryptBitebluffValue(hand),
  });
  if (!result) {
    const quote = await quoteBitebluffEntry(identity.userId, now);
    if (quote.existingEntry) {
      const account = await repository.getAccount(identity.userId);
      if (!account) throw new Error("Bitebluff account missing for an existing entry.");
      return { entry: quote.existingEntry, account, created: false, topUp: 0 };
    }
    if (now.getTime() >= quote.round.revealAt || quote.round.status !== "open") {
      throw new Error("Today’s Bitebluff entry window has closed.");
    }
    throw new Error(
      `Wager must be between ${quote.minimumWager} and ${quote.maximumWager} Bites.`,
    );
  }
  return result;
}

export async function recordBitebluffDestination(
  input: BitebluffDestinationInput,
): Promise<BitebluffDestinationRecord> {
  return getBitebluffRepository().upsertDestination(input);
}

function committedBites(entry: { wager: number; redrawSurcharge: number }): number {
  return entry.wager + entry.redrawSurcharge;
}

export async function bitebluffPrivateState(
  userId: string,
  now: Date = new Date(),
): Promise<BitebluffPrivateState> {
  await settleOverdueBitebluffRounds(now);
  const repository = getBitebluffRepository();
  const round = await ensureBitebluffRound(now);
  const [account, entry, entries] = await Promise.all([
    repository.getAccount(userId),
    repository.getEntry(round.id, userId),
    repository.entriesForRound(round.id),
  ]);
  const hand = entry
    ? entry.revealedHand ??
      decryptBitebluffValue<BitebluffCard[]>(entry.encryptedHand)
    : null;
  const redrawSurcharge = entry ? bitebluffRedrawSurcharge(entry.wager) : null;
  const redrawDeadline = round.revealAt - BITEBLUFF_REDRAW_CLOSE_MS;
  const redrawPositions =
    entry?.encryptedBurnPositions && entry.redrawCount !== null
      ? decryptBitebluffValue<number[]>(entry.encryptedBurnPositions)
      : null;
  const storedBalance = account?.balance ?? 0;
  const topUp =
    entry || account?.lastTopUpDate === round.date
      ? 0
      : bitebluffTopUp(storedBalance);
  const availableBalance = storedBalance + topUp;
  const wagerBounds = entry
    ? { minimum: 0, maximum: 0 }
    : bitebluffWagerBounds(availableBalance);
  let redrawUnavailableReason: string | null = null;
  if (entry) {
    if (entry.redrawCount !== null) {
      redrawUnavailableReason = "Burn & Draw has already been used for this hand.";
    } else if (round.status !== "open") {
      redrawUnavailableReason = "This round is no longer open.";
    } else if (now.getTime() >= redrawDeadline) {
      redrawUnavailableReason = "Burn & Draw closes five minutes before the reveal.";
    } else if (redrawSurcharge !== null && storedBalance < redrawSurcharge) {
      redrawUnavailableReason = "Your bankroll cannot cover the redraw surcharge.";
    }
  }
  return {
    round: {
      id: round.id,
      date: round.date,
      status: round.status,
      revealAt: round.revealAt,
      secretCommitment: round.secretCommitment,
      publishedSecret: round.publishedSecret,
    },
    account: {
      balance: storedBalance,
      lifetimeWagered: account?.lifetimeWagered ?? 0,
      lifetimePayout: account?.lifetimePayout ?? 0,
    },
    wager: {
      entryOpen: round.status === "open" && now.getTime() < round.revealAt,
      availableBalance,
      topUp,
      minimum: wagerBounds.minimum,
      maximum: wagerBounds.maximum,
    },
    entry:
      entry && hand
        ? {
            wager: entry.wager,
            committed: committedBites(entry),
            enteredAt: entry.enteredAt,
            hand,
            handLabel: entry.handLabel,
            payout: round.status === "settled" ? entry.payout : null,
            contestedPayout:
              round.status === "settled" ? entry.contestedPayout : null,
            unmatchedReturn:
              round.status === "settled" ? entry.unmatchedReturn : null,
            net:
              round.status === "settled"
                ? entry.payout - committedBites(entry)
                : null,
            redraw:
              entry.redrawCount !== null &&
              entry.redrawAt !== null &&
              redrawPositions
                ? {
                    count: entry.redrawCount,
                    surcharge: entry.redrawSurcharge,
                    at: entry.redrawAt,
                    positions: redrawPositions,
                  }
                : null,
          }
        : null,
    burnAndDraw: {
      available: Boolean(entry) && redrawUnavailableReason === null,
      deadline: redrawDeadline,
      surcharge: redrawSurcharge,
      unavailableReason: redrawUnavailableReason,
    },
    participants: entries.map((participant) => ({
      userId: participant.userId,
      displayName: participant.displayName,
      avatarUrl: discordAvatarUrl(
        participant.discordUserId,
        participant.avatarHash,
      ),
      wager: participant.wager,
      me: participant.userId === userId,
    })),
    pot: entries.reduce((total, participant) => total + committedBites(participant), 0),
    participantCount: entries.length,
  };
}

export async function redrawBitebluff(
  userId: string,
  count: number,
  now: Date = new Date(),
): Promise<BitebluffRedrawResult> {
  if (
    !Number.isInteger(count) ||
    count < BITEBLUFF_REDRAW_MIN ||
    count > BITEBLUFF_REDRAW_MAX
  ) {
    throw new Error("Choose 1, 2, or 3 random cards to Burn & Draw.");
  }
  const repository = getBitebluffRepository();
  const round = await ensureBitebluffRound(now);
  const [entry, account] = await Promise.all([
    repository.getEntry(round.id, userId),
    repository.getAccount(userId),
  ]);
  if (!entry || !account) {
    throw new Error("Place today’s Bitebluff wager before using Burn & Draw.");
  }
  if (entry.redrawCount !== null) {
    if (entry.redrawCount !== count) {
      throw new Error("Burn & Draw has already been used for this hand.");
    }
    return { entry, account, applied: false };
  }
  if (
    round.status !== "open" ||
    now.getTime() >= round.revealAt - BITEBLUFF_REDRAW_CLOSE_MS
  ) {
    throw new Error("Burn & Draw closes five minutes before the reveal.");
  }
  const surcharge = bitebluffRedrawSurcharge(entry.wager);
  if (account.balance < surcharge) {
    throw new Error("Your bankroll cannot cover the redraw surcharge.");
  }
  const secret = decryptBitebluffValue<string>(round.encryptedSecret);
  const originalHand = decryptBitebluffValue<BitebluffCard[]>(entry.encryptedHand);
  const redraw = redrawCommittedBitebluffHand({
    secret,
    entrantId: userId,
    hand: originalHand,
    count,
  });
  const result = await repository.redraw({
    roundId: round.id,
    userId,
    now: now.getTime(),
    count,
    surcharge,
    encryptedHand: encryptBitebluffValue(redraw.hand),
    encryptedDiscardedCards: encryptBitebluffValue(redraw.burned),
    encryptedBurnPositions: encryptBitebluffValue(redraw.positions),
  });
  if (!result) {
    throw new Error(
      "Burn & Draw could not be completed. Refresh to check the deadline and bankroll.",
    );
  }
  if (!result.applied && result.entry.redrawCount !== count) {
    throw new Error("Burn & Draw has already been used for this hand.");
  }
  return result;
}

function bitebluffDayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00.000Z`) / 86_400_000);
}

export async function bitebluffLeaderboard(
  viewerUserId: string,
  now: Date = new Date(),
): Promise<BitebluffLeaderboard> {
  const today = bitebluffDayNumber(bitebluffDate(now));
  const accounts = await getBitebluffRepository().leaderboardAccounts();
  const rows = accounts.map((account) => {
    const active =
      account.lastSettledDate !== null &&
      isBitebluffActive(
        bitebluffDayNumber(account.lastSettledDate),
        today,
      );
    return {
      ...account,
      active,
      avatarUrl: discordAvatarUrl(account.discordUserId, account.avatarHash),
    };
  });
  const active = rows
    .filter((entry) => entry.active)
    .sort(
      (a, b) =>
        b.bankroll - a.bankroll ||
        a.displayName.localeCompare(b.displayName) ||
        a.userId.localeCompare(b.userId),
    );
  let previousBankroll: number | null = null;
  let previousRank = 0;
  const ranked = active.map((entry, index) => {
    if (entry.bankroll !== previousBankroll) previousRank = index + 1;
    previousBankroll = entry.bankroll;
    return {
      userId: entry.userId,
      displayName: entry.displayName,
      avatarUrl: entry.avatarUrl,
      bankroll: entry.bankroll,
      rank: previousRank,
      active: true,
      me: entry.userId === viewerUserId,
    };
  });
  const inactive = rows
    .filter((entry) => !entry.active)
    .sort(
      (a, b) =>
        b.bankroll - a.bankroll ||
        a.displayName.localeCompare(b.displayName) ||
        a.userId.localeCompare(b.userId),
    )
    .map((entry) => ({
      userId: entry.userId,
      displayName: entry.displayName,
      avatarUrl: entry.avatarUrl,
      bankroll: entry.bankroll,
      rank: null,
      active: false,
      me: entry.userId === viewerUserId,
    }));
  return {
    title: "Active bankroll",
    activeWindowDays: BITEBLUFF_ACTIVE_DAYS,
    entries: [...ranked, ...inactive],
  };
}

export async function settleBitebluffRound(
  roundId: string,
  now: Date = new Date(),
): Promise<BitebluffSettlementResult | null> {
  const repository = getBitebluffRepository();
  const before = await repository.getRound(roundId);
  if (!before) return null;
  if (before.status === "settled") {
    return {
      round: before,
      entries: await repository.entriesForRound(roundId),
      alreadySettled: true,
    };
  }
  const claimed = await repository.claimRound(roundId, now.getTime());
  if (!claimed) return null;
  const secret = decryptBitebluffValue<string>(claimed.encryptedSecret);
  if (bitebluffSecretCommitment(secret) !== claimed.secretCommitment) {
    throw new Error(`Bitebluff round ${roundId} failed its secret commitment check.`);
  }
  const entries = await repository.entriesForRound(roundId);
  const hands = new Map(
    entries.map((entry) => [
      entry.id,
      decryptBitebluffValue<BitebluffCard[]>(entry.encryptedHand),
    ]),
  );
  const settlement = settleBitebluffLayers(
    entries.map((entry) => ({
      id: entry.id,
      committed: committedBites(entry),
      hand: hands.get(entry.id)!,
    })),
  );
  const settledEntries = entries.map((entry) => {
    const hand = hands.get(entry.id)!;
    const evaluation = evaluateBitebluffHand(hand);
    return {
      ...entry,
      revealedHand: hand,
      handCategory: evaluation.category,
      handLabel: evaluation.label,
      handComparison: [...evaluation.comparison],
      wonLayers: settlement.layers
        .filter(
          (layer) =>
            !layer.unmatched && layer.winnerIds.includes(entry.id),
        )
        .map((layer) => layer.index),
      payout: settlement.payouts[entry.id] ?? 0,
      contestedPayout: settlement.contestedPayouts[entry.id] ?? 0,
      unmatchedReturn: settlement.unmatchedReturns[entry.id] ?? 0,
      settlementApplied: true,
      settledAt: now.getTime(),
    };
  });
  const round = await repository.completeSettlement(
    roundId,
    secret,
    settledEntries.map((entry) => ({ entry })),
    now.getTime(),
  );
  return { round, entries: settledEntries, alreadySettled: false };
}

export async function settleOverdueBitebluffRounds(
  now: Date = new Date(),
): Promise<BitebluffSettlementResult[]> {
  const repository = getBitebluffRepository();
  const overdue = await repository.overdueRounds(now.getTime());
  const results: BitebluffSettlementResult[] = [];
  for (const round of overdue) {
    const result = await settleBitebluffRound(round.id, now);
    if (result) results.push(result);
  }
  return results;
}
