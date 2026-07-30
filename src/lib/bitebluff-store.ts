import fs from "node:fs";
import path from "node:path";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type {
  BitebluffAccountRecord,
  BitebluffDestinationRecord,
  BitebluffEnterInput,
  BitebluffEnterResult,
  BitebluffEntryRecord,
  BitebluffLeaderboardAccount,
  BitebluffPreviewEntry,
  BitebluffRedrawInput,
  BitebluffRedrawResult,
  BitebluffRoundRecord,
} from "./bitebluff-types";

export interface BitebluffSettlementWrite {
  entry: BitebluffEntryRecord;
}

export interface BitebluffDestinationInput {
  roundId: string;
  guildId: string;
  channelId: string;
  applicationId: string;
  webhookToken: string;
  tokenCreatedAt: number;
  now: number;
}

export interface BitebluffRepository {
  ensureRound(candidate: BitebluffRoundRecord): Promise<BitebluffRoundRecord>;
  getRound(roundId: string): Promise<BitebluffRoundRecord | null>;
  overdueRounds(now: number): Promise<BitebluffRoundRecord[]>;
  getAccount(userId: string): Promise<BitebluffAccountRecord | null>;
  getEntry(roundId: string, userId: string): Promise<BitebluffEntryRecord | null>;
  entriesForRound(roundId: string): Promise<BitebluffEntryRecord[]>;
  previewEntriesForRound(roundId: string): Promise<BitebluffPreviewEntry[]>;
  totalCommittedForRound(roundId: string): Promise<number>;
  leaderboardAccounts(guildId: string | null): Promise<BitebluffLeaderboardAccount[]>;
  enter(input: BitebluffEnterInput): Promise<BitebluffEnterResult | null>;
  redraw(input: BitebluffRedrawInput): Promise<BitebluffRedrawResult | null>;
  upsertDestination(input: BitebluffDestinationInput): Promise<BitebluffDestinationRecord>;
  getDestination(destinationId: string): Promise<BitebluffDestinationRecord | null>;
  destinationsForRound(roundId: string): Promise<BitebluffDestinationRecord[]>;
  roundsNeedingFinalDelivery(): Promise<string[]>;
  claimPendingFinalDeliveryForGuild(
    guildId: string,
    now: number,
  ): Promise<BitebluffDestinationRecord[]>;
  claimPreview(destinationId: string): Promise<boolean>;
  completePreview(destinationId: string, messageId: string, now: number): Promise<void>;
  releasePreview(destinationId: string): Promise<void>;
  claimRound(roundId: string, now: number): Promise<BitebluffRoundRecord | null>;
  completeSettlement(
    roundId: string,
    publishedSecret: string,
    writes: BitebluffSettlementWrite[],
    now: number,
  ): Promise<BitebluffRoundRecord>;
  claimFinalDelivery(destinationId: string): Promise<boolean>;
  recordFinalPage(destinationId: string, messageId: string, now: number): Promise<void>;
  completeFinalDelivery(
    destinationId: string,
    messageIds: string[],
    now: number,
  ): Promise<void>;
  releaseFinalDelivery(destinationId: string): Promise<void>;
}

interface BitebluffFileDb {
  accounts: Record<string, BitebluffAccountRecord>;
  rounds: Record<string, BitebluffRoundRecord>;
  entries: Record<string, BitebluffEntryRecord>;
  destinations: Record<string, BitebluffDestinationRecord>;
  ledger: Record<string, { id: string; userId: string; roundId: string; kind: string; amount: number; at: number }>;
}

const EMPTY_FILE_DB: BitebluffFileDb = {
  accounts: {},
  rounds: {},
  entries: {},
  destinations: {},
  ledger: {},
};

function cloneEmptyFileDb(): BitebluffFileDb {
  return JSON.parse(JSON.stringify(EMPTY_FILE_DB)) as BitebluffFileDb;
}

function entryKey(roundId: string, userId: string): string {
  return `${roundId}:${userId}`;
}

function destinationKey(roundId: string, guildId: string, channelId: string): string {
  return `${roundId}:${guildId}:${channelId}`;
}

class BitebluffFileRepository implements BitebluffRepository {
  private readonly filePath: string;
  private db: BitebluffFileDb;

  constructor() {
    this.filePath =
      process.env.BITEBLUFF_FILE_DB_PATH ||
      path.join(process.cwd(), "data", "bitebluff-db.json");
    this.db = this.load();
  }

