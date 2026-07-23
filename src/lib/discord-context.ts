/**
 * Bridge between DiscordBootstrap (writer, once the SDK is ready) and
 * client-api.ts (reader, attaches this to outgoing requests). Browser-only,
 * module-level — deliberately not React state, since nothing needs to
 * re-render when this changes.
 */
import type { GameMode } from "./types";

export type ActivityLaunchMode = GameMode | "unavailable";

let guildId: string | null = null;
let discordUserId: string | null = null;
let activityInstanceId: string | null = null;
let biteracerRaceId: string | null = null;

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
// /api/activity/mode). Fail closed instead of ever showing the wrong game.
let launchMode: ActivityLaunchMode = "unavailable";
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

export function setBiteracerRaceId(id: string | null): void {
  biteracerRaceId = id;
}

export function getBiteracerRaceId(): string | null {
  return biteracerRaceId;
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

export function setLaunchMode(mode: ActivityLaunchMode): void {
  launchMode = mode;
  if (!launchModeSet) {
    launchModeSet = true;
    resolveLaunchModeSettled();
  }
}

export function getLaunchMode(): ActivityLaunchMode {
  return launchMode;
}

export function launchModeSettled(): Promise<void> {
  return launchModeSettledPromise;
}

/** True when running inside Discord's Activity iframe (vs. plain web play). */
export function isDiscordEmbed(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  let framed = false;
  try {
    framed = window.self !== window.top;
  } catch {
    // Cross-origin frame access can throw; that itself proves this is framed.
    framed = true;
  }
  const referrerHost = (() => {
    try {
      return document.referrer ? new URL(document.referrer).hostname : "";
    } catch {
      return "";
    }
  })();
  return (
    framed ||
    window.location.hostname.endsWith(".discordsays.com") ||
    referrerHost === "discord.com" ||
    referrerHost.endsWith(".discord.com") ||
    params.has("frame_id") ||
    params.has("instance_id") ||
    params.has("platform")
  );
}
