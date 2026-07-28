import type { BitebluffCard } from "./bitebluff-constants";
import {
  normalizeBitebluffBurnPositions,
  normalizeBitebluffRedrawCount,
} from "./bitebluff-cards";
import {
  bitebluffSecretCommitment,
  createBitebluffRoundSecret,
  dealCommittedBitebluffHand,
  decryptBitebluffValue,
  encryptBitebluffValue,
  redrawCommittedBitebluffHand,
  redrawRandomCommittedBitebluffHand,
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
  bitebluffEntryIsWinner,
  sortBitebluffFinalEntries,
} from "./bitebluff-results";
import {
  BITEBLUFF_ACTIVE_DAYS,
  BITEBLUFF_REDRAW_CLOSE_MS,
} from "./bitebluff-constants";
import { discordAvatarUrl, SNOWFLAKE_RE } from "./discord";
import {
  getBitebluffRepository,
  type BitebluffDestinationInput,
  type BitebluffRepository,
} from "./bitebluff-store";
import {
  bitebluffDate,
  bitebluffPreviousDate,
  bitebluffRedrawMode,
  bitebluffRoundWindow,
  bitebluffUsesGuildRounds,
  BITEBLUFF_LEGACY_ARCHIVE_VISIBLE_DATE,
} from "./bitebluff-time";
import type {
  BitebluffDestinationRecord,
  BitebluffEntryRecord,
  BitebluffEnterResult,
  BitebluffEntryQuote,
  BitebluffLeaderboard,
  BitebluffPrivateState,
  BitebluffRedrawRequest,
  BitebluffRedrawResult,
  BitebluffResultBoard,
  BitebluffRoundRecord,
  BitebluffSettledParticipant,
  BitebluffSettlementResult,
} from "./bitebluff-types";

export interface BitebluffPlayerIdentity {
  userId: string;
  discordUserId: string;
  displayName: string;
  avatarHash: string | null;
}

function bitebluffRoundGuildId(
  date: string,
  guildId: string | null,
): string | null {
  if (!bitebluffUsesGuildRounds(date)) return null;
  if (!guildId || !SNOWFLAKE_RE.test(guildId)) {
    throw new Error("Bitebluff requires a valid Discord server context.");
  }
  return guildId;
}

