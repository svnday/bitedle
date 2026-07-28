import type { BitebluffCard, BitebluffCategory } from "./bitebluff-constants";
import type { BitebluffRedrawMode } from "./bitebluff-time";

export type BitebluffRoundStatus = "open" | "settling" | "settled";

export interface BitebluffAccountRecord {
  userId: string;
  balance: number;
  lastTopUpDate: string | null;
  lifetimeWagered: number;
  lifetimePayout: number;
  lastSettledDate: string | null;
  updatedAt: number;
}

export interface BitebluffRoundRecord {
  id: string;
  date: string;
  guildId: string | null;
  status: BitebluffRoundStatus;
  opensAt: number;
  revealAt: number;
  secretCommitment: string;
  encryptedSecret: string;
  publishedSecret: string | null;
  settlingStartedAt: number | null;
  settledAt: number | null;
  createdAt: number;
}

export interface BitebluffEntryRecord {
  id: string;
  roundId: string;
  userId: string;
  discordUserId: string;
  displayName: string;
  avatarHash: string | null;
  wager: number;
  redrawSurcharge: number;
  encryptedDiscardedCards: string | null;
  encryptedBurnPositions: string | null;
  redrawCount: number | null;
  redrawAt: number | null;
  encryptedHand: string;
  revealedHand: BitebluffCard[] | null;
  handCategory: BitebluffCategory | null;
  handLabel: string | null;
  handComparison: number[] | null;
  wonLayers: number[];
  payout: number;
  contestedPayout: number;
  unmatchedReturn: number;
  settlementApplied: boolean;
  enteredAt: number;
  settledAt: number | null;
}

export type BitebluffPreviewEntry = Pick<
  BitebluffEntryRecord,
  | "id"
  | "roundId"
  | "userId"
  | "discordUserId"
  | "displayName"
  | "avatarHash"
  | "wager"
  | "enteredAt"
>;

export interface BitebluffDestinationRecord {
  id: string;
  roundId: string;
  guildId: string;
  channelId: string;
  applicationId: string;
  webhookToken: string;
  tokenCreatedAt: number;
  previewMessageId: string | null;
  previewMessageCreatedAt: number | null;
  previewPosting: boolean;
  finalMessageIds: string[];
  finalPostedAt: number | null;
  updatedAt: number;
}

export interface BitebluffEntryQuote {
  round: Pick<BitebluffRoundRecord, "id" | "date" | "status" | "revealAt" | "secretCommitment">;
  balance: number;
  topUp: number;
  minimumWager: number;
  maximumWager: number;
  existingEntry: BitebluffEntryRecord | null;
}

export interface BitebluffEnterInput {
  roundId: string;
  date: string;
  now: number;
  userId: string;
  discordUserId: string;
  displayName: string;
  avatarHash: string | null;
  wager: number;
  encryptedHand: string;
}

export interface BitebluffEnterResult {
  entry: BitebluffEntryRecord;
  account: BitebluffAccountRecord;
  created: boolean;
  topUp: number;
}

export interface BitebluffRedrawInput {
  roundId: string;
  userId: string;
  now: number;
  count: number;
  surcharge: number;
  encryptedHand: string;
  encryptedDiscardedCards: string;
  encryptedBurnPositions: string;
}

export interface BitebluffRedrawResult {
  entry: BitebluffEntryRecord;
  account: BitebluffAccountRecord;
  applied: boolean;
}

export type BitebluffRedrawRequest =
  | { count: number }
  | { positions: readonly number[] };

export interface BitebluffPotParticipant {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  wager: number;
  me: boolean;
}

export interface BitebluffLeaderboardAccount {
  userId: string;
  displayName: string;
  discordUserId: string;
  avatarHash: string | null;
  bankroll: number;
  lastSettledDate: string | null;
}

export interface BitebluffLeaderboardEntry {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  bankroll: number;
  rank: number | null;
  active: boolean;
  me: boolean;
}

export interface BitebluffPrivateState {
  round: {
    id: string;
    date: string;
    guildId: string | null;
    status: BitebluffRoundStatus;
    revealAt: number;
    secretCommitment: string;
    publishedSecret: string | null;
  };
  account: {
    balance: number;
    lifetimeWagered: number;
    lifetimePayout: number;
  };
  wager: {
    entryOpen: boolean;
    availableBalance: number;
    topUp: number;
    minimum: number;
    maximum: number;
  };
  entry: null | {
    wager: number;
    committed: number;
    enteredAt: number;
    hand: BitebluffCard[];
    handLabel: string | null;
    payout: number | null;
    contestedPayout: number | null;
    unmatchedReturn: number | null;
    net: number | null;
    redraw: null | {
      count: number;
      surcharge: number;
      at: number;
      positions: number[];
    };
  };
  burnAndDraw: {
    mode: BitebluffRedrawMode;
    available: boolean;
    deadline: number;
    surcharge: number | null;
    unavailableReason: string | null;
  };
  participants: BitebluffPotParticipant[];
  pot: number;
  participantCount: number;
}

export interface BitebluffLeaderboard {
  title: "Active bankroll";
  activeWindowDays: number;
  entries: BitebluffLeaderboardEntry[];
}

export interface BitebluffSettlementResult {
  round: BitebluffRoundRecord;
  entries: BitebluffEntryRecord[];
  alreadySettled: boolean;
}