  private load(): BitebluffFileDb {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<BitebluffFileDb>;
      const entries = Object.fromEntries(
        Object.entries(parsed.entries ?? {}).map(([key, entry]) => [
          key,
          {
            ...entry,
            redrawSurcharge: entry.redrawSurcharge ?? 0,
            encryptedDiscardedCards: entry.encryptedDiscardedCards ?? null,
            encryptedBurnPositions: entry.encryptedBurnPositions ?? null,
            redrawCount: entry.redrawCount ?? null,
            redrawAt: entry.redrawAt ?? null,
          },
        ]),
      );
      const destinations = Object.fromEntries(
        Object.entries(parsed.destinations ?? {}).map(([key, destination]) => [
          key,
          {
            ...destination,
            previewMessageCreatedAt:
              destination.previewMessageCreatedAt ?? null,
          },
        ]),
      );
      const rounds = Object.fromEntries(
        Object.entries(parsed.rounds ?? {}).map(([key, round]) => [
          key,
          {
            ...round,
            guildId: round.guildId ?? null,
          },
        ]),
      );
      return {
        accounts: parsed.accounts ?? {},
        rounds,
        entries,
        destinations,
        ledger: parsed.ledger ?? {},
      };
    } catch {
      return cloneEmptyFileDb();
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.db, null, 2));
    fs.renameSync(temporary, this.filePath);
  }

  async ensureRound(candidate: BitebluffRoundRecord): Promise<BitebluffRoundRecord> {
    const existing = this.db.rounds[candidate.id];
    if (existing) return structuredClone(existing);
    this.db.rounds[candidate.id] = structuredClone(candidate);
    this.persist();
    return structuredClone(candidate);
  }

  async getRound(roundId: string): Promise<BitebluffRoundRecord | null> {
    return this.db.rounds[roundId] ? structuredClone(this.db.rounds[roundId]) : null;
  }

  async overdueRounds(now: number): Promise<BitebluffRoundRecord[]> {
    return Object.values(this.db.rounds)
      .filter(
        (round) =>
          round.revealAt <= now &&
          (round.status === "open" ||
            (round.status === "settling" &&
              (round.settlingStartedAt ?? 0) <= now - 5 * 60_000)),
      )
      .sort((a, b) => a.revealAt - b.revealAt)
      .map((round) => structuredClone(round));
  }

  async getAccount(userId: string): Promise<BitebluffAccountRecord | null> {
    return this.db.accounts[userId] ? structuredClone(this.db.accounts[userId]) : null;
  }

  async getEntry(roundId: string, userId: string): Promise<BitebluffEntryRecord | null> {
    const entry = this.db.entries[entryKey(roundId, userId)];
    return entry ? structuredClone(entry) : null;
  }

  async entriesForRound(roundId: string): Promise<BitebluffEntryRecord[]> {
    return Object.values(this.db.entries)
      .filter((entry) => entry.roundId === roundId)
      .sort((a, b) => a.enteredAt - b.enteredAt || a.id.localeCompare(b.id))
      .map((entry) => structuredClone(entry));
  }

  async previewEntriesForRound(roundId: string): Promise<BitebluffPreviewEntry[]> {
    return Object.values(this.db.entries)
      .filter((entry) => entry.roundId === roundId)
      .sort((a, b) => a.enteredAt - b.enteredAt || a.id.localeCompare(b.id))
      .map((entry) => ({
        id: entry.id,
        roundId: entry.roundId,
        userId: entry.userId,
        discordUserId: entry.discordUserId,
        displayName: entry.displayName,
        avatarHash: entry.avatarHash,
        wager: entry.wager,
        enteredAt: entry.enteredAt,
      }));
  }

  async totalCommittedForRound(roundId: string): Promise<number> {
    return Object.values(this.db.entries)
      .filter((entry) => entry.roundId === roundId)
      .reduce(
        (total, entry) => total + entry.wager + (entry.redrawSurcharge ?? 0),
        0,
      );
  }

  async leaderboardAccounts(
    guildId: string | null,
  ): Promise<BitebluffLeaderboardAccount[]> {
    return Object.values(this.db.accounts)
      .filter(
        (account) =>
          guildId === null ||
          Object.values(this.db.entries).some(
            (entry) =>
              entry.userId === account.userId &&
              this.db.rounds[entry.roundId]?.guildId === guildId,
          ),
      )
      .map((account) => {
        const guildEntries = Object.values(this.db.entries)
          .filter(
            (entry) =>
              entry.userId === account.userId &&
              (guildId === null ||
                this.db.rounds[entry.roundId]?.guildId === guildId),
          )
          .sort(
            (a, b) =>
              b.enteredAt - a.enteredAt || b.id.localeCompare(a.id),
          );
        const latest = guildEntries[0];
        const pendingCommitment = Object.values(this.db.entries)
          .filter((entry) => entry.userId === account.userId)
          .filter(
            (entry) => this.db.rounds[entry.roundId]?.status !== "settled",
          )
          .reduce(
            (total, entry) =>
              total + entry.wager + (entry.redrawSurcharge ?? 0),
            0,
          );
        return {
          userId: account.userId,
          displayName: latest?.displayName ?? "Bitebluff player",
          discordUserId: latest?.discordUserId ?? "",
          avatarHash: latest?.avatarHash ?? null,
          bankroll: account.balance + pendingCommitment,
          lastSettledDate: account.lastSettledDate,
        };
      });
  }

  async enter(input: BitebluffEnterInput): Promise<BitebluffEnterResult | null> {
    const round = this.db.rounds[input.roundId];
    if (!round || round.status !== "open" || input.now >= round.revealAt) return null;
    const key = entryKey(input.roundId, input.userId);
    const existing = this.db.entries[key];
    if (existing) {
      const account = this.db.accounts[input.userId];
      if (!account) throw new Error("Bitebluff account missing for an existing entry.");
      return { entry: structuredClone(existing), account: structuredClone(account), created: false, topUp: 0 };
    }

    const account = this.db.accounts[input.userId] ?? {
      userId: input.userId,
      balance: 0,
      lastTopUpDate: null,
      lifetimeWagered: 0,
      lifetimePayout: 0,
      lastSettledDate: null,
      updatedAt: input.now,
    };
    const topUp =
      account.lastTopUpDate === input.date ? 0 : Math.max(0, 100 - account.balance);
    if (account.lastTopUpDate !== input.date) {
      account.balance += topUp;
      account.lastTopUpDate = input.date;
      if (topUp > 0) {
        this.db.ledger[`topup:${input.date}:${input.userId}`] = {
          id: `topup:${input.date}:${input.userId}`,
          userId: input.userId,
          roundId: input.roundId,
          kind: "daily_top_up",
          amount: topUp,
          at: input.now,
        };
      }
    }
    const minimum = Math.max(10, Math.ceil(account.balance * 0.05));
    const reserve = Math.max(10, Math.ceil(input.wager * 0.5));
    if (
      !Number.isInteger(input.wager) ||
      input.wager < minimum ||
      input.wager + reserve > account.balance
    ) {
      this.db.accounts[input.userId] = account;
      this.persist();
      return null;
    }
    account.balance -= input.wager;
    account.lifetimeWagered += input.wager;
    account.updatedAt = input.now;
    const entry: BitebluffEntryRecord = {
      id: crypto.randomUUID(),
      roundId: input.roundId,
      userId: input.userId,
      discordUserId: input.discordUserId,
      displayName: input.displayName,
      avatarHash: input.avatarHash,
      wager: input.wager,
      redrawSurcharge: 0,
      encryptedDiscardedCards: null,
      encryptedBurnPositions: null,
      redrawCount: null,
      redrawAt: null,
      encryptedHand: input.encryptedHand,
      revealedHand: null,
      handCategory: null,
      handLabel: null,
      handComparison: null,
      wonLayers: [],
      payout: 0,
      contestedPayout: 0,
      unmatchedReturn: 0,
      settlementApplied: false,
      enteredAt: input.now,
      settledAt: null,
    };
    this.db.accounts[input.userId] = account;
    this.db.entries[key] = entry;
    this.db.ledger[`wager:${input.roundId}:${input.userId}`] = {
      id: `wager:${input.roundId}:${input.userId}`,
      userId: input.userId,
      roundId: input.roundId,
      kind: "wager",
      amount: -input.wager,
      at: input.now,
    };
    this.persist();
    return { entry: structuredClone(entry), account: structuredClone(account), created: true, topUp };
  }

  async redraw(input: BitebluffRedrawInput): Promise<BitebluffRedrawResult | null> {
    const round = this.db.rounds[input.roundId];
    const key = entryKey(input.roundId, input.userId);
    const entry = this.db.entries[key];
    const account = this.db.accounts[input.userId];
    if (!round || !entry || !account) return null;
    if (entry.redrawCount !== null) {
      return {
        entry: structuredClone(entry),
        account: structuredClone(account),
        applied: false,
      };
    }
    if (
      round.status !== "open" ||
      input.now >= round.revealAt - 5 * 60_000 ||
      account.balance < input.surcharge
    ) {
      return null;
    }
    account.balance -= input.surcharge;
    account.lifetimeWagered += input.surcharge;
    account.updatedAt = input.now;
    entry.redrawSurcharge = input.surcharge;
    entry.encryptedDiscardedCards = input.encryptedDiscardedCards;
    entry.encryptedBurnPositions = input.encryptedBurnPositions;
    entry.redrawCount = input.count;
    entry.redrawAt = input.now;
    entry.encryptedHand = input.encryptedHand;
    this.db.ledger[`redraw:${input.roundId}:${input.userId}`] = {
      id: `redraw:${input.roundId}:${input.userId}`,
      userId: input.userId,
      roundId: input.roundId,
      kind: "redraw_surcharge",
      amount: -input.surcharge,
      at: input.now,
    };
    this.persist();
    return {
      entry: structuredClone(entry),
      account: structuredClone(account),
      applied: true,
    };
  }

  async upsertDestination(input: BitebluffDestinationInput): Promise<BitebluffDestinationRecord> {
    const key = destinationKey(input.roundId, input.guildId, input.channelId);
    const previous = this.db.destinations[key];
    const destination: BitebluffDestinationRecord = {
      id: previous?.id ?? crypto.randomUUID(),
      roundId: input.roundId,
      guildId: input.guildId,
      channelId: input.channelId,
      applicationId: input.applicationId || previous?.applicationId || "",
      webhookToken: input.webhookToken || previous?.webhookToken || "",
      tokenCreatedAt:
        input.webhookToken || !previous
          ? input.tokenCreatedAt
          : previous.tokenCreatedAt,
      previewMessageId: previous?.previewMessageId ?? null,
      previewMessageCreatedAt: previous?.previewMessageCreatedAt ?? null,
      previewPosting: previous?.previewPosting ?? false,
      finalMessageIds: previous?.finalMessageIds ?? [],
      finalPostedAt: previous?.finalPostedAt ?? null,
      updatedAt: input.now,
    };
    this.db.destinations[key] = destination;
    this.persist();
    return structuredClone(destination);
  }

  async destinationsForRound(roundId: string): Promise<BitebluffDestinationRecord[]> {
    return Object.values(this.db.destinations)
      .filter((destination) => destination.roundId === roundId)
      .map((destination) => structuredClone(destination));
  }

  async getDestination(destinationId: string): Promise<BitebluffDestinationRecord | null> {
    const destination = Object.values(this.db.destinations).find(
      (item) => item.id === destinationId,
    );
    return destination ? structuredClone(destination) : null;
  }

  async roundsNeedingFinalDelivery(): Promise<string[]> {
    return [
      ...new Set(
        Object.values(this.db.destinations)
          .filter((destination) => {
            const round = this.db.rounds[destination.roundId];
            return round?.status === "settled" && destination.finalPostedAt === null;
          })
          .map((destination) => destination.roundId),
      ),
    ];
  }

  async claimPendingFinalDeliveryForGuild(
    guildId: string,
    now: number,
  ): Promise<BitebluffDestinationRecord[]> {
    const staleClaimAt = now - 5 * 60_000;
    const roundId = Object.values(this.db.destinations)
      .filter((destination) => {
        const round = this.db.rounds[destination.roundId];
        return (
          destination.guildId === guildId &&
          round?.status === "settled" &&
          (destination.finalPostedAt === null ||
            (destination.finalPostedAt === -1 &&
              destination.updatedAt <= staleClaimAt))
        );
      })
      .sort((first, second) => {
        const firstRound = this.db.rounds[first.roundId];
        const secondRound = this.db.rounds[second.roundId];
        return (
          firstRound.date.localeCompare(secondRound.date) ||
          first.roundId.localeCompare(second.roundId)
        );
      })[0]?.roundId;
    if (!roundId) return [];
    const claimed = Object.values(this.db.destinations).filter(
      (destination) =>
        destination.roundId === roundId &&
        destination.guildId === guildId &&
        (destination.finalPostedAt === null ||
          (destination.finalPostedAt === -1 &&
            destination.updatedAt <= staleClaimAt)),
    );
    for (const destination of claimed) {
      destination.finalPostedAt = -1;
      destination.updatedAt = now;
    }
    this.persist();
    return claimed.map((destination) => structuredClone(destination));
  }

  async claimPreview(destinationId: string): Promise<boolean> {
    const destination = Object.values(this.db.destinations).find((item) => item.id === destinationId);
    if (!destination || destination.previewPosting) return false;
    destination.previewPosting = true;
    this.persist();
    return true;
  }

  async completePreview(destinationId: string, messageId: string, now: number): Promise<void> {
    const destination = Object.values(this.db.destinations).find((item) => item.id === destinationId);
    if (!destination) return;
    if (
      destination.previewMessageId !== messageId ||
      destination.previewMessageCreatedAt === null
    ) {
      destination.previewMessageCreatedAt = now;
    }
    destination.previewMessageId = messageId;
    destination.previewPosting = false;
    destination.updatedAt = now;
    this.persist();
  }

  async releasePreview(destinationId: string): Promise<void> {
    const destination = Object.values(this.db.destinations).find((item) => item.id === destinationId);
    if (!destination) return;
    destination.previewPosting = false;
    this.persist();
  }

  async claimRound(roundId: string, now: number): Promise<BitebluffRoundRecord | null> {
    const round = this.db.rounds[roundId];
    if (
      !round ||
      round.revealAt > now ||
      (round.status !== "open" &&
        !(round.status === "settling" && (round.settlingStartedAt ?? 0) <= now - 5 * 60_000))
    ) {
      return null;
    }
    round.status = "settling";
    round.settlingStartedAt = now;
    this.persist();
    return structuredClone(round);
  }

  async completeSettlement(
    roundId: string,
    publishedSecret: string,
    writes: BitebluffSettlementWrite[],
    now: number,
  ): Promise<BitebluffRoundRecord> {
    const round = this.db.rounds[roundId];
    if (!round) throw new Error("Bitebluff round not found.");
    if (round.status === "settled") return structuredClone(round);
    for (const { entry } of writes) {
      const key = entryKey(roundId, entry.userId);
      const current = this.db.entries[key];
      if (!current || current.settlementApplied) continue;
      const account = this.db.accounts[current.userId];
      if (!account) throw new Error("Bitebluff account missing during settlement.");
      account.balance += entry.payout;
      account.lifetimePayout += entry.contestedPayout;
      account.lastSettledDate = round.date;
      account.updatedAt = now;
      this.db.entries[key] = structuredClone(entry);
      if (entry.contestedPayout > 0) {
        this.db.ledger[`payout:${roundId}:${entry.userId}`] = {
          id: `payout:${roundId}:${entry.userId}`,
          userId: entry.userId,
          roundId,
          kind: "payout",
          amount: entry.contestedPayout,
          at: now,
        };
      }
      if (entry.unmatchedReturn > 0) {
        this.db.ledger[`unmatched:${roundId}:${entry.userId}`] = {
          id: `unmatched:${roundId}:${entry.userId}`,
          userId: entry.userId,
          roundId,
          kind: "unmatched_return",
          amount: entry.unmatchedReturn,
          at: now,
        };
      }
    }
    round.status = "settled";
    round.publishedSecret = publishedSecret;
    round.settledAt = now;
    this.persist();
    return structuredClone(round);
  }

  async claimFinalDelivery(destinationId: string): Promise<boolean> {
    const destination = Object.values(this.db.destinations).find((item) => item.id === destinationId);
    if (!destination || destination.finalPostedAt !== null) return false;
    destination.finalPostedAt = -1;
    this.persist();
    return true;
  }

  async recordFinalPage(
    destinationId: string,
    messageId: string,
    now: number,
  ): Promise<void> {
    const destination = Object.values(this.db.destinations).find(
      (item) => item.id === destinationId,
    );
    if (!destination || destination.finalPostedAt !== -1) return;
    if (!destination.finalMessageIds.includes(messageId)) {
      destination.finalMessageIds.push(messageId);
    }
    destination.updatedAt = now;
    this.persist();
  }

  async completeFinalDelivery(
    destinationId: string,
    messageIds: string[],
    now: number,
  ): Promise<void> {
    const destination = Object.values(this.db.destinations).find((item) => item.id === destinationId);
    if (!destination) return;
    destination.finalMessageIds = [...messageIds];
    destination.finalPostedAt = now;
    destination.updatedAt = now;
    this.persist();
  }

  async releaseFinalDelivery(destinationId: string): Promise<void> {
    const destination = Object.values(this.db.destinations).find((item) => item.id === destinationId);
    if (!destination || destination.finalPostedAt !== -1) return;
    destination.finalPostedAt = null;
    this.persist();
  }
}

