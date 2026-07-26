import {
  BITEBLUFF_ABSOLUTE_MIN_WAGER,
  BITEBLUFF_ACTIVE_DAYS,
  BITEBLUFF_DAILY_FLOOR,
  BITEBLUFF_MIN_WAGER_RATE,
  BITEBLUFF_REDRAW_RATE,
} from "./bitebluff-constants";

export function bitebluffTopUp(balance: number): number {
  if (!Number.isInteger(balance) || balance < 0) throw new Error("Balance must be a non-negative integer.");
  return Math.max(0, BITEBLUFF_DAILY_FLOOR - balance);
}

export function bitebluffWagerBounds(balance: number): { minimum: number; maximum: number } {
  if (!Number.isInteger(balance) || balance < BITEBLUFF_DAILY_FLOOR) {
    throw new Error("Wager bounds require a topped-up integer balance.");
  }
  return {
    minimum: Math.max(BITEBLUFF_ABSOLUTE_MIN_WAGER, Math.ceil(balance * BITEBLUFF_MIN_WAGER_RATE)),
    maximum: bitebluffMaximumInitialWager(balance),
  };
}

export function bitebluffMaximumInitialWager(balance: number): number {
  if (!Number.isInteger(balance) || balance < 0) {
    throw new Error("Balance must be a non-negative integer.");
  }
  let low = 0;
  let high = balance;
  while (low < high) {
    const candidate = Math.ceil((low + high) / 2);
    const reserve = Math.max(
      BITEBLUFF_ABSOLUTE_MIN_WAGER,
      Math.ceil(candidate * BITEBLUFF_REDRAW_RATE),
    );
    if (candidate + reserve <= balance) low = candidate;
    else high = candidate - 1;
  }
  return low;
}

export function bitebluffRedrawSurcharge(originalWager: number): number {
  if (!Number.isInteger(originalWager) || originalWager <= 0) {
    throw new Error("Original wager must be a positive integer.");
  }
  return Math.max(BITEBLUFF_ABSOLUTE_MIN_WAGER, Math.ceil(originalWager * BITEBLUFF_REDRAW_RATE));
}

export function isBitebluffActive(lastSettledDay: number, currentDay: number): boolean {
  return currentDay - lastSettledDay < BITEBLUFF_ACTIVE_DAYS;
}

export function bitebluffSeasonNet(input: {
  payouts: number;
  wagers: number;
  redrawSurcharges: number;
}): number {
  return input.payouts - input.wagers - input.redrawSurcharges;
}
