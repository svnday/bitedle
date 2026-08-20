export type RngdleBadgeRarity =
  | "Common"
  | "Uncommon"
  | "Rare"
  | "Epic"
  | "Anomaly"
  | "Mythic";

export type RngdleNumberRarity =
  | "trash"
  | "common"
  | "uncommon"
  | "rare"
  | "epic"
  | "anomaly"
  | "mythic";

export interface RngdleBadge {
  id: string;
  label: string;
  emoji: string;
  ep: number;
  rarity: RngdleBadgeRarity;
  desc: string;
  prob: number;
}

export interface RngdleResult {
  number: number;
  rawEp: number;
  creditedEp: number;
  rarity: RngdleNumberRarity;
  rarityLabel: string;
  rarityBand: string;
  badges: RngdleBadge[];
  penaltyPercent: number | null;
}

export interface RngdleDayState {
  gameDay: string;
  initial: RngdleResult;
  initialRolledAt: number;
  reroll: RngdleResult | null;
  rerolledAt: number | null;
}

export type RngdleRevealState =
  | "ready"
  | "rolling"
  | "revealing-number"
  | "revealing-rarity"
  | "revealing-badges"
  | "initial-complete"
  | "reroll-confirmation"
  | "rerolling"
  | "revealing-reroll"
  | "revealing-penalty"
  | "final-complete";
