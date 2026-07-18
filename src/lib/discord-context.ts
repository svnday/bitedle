/**
 * Bridge between DiscordBootstrap (writer, once the SDK is ready) and
 * client-api.ts (reader, attaches this to outgoing requests). Browser-only,
 * module-level — deliberately not React state, since nothing needs to
 * re-render when this changes.
 */
import type { GameMode } from "./types";

let guildId: string | null = null;
let discordUserId: string | null = null;
let activityInstanceId: string | null = null;

// Resolves once DiscordBootstrap's handshake has settled — either a real
// guildId, or a definitive null (missing client id, failed ready(), or the
// safety timeout). client-api.ts awaits this before sending any request
// while embedded, so nothing can race ahead of the handshake and silently
// fall back to "web game" scoping.
let settled = false;
let resolveSettled: () => void;
const settledPromise = new Promise<void>((resolve) => {
  resolveSettled = resolve;
});

let identitySettled = false;
let resolveIdentitySettled: () => void;
const identitySettledPromise = new Promise<void>((resolve) => {
  resolveIdentitySettled = resolve;
});

// Which game mode this Activity instance is locked to (from
// /api/activity/mode). Classic outside Discord and on any failure path.
let launchMode: GameMode = "classic";
let launchModeSet = false;
let resolveLaunchModeSettled: () => void;
const launchModeSettledPromise = new Promise<void>((resolve) => {
  resolveLaunchModeSettled = resolve;
});

export function setGuildId(id: string | null): void {
  guildId = id;
  if (!settled) {
    settled = true;
    resolveSettled();
  }
}

export function getGuildId(): string | null {
  return guildId;
}

export function setActivityInstanceId(id: string | null): void {
  activityInstanceId = id;
}

export function getActivityInstanceId(): string | null {
  return activityInstanceId;
}

export function guildContextSettled(): Promise<void> {
  return settledPromise;
}

export function setDiscordUserId(id: string | null): void {
  discordUserId = id;
  if (!identitySettled) {
    identitySettled = true;
    resolveIdentitySettled();
  }
}

export function getDiscordUserId(): string | null {
  return discordUserId;
}

export function discordIdentitySettled(): Promise<void> {
  return identitySettledPromise;
}

export function setLaunchMode(mode: GameMode): void {
  launchMode = mode;
  if (!launchModeSet) {
    launchModeSet = true;
    resolveLaunchModeSettled();
  }
}

export function getLaunchMode(): GameMode {
  return launchMode;
}

export function launchModeSettled(): Promise<void> {
  return launchModeSettledPromise;
}

/** True when running inside Discord's Activity iframe (vs. plain web play). */
export function isDiscordEmbed(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return (
    window.location.hostname.endsWith(".discordsays.com") ||
    (params.has("frame_id") && params.has("instance_id") && params.has("platform"))
  );
}
