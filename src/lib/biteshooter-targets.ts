import {
  BITESHOOTER_INNER_DAMAGE,
  BITESHOOTER_INNER_RADIUS_RATIO,
  BITESHOOTER_MIDDLE_DAMAGE,
  BITESHOOTER_MIDDLE_RADIUS_RATIO,
  BITESHOOTER_OUTER_DAMAGE,
} from "./biteshooter-constants";

export interface NormalizedPoint {
  x: number;
  y: number;
}

export type BiteshooterZone = "inner" | "middle" | "outer" | "miss";

const SAFE_MIN = 0.08;
const SAFE_SPAN = 1 - SAFE_MIN * 2;
const MIN_TARGET_DISTANCE = 0.2;
const MAX_PLACEMENT_ATTEMPTS = 6;

function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function seededUnit(seed: string, stream: string): number {
  return hash32(`${seed}:${stream}`) / 0x1_0000_0000;
}

function candidateFor(seed: string, targetIndex: number, attempt: number): NormalizedPoint {
  return {
    x: SAFE_MIN + seededUnit(seed, `${targetIndex}:${attempt}:x`) * SAFE_SPAN,
    y: SAFE_MIN + seededUnit(seed, `${targetIndex}:${attempt}:y`) * SAFE_SPAN,
  };
}

export function targetFor(seed: string, targetIndex: number): NormalizedPoint {
  const safeIndex = Math.max(0, Math.trunc(targetIndex));
  const previous =
    safeIndex === 0 ? null : candidateFor(seed, safeIndex - 1, 0);
  let fallback = candidateFor(seed, safeIndex, 0);

  for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt += 1) {
    const candidate = candidateFor(seed, safeIndex, attempt);
    fallback = candidate;
    if (
      !previous ||
      Math.hypot(candidate.x - previous.x, candidate.y - previous.y) >=
        MIN_TARGET_DISTANCE
    ) {
      return candidate;
    }
  }

  return {
    x: SAFE_MIN + ((fallback.x - SAFE_MIN + 0.5) % SAFE_SPAN),
    y: SAFE_MIN + ((fallback.y - SAFE_MIN + 0.37) % SAFE_SPAN),
  };
}

export function classifyBiteshooterHit(
  distance: number,
  outerRadius: number,
): BiteshooterZone {
  if (!Number.isFinite(distance) || !Number.isFinite(outerRadius) || outerRadius <= 0) {
    return "miss";
  }
  if (distance <= outerRadius * BITESHOOTER_INNER_RADIUS_RATIO) return "inner";
  if (distance <= outerRadius * BITESHOOTER_MIDDLE_RADIUS_RATIO) return "middle";
  if (distance <= outerRadius) return "outer";
  return "miss";
}

export function damageForBiteshooterZone(zone: BiteshooterZone): number {
  if (zone === "inner") return BITESHOOTER_INNER_DAMAGE;
  if (zone === "middle") return BITESHOOTER_MIDDLE_DAMAGE;
  if (zone === "outer") return BITESHOOTER_OUTER_DAMAGE;
  return 0;
}

export function clampBiteshooterHealth(health: number, damage: number): number {
  return Math.max(0, Math.min(100, health - Math.max(0, damage)));
}