function accountFromRow(row: Record<string, unknown>): BitebluffAccountRecord {
  return {
    userId: row.user_id as string,
    balance: Number(row.balance),
    lastTopUpDate: (row.last_top_up_date as string | null) ?? null,
    lifetimeWagered: Number(row.lifetime_wagered),
    lifetimePayout: Number(row.lifetime_payout),
    lastSettledDate: (row.last_settled_date as string | null) ?? null,
    updatedAt: Number(row.updated_at),
  };
}

function roundFromRow(row: Record<string, unknown>): BitebluffRoundRecord {
  return {
    id: row.id as string,
    date: row.date as string,
    guildId: (row.guild_id as string | null) ?? null,
    status: row.status as BitebluffRoundRecord["status"],
    opensAt: Number(row.opens_at),
    revealAt: Number(row.reveal_at),
    secretCommitment: row.secret_commitment as string,
    encryptedSecret: row.encrypted_secret as string,
    publishedSecret: (row.published_secret as string | null) ?? null,
    settlingStartedAt:
      row.settling_started_at === null ? null : Number(row.settling_started_at),
    settledAt: row.settled_at === null ? null : Number(row.settled_at),
    createdAt: Number(row.created_at),
  };
}

function entryFromRow(row: Record<string, unknown>): BitebluffEntryRecord {
  return {
    id: row.id as string,
    roundId: row.round_id as string,
    userId: row.user_id as string,
    discordUserId: row.discord_user_id as string,
    displayName: row.display_name as string,
    avatarHash: (row.avatar_hash as string | null) ?? null,
    wager: Number(row.wager),
    redrawSurcharge: Number(row.redraw_surcharge ?? 0),
    encryptedDiscardedCards:
      (row.encrypted_discarded_cards as string | null) ?? null,
    encryptedBurnPositions:
      (row.encrypted_burn_positions as string | null) ?? null,
    redrawCount: row.redraw_count === null || row.redraw_count === undefined
      ? null
      : Number(row.redraw_count),
    redrawAt:
      row.redraw_at === null || row.redraw_at === undefined
        ? null
        : Number(row.redraw_at),
    encryptedHand: row.encrypted_hand as string,
    revealedHand: (row.revealed_hand as BitebluffEntryRecord["revealedHand"]) ?? null,
    handCategory: (row.hand_category as BitebluffEntryRecord["handCategory"]) ?? null,
    handLabel: (row.hand_label as string | null) ?? null,
    handComparison:
      (row.hand_comparison as BitebluffEntryRecord["handComparison"]) ?? null,
    wonLayers: (row.won_layers as number[] | null) ?? [],
    payout: Number(row.payout),
    contestedPayout: Number(row.contested_payout),
    unmatchedReturn: Number(row.unmatched_return),
    settlementApplied: Boolean(row.settlement_applied),
    enteredAt: Number(row.entered_at),
    settledAt: row.settled_at === null ? null : Number(row.settled_at),
  };
}

