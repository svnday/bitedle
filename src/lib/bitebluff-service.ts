import type { BitebluffCard } from "./bitebluff-constants";
import {
  bitebluffSecretCommitment,
  createBitebluffRoundSecret,
  dealCommittedBitebluffHand,
  decryptBitebluffValue,
  encryptBitebluffValue,
} from "./bitebluff-crypto";
import { bitebluffTopUp, bitebluffWagerBounds } from "./bitebluff-economy";
import { settleBitebluffLayers } from "./bitebluff-payout";
import { evaluateBitebluffHand } from "./bitebluff-poker";
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
  BitebluffPrivateState,
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
  const storedBalance = account?.balance ?? 0;
  const topUp =
    entry || account?.lastTopUpDate === round.date
      ? 0
      : bitebluffTopUp(storedBalance);
  const availableBalance = storedBalance + topUp;
  const wagerBounds = entry
    ? { minimum: 0, maximum: 0 }
    : bitebluffWagerBounds(availableBalance);
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
            enteredAt: entry.enteredAt,
            hand,
            handLabel: entry.handLabel,
            payout: round.status === "settled" ? entry.payout : null,
            contestedPayout:
              round.status === "settled" ? entry.contestedPayout : null,
            unmatchedReturn:
              round.status === "settled" ? entry.unmatchedReturn : null,
            net: round.status === "settled" ? entry.payout - entry.wager : null,
          }
        : null,
    pot: entries.reduce((total, participant) => total + participant.wager, 0),
    participantCount: entries.length,
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
      committed: entry.wager,
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