function newRound(
  date: string,
  guildId: string | null,
  now: number,
): BitebluffRoundRecord {
  const secret = createBitebluffRoundSecret();
  const window = bitebluffRoundWindow(date);
  const scopedGuildId = bitebluffRoundGuildId(date, guildId);
  return {
    id:
      scopedGuildId === null
        ? date
        : `${date}:guild:${scopedGuildId}`,
    date,
    guildId: scopedGuildId,
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
  guildId: string | null,
  now: Date = new Date(),
): Promise<BitebluffRoundRecord> {
  const date = bitebluffDate(now);
  return getBitebluffRepository().ensureRound(
    newRound(date, guildId, now.getTime()),
  );
}

export async function quoteBitebluffEntry(
  userId: string,
  guildId: string,
  now: Date = new Date(),
): Promise<BitebluffEntryQuote> {
  const repository = getBitebluffRepository();
  const round = await ensureBitebluffRound(guildId, now);
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
  guildId: string,
  now: Date = new Date(),
): Promise<BitebluffEnterResult> {
  const repository = getBitebluffRepository();
  const round = await ensureBitebluffRound(guildId, now);
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
    const quote = await quoteBitebluffEntry(identity.userId, guildId, now);
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
  const repository = getBitebluffRepository();
  const round = await repository.getRound(input.roundId);
  if (!round) throw new Error("Bitebluff round not found for this destination.");
  if (round.guildId !== null && round.guildId !== input.guildId) {
    throw new Error("Bitebluff destination does not match the round’s Discord server.");
  }
  return repository.upsertDestination(input);
}

function committedBites(entry: { wager: number; redrawSurcharge: number }): number {
  return entry.wager + entry.redrawSurcharge;
}

function settledParticipantResults(
  entries: readonly BitebluffEntryRecord[],
  userId: string,
): BitebluffSettledParticipant[] {
  return sortBitebluffFinalEntries(entries)
    .filter(
      (
        participant,
      ): participant is BitebluffEntryRecord & {
        revealedHand: BitebluffCard[];
      } => participant.revealedHand !== null,
    )
    .map((participant, index) => ({
      rank: index + 1,
      userId: participant.userId,
      displayName: participant.displayName,
      avatarUrl: discordAvatarUrl(
        participant.discordUserId,
        participant.avatarHash,
      ),
      me: participant.userId === userId,
      hand: participant.revealedHand,
      handLabel:
        participant.handLabel ??
        evaluateBitebluffHand(participant.revealedHand).label,
      wager: participant.wager,
      committed: committedBites(participant),
      payout: participant.payout,
      contestedPayout: participant.contestedPayout,
      unmatchedReturn: participant.unmatchedReturn,
      net: participant.payout - committedBites(participant),
      wonLayers: [...participant.wonLayers],
      winner: bitebluffEntryIsWinner(participant),
    }));
}

async function yesterdayBitebluffResults(
  repository: BitebluffRepository,
  userId: string,
  guildId: string,
  currentDate: string,
): Promise<{
  date: string;
  results: BitebluffResultBoard | null;
  unavailableReason:
    | "legacy-global-round"
    | "no-settled-round"
    | null;
}> {
  const date = bitebluffPreviousDate(currentDate);
  const guildScoped = bitebluffUsesGuildRounds(date);
  if (
    !guildScoped &&
    currentDate !== BITEBLUFF_LEGACY_ARCHIVE_VISIBLE_DATE
  ) {
    return {
      date,
      results: null,
      unavailableReason: "legacy-global-round",
    };
  }
  const round = await repository.getRound(
    guildScoped ? `${date}:guild:${guildId}` : date,
  );
  if (
    !round ||
    round.status !== "settled" ||
    (guildScoped && round.guildId !== guildId)
  ) {
    return {
      date,
      results: null,
      unavailableReason: "no-settled-round",
    };
  }
  const entries = await repository.entriesForRound(round.id);
  return {
    date,
    results: {
      date: round.date,
      totalPool: entries.reduce(
        (total, participant) => total + committedBites(participant),
        0,
      ),
      results: settledParticipantResults(entries, userId),
    },
    unavailableReason: null,
  };
}

function sameBurnPositions(
  first: readonly number[],
  second: readonly number[],
): boolean {
  return (
    first.length === second.length &&
    first.every((position, index) => position === second[index])
  );
}

export async function bitebluffPrivateState(
  userId: string,
  guildId: string,
  now: Date = new Date(),
): Promise<BitebluffPrivateState> {
  await settleOverdueBitebluffRounds(now);
  const repository = getBitebluffRepository();
  const round = await ensureBitebluffRound(guildId, now);
  const [account, entry, entries, yesterdayArchive] = await Promise.all([
    repository.getAccount(userId),
    repository.getEntry(round.id, userId),
    repository.entriesForRound(round.id),
    yesterdayBitebluffResults(repository, userId, guildId, round.date),
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
      guildId: round.guildId,
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
    results:
      round.status === "settled"
        ? settledParticipantResults(entries, userId)
        : null,
    yesterdayResults: yesterdayArchive.results,
    yesterdayResultsDate: yesterdayArchive.date,
    yesterdayResultsUnavailableReason: yesterdayArchive.unavailableReason,
    burnAndDraw: {
      mode: bitebluffRedrawMode(round.date),
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
  guildId: string,
  request: BitebluffRedrawRequest,
  now: Date = new Date(),
): Promise<BitebluffRedrawResult> {
  const repository = getBitebluffRepository();
  const round = await ensureBitebluffRound(guildId, now);
  const redrawMode = bitebluffRedrawMode(round.date);
  let requestedPositions: number[] | null = null;
  let count: number;
  if (redrawMode === "selected-cards") {
    if (!("positions" in request)) {
      throw new Error(
        "Choose 1, 2, or 3 different cards from your hand to Burn & Draw.",
      );
    }
    requestedPositions = normalizeBitebluffBurnPositions(request.positions);
    count = requestedPositions.length;
  } else {
    if (!("count" in request)) {
      throw new Error("Choose 1, 2, or 3 random cards to Burn & Draw.");
    }
    count = normalizeBitebluffRedrawCount(request.count);
  }
  const [entry, account] = await Promise.all([
    repository.getEntry(round.id, userId),
    repository.getAccount(userId),
  ]);
  if (!entry || !account) {
    throw new Error("Place today’s Bitebluff wager before using Burn & Draw.");
  }
  if (entry.redrawCount !== null) {
    const storedPositions = entry.encryptedBurnPositions
      ? decryptBitebluffValue<number[]>(entry.encryptedBurnPositions)
      : [];
    if (
      entry.redrawCount !== count ||
      (requestedPositions !== null &&
        !sameBurnPositions(storedPositions, requestedPositions))
    ) {
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
  const redraw =
    requestedPositions === null
      ? redrawRandomCommittedBitebluffHand({
          secret,
          entrantId: userId,
          hand: originalHand,
          count,
        })
      : redrawCommittedBitebluffHand({
          secret,
          entrantId: userId,
          hand: originalHand,
          positions: requestedPositions,
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
  if (!result.applied) {
    const resultPositions = result.entry.encryptedBurnPositions
      ? decryptBitebluffValue<number[]>(result.entry.encryptedBurnPositions)
      : [];
    if (
      result.entry.redrawCount !== count ||
      (requestedPositions !== null &&
        !sameBurnPositions(resultPositions, requestedPositions))
    ) {
      throw new Error("Burn & Draw has already been used for this hand.");
    }
  }
  return result;
}

function bitebluffDayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00.000Z`) / 86_400_000);
}

export async function bitebluffLeaderboard(
  viewerUserId: string,
  guildId: string,
  now: Date = new Date(),
): Promise<BitebluffLeaderboard> {
  const date = bitebluffDate(now);
  const today = bitebluffDayNumber(date);
  const leaderboardGuildId = bitebluffUsesGuildRounds(date) ? guildId : null;
  const accounts = await getBitebluffRepository().leaderboardAccounts(
    leaderboardGuildId,
  );
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