function destinationFromRow(row: Record<string, unknown>): BitebluffDestinationRecord {
  return {
    id: row.id as string,
    roundId: row.round_id as string,
    guildId: row.guild_id as string,
    channelId: row.channel_id as string,
    applicationId: row.application_id as string,
    webhookToken: row.webhook_token as string,
    tokenCreatedAt: Number(row.token_created_at),
    previewMessageId: (row.preview_message_id as string | null) ?? null,
    previewMessageCreatedAt:
      row.preview_message_created_at === null ||
      row.preview_message_created_at === undefined
        ? null
        : Number(row.preview_message_created_at),
    previewPosting: Boolean(row.preview_posting),
    finalMessageIds: (row.final_message_ids as string[] | null) ?? [],
    finalPostedAt: row.final_posted_at === null ? null : Number(row.final_posted_at),
    updatedAt: Number(row.updated_at),
  };
}

class BitebluffNeonRepository implements BitebluffRepository {
  private readonly sql: NeonQueryFunction<false, false>;
  private ready: Promise<void> | null = null;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  private ensureSchema(): Promise<void> {
    this.ready ??= (async () => {
      // The cron route can be the first request to touch a fresh database.
      // Create the shared identity table shape before adding FK-backed
      // Bitebluff tables; the main Store's lazy migration remains compatible.
      await this.sql`
        CREATE TABLE IF NOT EXISTS users (
          id uuid PRIMARY KEY,
          name text NOT NULL,
          named boolean NOT NULL DEFAULT false,
          created_at bigint NOT NULL
        )`;
      await this.sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_user_id text`;
      await this.sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_avatar text`;
      await this.sql`
        CREATE TABLE IF NOT EXISTS bitebluff_accounts (
          user_id uuid PRIMARY KEY REFERENCES users(id),
          balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
          last_top_up_date text,
          lifetime_wagered bigint NOT NULL DEFAULT 0,
          lifetime_payout bigint NOT NULL DEFAULT 0,
          last_settled_date text,
          updated_at bigint NOT NULL
        )`;
      await this.sql`
        CREATE TABLE IF NOT EXISTS bitebluff_rounds (
          id text PRIMARY KEY,
          date text NOT NULL,
          guild_id text,
          status text NOT NULL,
          opens_at bigint NOT NULL,
          reveal_at bigint NOT NULL,
          secret_commitment text NOT NULL,
          encrypted_secret text NOT NULL,
          published_secret text,
          settling_started_at bigint,
          settled_at bigint,
          created_at bigint NOT NULL
        )`;
      await this.sql`
        ALTER TABLE bitebluff_rounds
        ADD COLUMN IF NOT EXISTS guild_id text`;
      await this.sql`
        ALTER TABLE bitebluff_rounds
        DROP CONSTRAINT IF EXISTS bitebluff_rounds_date_key`;
      await this.sql`
        CREATE UNIQUE INDEX IF NOT EXISTS bitebluff_rounds_date_guild_idx
        ON bitebluff_rounds (date, guild_id)
        WHERE guild_id IS NOT NULL`;
      await this.sql`
        CREATE TABLE IF NOT EXISTS bitebluff_entries (
          id text PRIMARY KEY,
          round_id text NOT NULL REFERENCES bitebluff_rounds(id),
          user_id uuid NOT NULL REFERENCES users(id),
          discord_user_id text NOT NULL,
          display_name text NOT NULL,
          avatar_hash text,
          wager bigint NOT NULL CHECK (wager > 0),
          redraw_surcharge bigint NOT NULL DEFAULT 0 CHECK (redraw_surcharge >= 0),
          encrypted_discarded_cards text,
          encrypted_burn_positions text,
          redraw_count integer,
          redraw_at bigint,
          encrypted_hand text NOT NULL,
          revealed_hand jsonb,
          hand_category text,
          hand_label text,
          hand_comparison jsonb,
          won_layers jsonb NOT NULL DEFAULT '[]',
          payout bigint NOT NULL DEFAULT 0,
          contested_payout bigint NOT NULL DEFAULT 0,
          unmatched_return bigint NOT NULL DEFAULT 0,
          settlement_applied boolean NOT NULL DEFAULT false,
          entered_at bigint NOT NULL,
          settled_at bigint,
          UNIQUE (round_id, user_id)
        )`;
      await this.sql`
        ALTER TABLE bitebluff_entries
        ADD COLUMN IF NOT EXISTS won_layers jsonb NOT NULL DEFAULT '[]'`;
      await this.sql`
        ALTER TABLE bitebluff_entries
        ADD COLUMN IF NOT EXISTS redraw_surcharge bigint NOT NULL DEFAULT 0`;
      await this.sql`
        ALTER TABLE bitebluff_entries
        ADD COLUMN IF NOT EXISTS encrypted_discarded_cards text`;
      await this.sql`
        ALTER TABLE bitebluff_entries
        ADD COLUMN IF NOT EXISTS encrypted_burn_positions text`;
      await this.sql`
        ALTER TABLE bitebluff_entries
        ADD COLUMN IF NOT EXISTS redraw_count integer`;
      await this.sql`
        ALTER TABLE bitebluff_entries
        ADD COLUMN IF NOT EXISTS redraw_at bigint`;
      await this.sql`
        CREATE INDEX IF NOT EXISTS bitebluff_entries_round_idx
        ON bitebluff_entries (round_id, entered_at)`;
      await this.sql`
        CREATE TABLE IF NOT EXISTS bitebluff_ledger (
          id text PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES users(id),
          round_id text NOT NULL REFERENCES bitebluff_rounds(id),
          kind text NOT NULL,
          amount bigint NOT NULL,
          created_at bigint NOT NULL
        )`;
      await this.sql`
        CREATE TABLE IF NOT EXISTS bitebluff_destinations (
          id text PRIMARY KEY,
          round_id text NOT NULL REFERENCES bitebluff_rounds(id),
          guild_id text NOT NULL,
          channel_id text NOT NULL,
          application_id text NOT NULL,
          webhook_token text NOT NULL,
          token_created_at bigint NOT NULL,
          preview_message_id text,
          preview_message_created_at bigint,
          preview_posting boolean NOT NULL DEFAULT false,
          final_message_ids jsonb NOT NULL DEFAULT '[]',
          final_posted_at bigint,
          updated_at bigint NOT NULL,
          UNIQUE (round_id, guild_id, channel_id)
        )`;
      await this.sql`
        ALTER TABLE bitebluff_destinations
        ADD COLUMN IF NOT EXISTS preview_message_created_at bigint`;
    })();
    return this.ready;
  }

