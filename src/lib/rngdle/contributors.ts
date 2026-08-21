import { prodContributors } from "./contributors.gen.js";
import type { RngdleBadge } from "./types";

type ContributorMap = Record<string, number[]>;

function miniScrambleContributors(number: number): number[] {
  const digits = [...String(number)].map(Number);
  for (let length = digits.length; length >= 3; length -= 1) {
    for (let start = 0; start <= digits.length - length; start += 1) {
      const window = digits.slice(start, start + length).sort((left, right) => left - right);
      if (window.every((digit, index) => index === 0 || digit === window[index - 1] + 1)) {
        return Array.from({ length }, (_, index) => start + index);
      }
    }
  }
  return [];
}

function fallbackContributors(badge: RngdleBadge, number: number): number[] {
  const digits = [...String(number)];
  if (badge.id === "MINI_SCRAMBLE") return miniScrambleContributors(number);
  if (["EVEN", "ODD", "CLEAN", "SEMI_CLEAN"].includes(badge.id)) return [digits.length - 1];
  if (["GAP_ONE", "GROUNDED", "LIFTOFF", "EQUILIBRIUM"].includes(badge.id)) {
    return [0, digits.length - 1];
  }
  if (badge.id === "PAIR") {
    const pairedDigit = digits.find((digit, index) => digits.indexOf(digit) !== index);
    return pairedDigit
      ? digits.flatMap((digit, index) => digit === pairedDigit ? [index] : [])
      : [];
  }
  if (badge.id === "NEIGHBORS") {
    for (let left = 0; left < digits.length; left += 1) {
      for (let right = left + 1; right < digits.length; right += 1) {
        if (Math.abs(Number(digits[left]) - Number(digits[right])) === 1) return [left, right];
      }
    }
  }
  return [];
}

export function rngdleContributorMap(number: number): ContributorMap {
  return prodContributors(number) as ContributorMap;
}

export function rngdleBadgeContributorIndexes(
  badge: RngdleBadge,
  number: number,
  contributors: ContributorMap,
): number[] {
  const exact = contributors[badge.label.toLowerCase()];
  return exact?.length ? exact : fallbackContributors(badge, number);
}
