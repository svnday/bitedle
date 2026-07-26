export const BITEBLUFF_HAND_SIZE = 5;
export const BITEBLUFF_DAILY_FLOOR = 100;
export const BITEBLUFF_ABSOLUTE_MIN_WAGER = 10;
export const BITEBLUFF_MIN_WAGER_RATE = 0.05;
export const BITEBLUFF_ACTIVE_DAYS = 7;
export const BITEBLUFF_SEASON_DAYS = 30;
export const BITEBLUFF_REDRAW_MIN = 1;
export const BITEBLUFF_REDRAW_MAX = 3;
export const BITEBLUFF_REDRAW_RATE = 0.5;
export const BITEBLUFF_DEAL_INTERVAL_MS = 540;

export const BITEBLUFF_SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;
export type BitebluffSuit = (typeof BITEBLUFF_SUITS)[number];
export type BitebluffRank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface BitebluffCard {
  rank: BitebluffRank;
  suit: BitebluffSuit;
}

export type BitebluffCategory =
  | "royal-flush"
  | "straight-flush"
  | "four-of-a-kind"
  | "full-house"
  | "flush"
  | "straight"
  | "three-of-a-kind"
  | "two-pair"
  | "pair"
  | "high-card";

export interface BitebluffEvaluatedHand {
  category: BitebluffCategory;
  comparison: readonly number[];
  strength: readonly number[];
  label: string;
}

export interface BitebluffEntrant {
  id: string;
  name: string;
  avatar: string;
  balance: number;
  wager: number;
  redrawSurcharge: number;
  hand: readonly BitebluffCard[];
  lastPlayedDay: number;
}