  async ensureRound(candidate: BitebluffRoundRecord): Promise<BitebluffRoundRecord> {
    await this.ensureSchema();
    const rows = await this.sql`
      INSERT INTO bitebluff_rounds (
        id, date, guild_id, status, opens_at, reveal_at, secret_commitment,
        encrypted_secret, published_secret, settling_started_at, settled_at, created_at
      ) VALUES (
        ${candidate.id}, ${candidate.date}, ${candidate.guildId}, ${candidate.status},
        ${candidate.opensAt}, ${candidate.revealAt}, ${candidate.secretCommitment},
        ${candidate.encryptedSecret}, ${candidate.publishedSecret},
        ${candidate.settlingStartedAt}, ${candidate.settledAt}, ${candidate.createdAt}
      )
      ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
      RETURNING *`;
    return roundFromRow(rows[0] as Record<string, unknown>);
  }

  async getRound(roundId: string): Promise<BitebluffRoundRecord | null> {
    await this.ensureSchema();
    const rows = await this.sql`SELECT * FROM bitebluff_rounds WHERE id = ${roundId}`;
    return rows[0] ? roundFromRow(rows[0] as Record<string, unknown>) : null;
  }

  async overdueRounds(now: number): Promise<BitebluffRoundRecord[]> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT * FROM bitebluff_rounds
      WHERE reveal_at <= ${now}
        AND (
          status = 'open'
          OR (status = 'settling' AND settling_started_at <= ${now - 5 * 60_000})
        )
      ORDER BY reveal_at`;
    return rows.map((row) => roundFromRow(row as Record<string, unknown>));
  }

  async getAccount(userId: string): Promise<BitebluffAccountRecord | null> {
    await this.ensureSchema();
    const rows = await this.sql`SELECT * FROM bitebluff_accounts WHERE user_id = ${userId}`;
    return rows[0] ? accountFromRow(rows[0] as Record<string, unknown>) : null;
  }

  async getEntry(roundId: string, userId: string): Promise<BitebluffEntryRecord | null> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT * FROM bitebluff_entries WHERE round_id = ${roundId} AND user_id = ${userId}`;
    return rows[0] ? entryFromRow(rows[0] as Record<string, unknown>) : null;
  }

  async entriesForRound(roundId: string): Promise<BitebluffEntryRecord[]> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT * FROM bitebluff_entries WHERE round_id = ${roundId}
      ORDER BY entered_at, id`;
    return rows.map((row) => entryFromRow(row as Record<string, unknown>));
  }

  async previewEntriesForRound(roundId: string): Promise<BitebluffPreviewEntry[]> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT id, round_id, user_id, discord_user_id, display_name, avatar_hash,
             wager, entered_at
      FROM bitebluff_entries
      WHERE round_id = ${roundId}
      ORDER BY entered_at, id`;
    return rows.map((row) => ({
      id: row.id as string,
      roundId: row.round_id as string,
      userId: row.user_id as string,
      discordUserId: row.discord_user_id as string,
      displayName: row.display_name as string,
      avatarHash: (row.avatar_hash as string | null) ?? null,
      wager: Number(row.wager),
      enteredAt: Number(row.entered_at),
    }));
  }

  async totalCommittedForRound(roundId: string): Promise<number> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT COALESCE(SUM(wager + redraw_surcharge), 0) AS total
      FROM bitebluff_entries
      WHERE round_id = ${roundId}`;
    return Number(rows[0]?.total ?? 0);
  }

  async leaderboardAccounts(
    guildId: string | null,
  ): Promise<BitebluffLeaderboardAccount[]> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT account.user_id,
             COALESCE(latest.display_name, 'Bitebluff player') AS display_name,
             COALESCE(latest.discord_user_id, '') AS discord_user_id,
             latest.avatar_hash,
             account.balance + COALESCE(pending.committed, 0) AS bankroll,
             account.last_settled_date
      FROM bitebluff_accounts account
      LEFT JOIN LATERAL (
        SELECT entry.display_name, entry.discord_user_id, entry.avatar_hash
        FROM bitebluff_entries entry
        JOIN bitebluff_rounds round ON round.id = entry.round_id
        WHERE entry.user_id = account.user_id
          AND (${guildId}::text IS NULL OR round.guild_id = ${guildId})
        ORDER BY entry.entered_at DESC, entry.id DESC
        LIMIT 1
      ) latest ON true
      LEFT JOIN LATERAL (
        SELECT SUM(entry.wager + entry.redraw_surcharge) AS committed
        FROM bitebluff_entries entry
        JOIN bitebluff_rounds round ON round.id = entry.round_id
        WHERE entry.user_id = account.user_id
          AND round.status <> 'settled'
      ) pending ON true
      WHERE ${guildId}::text IS NULL
         OR EXISTS (
           SELECT 1
           FROM bitebluff_entries member_entry
           JOIN bitebluff_rounds member_round
             ON member_round.id = member_entry.round_id
           WHERE member_entry.user_id = account.user_id
             AND member_round.guild_id = ${guildId}
         )
      ORDER BY bankroll DESC, display_name, account.user_id`;
    return rows.map((row) => ({
      userId: row.user_id as string,
      displayName: row.display_name as string,
      discordUserId: row.discord_user_id as string,
      avatarHash: (row.avatar_hash as string | null) ?? null,
      bankroll: Number(row.bankroll),
      lastSettledDate: (row.last_settled_date as string | null) ?? null,
    }));
  }

  async enter(input: BitebluffEnterInput): Promise<BitebluffEnterResult | null> {
    await this.ensureSchema();
    const entryId = crypto.randomUUID();
    const topUpId = `topup:${input.date}:${input.userId}`;
    const wagerId = `wager:${input.roundId}:${input.userId}`;
    const results = await this.sql.transaction([
      this.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`bitebluff-account:${input.userId}`}, 0))`,
      this.sql`
        INSERT INTO bitebluff_accounts (user_id, balance, updated_at)
        VALUES (${input.userId}, 0, ${input.now})
        ON CONFLICT (user_id) DO NOTHING`,
      this.sql`
        INSERT INTO bitebluff_ledger (id, user_id, round_id, kind, amount, created_at)
        SELECT ${topUpId}, ${input.userId}, ${input.roundId}, 'daily_top_up',
               GREATEST(0, 100 - balance), ${input.now}
        FROM bitebluff_accounts
        WHERE user_id = ${input.userId}
          AND last_top_up_date IS DISTINCT FROM ${input.date}
          AND balance < 100
        ON CONFLICT (id) DO NOTHING`,
      this.sql`
        UPDATE bitebluff_accounts
        SET balance = GREATEST(balance, 100),
            last_top_up_date = ${input.date},
            updated_at = ${input.now}
        WHERE user_id = ${input.userId}
          AND last_top_up_date IS DISTINCT FROM ${input.date}`,
      this.sql`
        INSERT INTO bitebluff_entries (
          id, round_id, user_id, discord_user_id, display_name, avatar_hash,
          wager, encrypted_hand, entered_at
        )
        SELECT ${entryId}, ${input.roundId}, ${input.userId}, ${input.discordUserId},
               ${input.displayName}, ${input.avatarHash}, ${input.wager},
               ${input.encryptedHand}, ${input.now}
        FROM bitebluff_accounts account
        JOIN bitebluff_rounds round ON round.id = ${input.roundId}
        WHERE account.user_id = ${input.userId}
          AND round.status = 'open'
          AND round.reveal_at > ${input.now}
          AND ${input.wager} >= GREATEST(10, CEIL(account.balance * 0.05))
          AND ${input.wager} + GREATEST(10, CEIL(${input.wager} * 0.5)) <= account.balance
        ON CONFLICT (round_id, user_id) DO NOTHING`,
      this.sql`
        WITH charged AS (
          INSERT INTO bitebluff_ledger (id, user_id, round_id, kind, amount, created_at)
          SELECT ${wagerId}, ${input.userId}, ${input.roundId}, 'wager', -wager, ${input.now}
          FROM bitebluff_entries WHERE id = ${entryId}
          ON CONFLICT (id) DO NOTHING
          RETURNING -amount AS wager
        )
        UPDATE bitebluff_accounts
        SET balance = balance - charged.wager,
            lifetime_wagered = lifetime_wagered + charged.wager,
            updated_at = ${input.now}
        FROM charged WHERE user_id = ${input.userId}`,
      this.sql`
        SELECT entry.*, account.balance, account.last_top_up_date,
               account.lifetime_wagered, account.lifetime_payout,
               account.last_settled_date, account.updated_at,
               (entry.id = ${entryId}) AS created,
               CASE WHEN entry.id = ${entryId}
                 THEN COALESCE((SELECT amount FROM bitebluff_ledger WHERE id = ${topUpId}), 0)
                 ELSE 0
               END AS top_up
        FROM bitebluff_entries entry
        JOIN bitebluff_accounts account ON account.user_id = entry.user_id
        WHERE entry.round_id = ${input.roundId} AND entry.user_id = ${input.userId}`,
    ]);
    const rows = results[results.length - 1];
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      entry: entryFromRow(row),
      account: accountFromRow(row),
      created: Boolean(row.created),
      topUp: Number(row.top_up),
    };
  }

  async redraw(input: BitebluffRedrawInput): Promise<BitebluffRedrawResult | null> {
    await this.ensureSchema();
    const ledgerId = `redraw:${input.roundId}:${input.userId}`;
    const results = await this.sql.transaction([
      this.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`bitebluff-account:${input.userId}`}, 0))`,
      this.sql`
        UPDATE bitebluff_entries entry
        SET redraw_surcharge = ${input.surcharge},
            encrypted_discarded_cards = ${input.encryptedDiscardedCards},
            encrypted_burn_positions = ${input.encryptedBurnPositions},
            redraw_count = ${input.count},
            redraw_at = ${input.now},
            encrypted_hand = ${input.encryptedHand}
        FROM bitebluff_rounds round, bitebluff_accounts account
        WHERE entry.round_id = ${input.roundId}
          AND entry.user_id = ${input.userId}
          AND entry.round_id = round.id
          AND entry.user_id = account.user_id
          AND entry.redraw_count IS NULL
          AND round.status = 'open'
          AND round.reveal_at > ${input.now + 5 * 60_000}
          AND account.balance >= ${input.surcharge}`,
      this.sql`
        WITH charged AS (
          INSERT INTO bitebluff_ledger (id, user_id, round_id, kind, amount, created_at)
          SELECT ${ledgerId}, ${input.userId}, ${input.roundId}, 'redraw_surcharge',
                 ${-input.surcharge}, ${input.now}
          FROM bitebluff_entries
          WHERE round_id = ${input.roundId}
            AND user_id = ${input.userId}
            AND redraw_at = ${input.now}
            AND redraw_count = ${input.count}
          ON CONFLICT (id) DO NOTHING
          RETURNING -amount AS surcharge
        )
        UPDATE bitebluff_accounts account
        SET balance = account.balance - charged.surcharge,
            lifetime_wagered = account.lifetime_wagered + charged.surcharge,
            updated_at = ${input.now}
        FROM charged
        WHERE account.user_id = ${input.userId}`,
      this.sql`
        SELECT entry.*, account.balance, account.last_top_up_date,
               account.lifetime_wagered, account.lifetime_payout,
               account.last_settled_date, account.updated_at,
               (entry.redraw_at = ${input.now}
                 AND entry.redraw_count = ${input.count}) AS applied
        FROM bitebluff_entries entry
        JOIN bitebluff_accounts account ON account.user_id = entry.user_id
        WHERE entry.round_id = ${input.roundId}
          AND entry.user_id = ${input.userId}`,
    ]);
    const rows = results[results.length - 1];
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      entry: entryFromRow(row),
      account: accountFromRow(row),
      applied: Boolean(row.applied),
    };
  }

  async upsertDestination(input: BitebluffDestinationInput): Promise<BitebluffDestinationRecord> {
    await this.ensureSchema();
    const rows = await this.sql`
      INSERT INTO bitebluff_destinations (
        id, round_id, guild_id, channel_id, application_id, webhook_token,
        token_created_at, updated_at
      ) VALUES (
        ${crypto.randomUUID()}, ${input.roundId}, ${input.guildId}, ${input.channelId},
        ${input.applicationId}, ${input.webhookToken}, ${input.tokenCreatedAt}, ${input.now}
      )
      ON CONFLICT (round_id, guild_id, channel_id) DO UPDATE
      SET application_id = CASE
            WHEN EXCLUDED.application_id <> '' THEN EXCLUDED.application_id
            ELSE bitebluff_destinations.application_id
          END,
          webhook_token = CASE
            WHEN EXCLUDED.webhook_token <> '' THEN EXCLUDED.webhook_token
            ELSE bitebluff_destinations.webhook_token
          END,
          token_created_at = CASE
            WHEN EXCLUDED.webhook_token <> '' THEN EXCLUDED.token_created_at
            ELSE bitebluff_destinations.token_created_at
          END,
          updated_at = EXCLUDED.updated_at
      RETURNING *`;
    return destinationFromRow(rows[0] as Record<string, unknown>);
  }

  async destinationsForRound(roundId: string): Promise<BitebluffDestinationRecord[]> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT * FROM bitebluff_destinations WHERE round_id = ${roundId} ORDER BY id`;
    return rows.map((row) => destinationFromRow(row as Record<string, unknown>));
  }

  async getDestination(destinationId: string): Promise<BitebluffDestinationRecord | null> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT * FROM bitebluff_destinations WHERE id = ${destinationId}`;
    return rows[0]
      ? destinationFromRow(rows[0] as Record<string, unknown>)
      : null;
  }

  async roundsNeedingFinalDelivery(): Promise<string[]> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT DISTINCT destination.round_id
      FROM bitebluff_destinations destination
      JOIN bitebluff_rounds round ON round.id = destination.round_id
      WHERE round.status = 'settled' AND destination.final_posted_at IS NULL
      ORDER BY destination.round_id`;
    return rows.map((row) => row.round_id as string);
  }

  async claimPendingFinalDeliveryForGuild(
    guildId: string,
    now: number,
  ): Promise<BitebluffDestinationRecord[]> {
    await this.ensureSchema();
    const rows = await this.sql`
      WITH candidate AS (
        SELECT destination.round_id
        FROM bitebluff_destinations destination
        JOIN bitebluff_rounds round ON round.id = destination.round_id
        WHERE destination.guild_id = ${guildId}
          AND round.status = 'settled'
          AND (
            destination.final_posted_at IS NULL
            OR (
              destination.final_posted_at = -1
              AND destination.updated_at <= ${now - 5 * 60_000}
            )
          )
        ORDER BY round.date, destination.round_id
        LIMIT 1
      )
      UPDATE bitebluff_destinations destination
      SET final_posted_at = -1, updated_at = ${now}
      WHERE destination.round_id = (SELECT round_id FROM candidate)
        AND destination.guild_id = ${guildId}
        AND (
          destination.final_posted_at IS NULL
          OR (
            destination.final_posted_at = -1
            AND destination.updated_at <= ${now - 5 * 60_000}
          )
        )
      RETURNING destination.*`;
    return rows.map((row) => destinationFromRow(row as Record<string, unknown>));
  }

  async claimPreview(destinationId: string): Promise<boolean> {
    await this.ensureSchema();
    const rows = await this.sql`
      UPDATE bitebluff_destinations SET preview_posting = true
      WHERE id = ${destinationId} AND preview_posting = false
      RETURNING id`;
    return rows.length > 0;
  }

  async completePreview(destinationId: string, messageId: string, now: number): Promise<void> {
    await this.ensureSchema();
    await this.sql`
      UPDATE bitebluff_destinations
      SET preview_message_created_at = CASE
            WHEN preview_message_id IS DISTINCT FROM ${messageId}
              THEN ${now}
            ELSE COALESCE(preview_message_created_at, ${now})
          END,
          preview_message_id = ${messageId},
          preview_posting = false,
          updated_at = ${now}
      WHERE id = ${destinationId}`;
  }

  async releasePreview(destinationId: string): Promise<void> {
    await this.ensureSchema();
    await this.sql`
      UPDATE bitebluff_destinations SET preview_posting = false WHERE id = ${destinationId}`;
  }

  async claimRound(roundId: string, now: number): Promise<BitebluffRoundRecord | null> {
    await this.ensureSchema();
    const rows = await this.sql`
      UPDATE bitebluff_rounds
      SET status = 'settling', settling_started_at = ${now}
      WHERE id = ${roundId}
        AND reveal_at <= ${now}
        AND (
          status = 'open'
          OR (status = 'settling' AND settling_started_at <= ${now - 5 * 60_000})
        )
      RETURNING *`;
    return rows[0] ? roundFromRow(rows[0] as Record<string, unknown>) : null;
  }

  async completeSettlement(
    roundId: string,
    publishedSecret: string,
    writes: BitebluffSettlementWrite[],
    now: number,
  ): Promise<BitebluffRoundRecord> {
    await this.ensureSchema();
    const queries = [
      this.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`bitebluff-settle:${roundId}`}, 0))`,
      ...writes.map(({ entry }) => this.sql`
        WITH applied AS (
          UPDATE bitebluff_entries
          SET revealed_hand = ${JSON.stringify(entry.revealedHand)}::jsonb,
              hand_category = ${entry.handCategory},
              hand_label = ${entry.handLabel},
              hand_comparison = ${JSON.stringify(entry.handComparison)}::jsonb,
              won_layers = ${JSON.stringify(entry.wonLayers)}::jsonb,
              payout = ${entry.payout},
              contested_payout = ${entry.contestedPayout},
              unmatched_return = ${entry.unmatchedReturn},
              settlement_applied = true,
              settled_at = ${now}
          WHERE id = ${entry.id} AND settlement_applied = false
          RETURNING user_id, payout, contested_payout, unmatched_return
        )
        UPDATE bitebluff_accounts account
        SET balance = account.balance + applied.payout,
            lifetime_payout = account.lifetime_payout + applied.contested_payout,
            last_settled_date = (SELECT date FROM bitebluff_rounds WHERE id = ${roundId}),
            updated_at = ${now}
        FROM applied WHERE account.user_id = applied.user_id`),
      ...writes.flatMap(({ entry }) => [
        this.sql`
          INSERT INTO bitebluff_ledger (id, user_id, round_id, kind, amount, created_at)
          SELECT ${`payout:${roundId}:${entry.userId}`}, ${entry.userId}, ${roundId},
                 'payout', ${entry.contestedPayout}, ${now}
          WHERE ${entry.contestedPayout} > 0
          ON CONFLICT (id) DO NOTHING`,
        this.sql`
          INSERT INTO bitebluff_ledger (id, user_id, round_id, kind, amount, created_at)
          SELECT ${`unmatched:${roundId}:${entry.userId}`}, ${entry.userId}, ${roundId},
                 'unmatched_return', ${entry.unmatchedReturn}, ${now}
          WHERE ${entry.unmatchedReturn} > 0
          ON CONFLICT (id) DO NOTHING`,
      ]),
      this.sql`
        UPDATE bitebluff_rounds
        SET status = 'settled', published_secret = ${publishedSecret}, settled_at = ${now}
        WHERE id = ${roundId} AND status = 'settling'
        RETURNING *`,
    ];
    const results = await this.sql.transaction(queries);
    const finalRows = results[results.length - 1];
    if (finalRows[0]) return roundFromRow(finalRows[0] as Record<string, unknown>);
    const existing = await this.getRound(roundId);
    if (!existing) throw new Error("Bitebluff round disappeared during settlement.");
    return existing;
  }

  async claimFinalDelivery(destinationId: string): Promise<boolean> {
    await this.ensureSchema();
    const rows = await this.sql`
      UPDATE bitebluff_destinations SET final_posted_at = -1
      WHERE id = ${destinationId} AND final_posted_at IS NULL
      RETURNING id`;
    return rows.length > 0;
  }

  async recordFinalPage(
    destinationId: string,
    messageId: string,
    now: number,
  ): Promise<void> {
    await this.ensureSchema();
    await this.sql`
      UPDATE bitebluff_destinations
      SET final_message_ids = CASE
            WHEN final_message_ids @> ${JSON.stringify([messageId])}::jsonb
              THEN final_message_ids
            ELSE final_message_ids || ${JSON.stringify([messageId])}::jsonb
          END,
          updated_at = ${now}
      WHERE id = ${destinationId} AND final_posted_at = -1`;
  }

  async completeFinalDelivery(
    destinationId: string,
    messageIds: string[],
    now: number,
  ): Promise<void> {
    await this.ensureSchema();
    await this.sql`
      UPDATE bitebluff_destinations
      SET final_message_ids = ${JSON.stringify(messageIds)}::jsonb,
          final_posted_at = ${now},
          updated_at = ${now}
      WHERE id = ${destinationId} AND final_posted_at = -1`;
  }

  async releaseFinalDelivery(destinationId: string): Promise<void> {
    await this.ensureSchema();
    await this.sql`
      UPDATE bitebluff_destinations SET final_posted_at = NULL
      WHERE id = ${destinationId} AND final_posted_at = -1`;
  }
}

declare global {
  var __bitebluffRepository: BitebluffRepository | undefined;
}

export function getBitebluffRepository(): BitebluffRepository {
  if (!globalThis.__bitebluffRepository) {
    const forceFile = process.env.BITEDLE_FORCE_FILE_STORE === "1";
    if (forceFile && process.env.NODE_ENV === "production") {
      throw new Error("BITEDLE_FORCE_FILE_STORE must never be enabled in production");
    }
    const databaseUrl = forceFile ? null : process.env.DATABASE_URL;
    if (databaseUrl) {
      globalThis.__bitebluffRepository = new BitebluffNeonRepository(databaseUrl);
    } else {
      if (process.env.NODE_ENV === "production") {
        throw new Error("DATABASE_URL must be set in production.");
      }
      globalThis.__bitebluffRepository = new BitebluffFileRepository();
    }
  }
  return globalThis.__bitebluffRepository;
}
