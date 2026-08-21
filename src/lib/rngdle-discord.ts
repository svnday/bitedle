import type { RngdleDiscordRoll, RngdleLeaderboardEntry, RngdleUserProfile } from "./rngdle-discord-store";
import {
  RNGDLE_DISCORD_GIF_FILENAME,
  RNGDLE_DISCORD_LEADERBOARD_FILENAME,
  RNGDLE_DISCORD_PNG_FILENAME,
  RNGDLE_DISCORD_PROFILE_FILENAME,
  RNGDLE_DISCORD_RISK_GIF_FILENAME,
  renderRngdleDiscordAnimation,
  renderRngdleDiscordLeaderboard,
  renderRngdleDiscordProfile,
  renderRngdleRiskAnimation,
  renderRngdleDiscordStill,
  type RngdleAnimationAssets,
  type RngdleRiskAnimation,
  type RngdleResultCardStats,
} from "./rngdle-discord-renderer";
import { scoreRngdleNumber, selectRngdlePenalty } from "./rngdle/scoring";
import { canRerollRngdle, rngdleRerollDeadline } from "./rngdle/time";
import type { RngdleResult } from "./rngdle/types";

const DEFAULT_ATTACHMENT_LIMIT = 8 * 1024 * 1024;
const FINAL_EDIT_MARGIN_MS = 180;
const FINAL_EDIT_RETRY_MS = 250;
// Beats held between animation phases. A reroll reveals the new number first
// and draws the risk against it second, so each phase needs a moment on screen
// to be read before the next edit replaces it. Both GIFs are encoded loop:1,
// so a hold is just the last frame staying put - no extra render.
const REVEAL_HOLD_MS = 2_600;
const RISK_HOLD_MS = 2_200;
const DISCORD_COMPONENTS_V2_FLAG = 1 << 15;
const RNGDLE_MESSAGE_ACCENTS: Record<RngdleDiscordRoll["current"]["rarity"], number> = {
  trash: 0x667896,
  common: 0x8d91a3,
  uncommon: 0x21cfa5,
  rare: 0x3b9dff,
  epic: 0x9d78ff,
  anomaly: 0xff5ab3,
  mythic: 0xffb52e,
};

export const RNGDLE_REROLL_CUSTOM_ID_PREFIX = "rngdle-reroll:v1:";
export const RNGDLE_REROLL_CONFIRM_CUSTOM_ID_PREFIX = "rngdle-reroll-go:v1:";
export const RNGDLE_REROLL_CANCEL_CUSTOM_ID_PREFIX = "rngdle-reroll-no:v1:";
export const RNGDLE_REPLAY_CUSTOM_ID_PREFIX = "rngdle-replay:v1:";
export const RNGDLE_REROLL_BUTTON_LABEL = "Reroll 1-99% Risk";
export const RNGDLE_LEADERBOARD_BUTTON_ID = "rngdle-leaderboard:v1";
export const RNGDLE_PROFILE_BUTTON_ID = "rngdle-profile:v1";

export function rngdleRerollCustomId(gameDay: string, userId: string): string {
  return `${RNGDLE_REROLL_CUSTOM_ID_PREFIX}${gameDay}:${userId}`;
}

export function parseRngdleRerollCustomId(customId: string): { gameDay: string; userId: string } | null {
  return parseOwnedRollCustomId(customId, RNGDLE_REROLL_CUSTOM_ID_PREFIX);
}

export function parseRngdleRerollConfirmCustomId(customId: string): { gameDay: string; userId: string } | null {
  return parseOwnedRollCustomId(customId, RNGDLE_REROLL_CONFIRM_CUSTOM_ID_PREFIX);
}

export function parseRngdleRerollCancelCustomId(customId: string): { gameDay: string; userId: string } | null {
  return parseOwnedRollCustomId(customId, RNGDLE_REROLL_CANCEL_CUSTOM_ID_PREFIX);
}

/** Spells out what a reroll costs, since it cannot be taken back. */
export const RNGDLE_REROLL_WARNING = `⚠️ **Reroll today's number?**
A random **1-99% risk** is drawn and subtracted from the new roll's EP. You keep the new number whether it beats this one or not, today's number is gone for good, and you get **one reroll per day**.`;

interface RngdleMessageInteraction {
  message?: { components?: unknown[] };
}

/**
 * The roll card's own container, echoed back untouched. Rebuilding it would
 * mean re-uploading its image; taking Discord's copy keeps the card pixel
 * identical and leaves its attachment in place, so only the buttons change.
 */
function rngdleCardContainer(body: RngdleMessageInteraction): unknown[] {
  return (body.message?.components ?? []).filter((component) => (
    typeof component === "object" && component !== null && (component as { type?: number }).type === 17
  ));
}

function rngdleActionRow(buttons: Record<string, unknown>[]) {
  return { type: 1, components: buttons };
}

/** Swaps the card's buttons for a confirm/cancel pair and states the terms. */
export function rngdleRerollConfirmUpdate(
  body: RngdleMessageInteraction,
  gameDay: string,
  userId: string,
): Record<string, unknown> {
  return {
    flags: DISCORD_COMPONENTS_V2_FLAG,
    allowed_mentions: { parse: [] },
    components: [
      ...rngdleCardContainer(body),
      { type: 10, content: RNGDLE_REROLL_WARNING },
      rngdleActionRow([
        { type: 2, style: 4, label: "Yes, reroll", custom_id: `${RNGDLE_REROLL_CONFIRM_CUSTOM_ID_PREFIX}${gameDay}:${userId}` },
        { type: 2, style: 2, label: "Cancel", custom_id: `${RNGDLE_REROLL_CANCEL_CUSTOM_ID_PREFIX}${gameDay}:${userId}` },
      ]),
    ],
  };
}

/** Puts the card back exactly as it was, warning and all, on a cancel. */
export function rngdleRerollCancelUpdate(
  body: RngdleMessageInteraction,
  gameDay: string,
  userId: string,
): Record<string, unknown> {
  return {
    flags: DISCORD_COMPONENTS_V2_FLAG,
    allowed_mentions: { parse: [] },
    components: [
      ...rngdleCardContainer(body),
      rngdleActionRow([
        { type: 2, style: 2, label: "Leaderboard", custom_id: RNGDLE_LEADERBOARD_BUTTON_ID },
        { type: 2, style: 1, label: "My Profile", custom_id: RNGDLE_PROFILE_BUTTON_ID },
        { type: 2, style: 4, label: RNGDLE_REROLL_BUTTON_LABEL, custom_id: rngdleRerollCustomId(gameDay, userId) },
      ]),
    ],
  };
}

export function rngdleReplayCustomId(gameDay: string, userId: string): string {
  return `${RNGDLE_REPLAY_CUSTOM_ID_PREFIX}${gameDay}:${userId}`;
}

export function parseRngdleReplayCustomId(customId: string): { gameDay: string; userId: string } | null {
  return parseOwnedRollCustomId(customId, RNGDLE_REPLAY_CUSTOM_ID_PREFIX);
}

function parseOwnedRollCustomId(customId: string, prefix: string): { gameDay: string; userId: string } | null {
  if (!customId.startsWith(prefix)) return null;
  const payload = customId.slice(prefix.length);
  const separator = payload.indexOf(":");
  if (separator < 1) return null;
  const gameDay = payload.slice(0, separator);
  const userId = payload.slice(separator + 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gameDay) || !/^\d{5,25}$/.test(userId)) return null;
  return { gameDay, userId };
}

function safeLimit(limit: number | undefined): number {
  return Number.isSafeInteger(limit) && limit! > 0 ? limit! : DEFAULT_ATTACHMENT_LIMIT;
}

/**
 * Per-instance caches. The risk animation depends only on its percent, so a
 * warmed instance serves rerolls instantly; roll assets are kept briefly so a
 * Replay shortly after a roll skips the full re-render. The reroll penalty is
 * drawn at roll time (same 1-99 uniform distribution, still hidden from the
 * player) purely so its animation can be rendered ahead of the click.
 */
const riskAnimationCache = new Map<number, Promise<RngdleRiskAnimation>>();
const pendingRerollPenalties = new Map<string, number>();
const animationAssetCache = new Map<string, { assets: RngdleAnimationAssets; createdAt: number }>();
const ASSET_CACHE_TTL_MS = 90_000;
const ASSET_CACHE_LIMIT = 8;

function pendingPenaltyKey(guildId: string, userId: string, gameDay: string): string {
  return `${guildId}:${userId}:${gameDay}`;
}

export function takePendingRngdlePenalty(guildId: string, userId: string, gameDay: string): number | null {
  const key = pendingPenaltyKey(guildId, userId, gameDay);
  const value = pendingRerollPenalties.get(key) ?? null;
  pendingRerollPenalties.delete(key);
  return value;
}

function cachedRiskAnimation(
  percent: number,
  renderRisk: typeof renderRngdleRiskAnimation,
): Promise<RngdleRiskAnimation> {
  let entry = riskAnimationCache.get(percent);
  if (!entry) {
    entry = renderRisk(percent);
    riskAnimationCache.set(percent, entry);
    entry.catch(() => riskAnimationCache.delete(percent));
  }
  return entry;
}

async function warmRerollRisk(roll: RngdleDiscordRoll, renderRisk: typeof renderRngdleRiskAnimation): Promise<void> {
  if (roll.rerolledAt !== null) return;
  for (const key of pendingRerollPenalties.keys()) {
    if (!key.endsWith(`:${roll.gameDay}`)) pendingRerollPenalties.delete(key);
  }
  const key = pendingPenaltyKey(roll.guildId, roll.userId, roll.gameDay);
  if (pendingRerollPenalties.has(key)) return;
  const penalty = selectRngdlePenalty();
  pendingRerollPenalties.set(key, penalty);
  try {
    await cachedRiskAnimation(penalty, renderRisk);
  } catch (error) {
    console.warn("rngdle: reroll risk warm-up failed", error);
  }
}

function assetCacheKey(
  roll: RngdleDiscordRoll,
  result: RngdleResult,
  rank: number,
  playerCount: number,
  stats: RngdleResultCardStats,
): string {
  return [
    roll.guildId, roll.userId, roll.gameDay, roll.displayName,
    result.number, result.creditedEp, result.penaltyPercent,
    rank, playerCount, stats.careerEp, stats.currentStreak, stats.newBadges, stats.rerollDeltaEp,
  ].join("|");
}

function readAssetCache(key: string): RngdleAnimationAssets | null {
  const entry = animationAssetCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > ASSET_CACHE_TTL_MS) {
    animationAssetCache.delete(key);
    return null;
  }
  return entry.assets;
}

function writeAssetCache(key: string, assets: RngdleAnimationAssets): void {
  for (const [existingKey, entry] of animationAssetCache) {
    if (Date.now() - entry.createdAt > ASSET_CACHE_TTL_MS) animationAssetCache.delete(existingKey);
  }
  while (animationAssetCache.size >= ASSET_CACHE_LIMIT) {
    const oldest = animationAssetCache.keys().next().value;
    if (oldest === undefined) break;
    animationAssetCache.delete(oldest);
  }
  animationAssetCache.set(key, { assets, createdAt: Date.now() });
}

function escapeDiscordText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([*_~`|>])/g, "\\$1").replace(/@/g, "@\u200b");
}

function resultComponents(roll: RngdleDiscordRoll, now: number) {
  const buttons: Record<string, unknown>[] = [];
  if (roll.rerolledAt !== null) {
    buttons.push({
      type: 2,
      style: 2,
      label: "Replay",
      custom_id: rngdleReplayCustomId(roll.gameDay, roll.userId),
    });
  }
  buttons.push(
    { type: 2, style: 2, label: "Leaderboard", custom_id: RNGDLE_LEADERBOARD_BUTTON_ID },
    { type: 2, style: 1, label: "My Profile", custom_id: RNGDLE_PROFILE_BUTTON_ID },
  );
  if (roll.rerolledAt === null && canRerollRngdle(roll.initialRolledAt, roll.rerolledAt, now)) {
    buttons.push({
      type: 2,
      style: 4,
      label: RNGDLE_REROLL_BUTTON_LABEL,
      custom_id: rngdleRerollCustomId(roll.gameDay, roll.userId),
    });
  }
  return [{
    type: 1,
    components: buttons,
  }];
}

function signedPoints(value: number): string {
  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toLocaleString("en-US")} EP`;
}

function rngdleResultCopy(roll: RngdleDiscordRoll, rank: number, playerCount: number, newBadges = 0, now = Date.now()): {
  header: string | null;
  footer: string;
} {
  const result = roll.current;
  if (roll.rerolledAt !== null && result.penaltyPercent !== null) {
    return {
      header: null,
      // Same two figures as the card, named for the same reason: the penalty is
      // what this roll lost, the swing is how it compares to the roll given up.
      footer: `**Reroll locked · -${result.penaltyPercent}% (-${(result.rawEp - result.creditedEp).toLocaleString("en-US")} EP) from ${result.rawEp.toLocaleString("en-US")} base EP · ${signedPoints(result.creditedEp - roll.initial.creditedEp)} vs first roll**`,
    };
  }
  const rerollTimer = canRerollRngdle(roll.initialRolledAt, roll.rerolledAt, now)
    ? `⏱️ **One reroll available:** risk window closes <t:${Math.ceil(rngdleRerollDeadline(roll.initialRolledAt) / 1_000)}:R>`
    : null;
  return {
    header: [
      `🎰 **${escapeDiscordText(roll.displayName)} rolled ${result.number.toLocaleString("en-US")}**`,
      `**${result.creditedEp.toLocaleString("en-US")} EP** · ${result.badges.length} badges · today's guild rank **#${rank}/${playerCount}**`,
    ].join("\n"),
    footer: [
      `**+${newBadges} new ${newBadges === 1 ? "badge" : "badges"} discovered**`,
      ...(rerollTimer ? [rerollTimer] : []),
    ].join("\n"),
  };
}

export function rngdleResultContent(roll: RngdleDiscordRoll, rank: number, playerCount: number, newBadges = 0, now = Date.now()): string {
  const copy = rngdleResultCopy(roll, rank, playerCount, newBadges, now);
  return [copy.header, copy.footer].filter(Boolean).join("\n");
}

function rngdleRollPayload(input: {
  roll: RngdleDiscordRoll;
  now: number;
  filename?: string;
  description?: string;
  header?: string | null;
  footer: string;
  includeActions?: boolean;
  /** Defaults to the final rarity; set while an earlier phase is on screen. */
  accentRarity?: RngdleDiscordRoll["current"]["rarity"];
}): Record<string, unknown> {
  const containerComponents: Record<string, unknown>[] = [];
  if (input.header) containerComponents.push({ type: 10, content: input.header });
  if (input.filename) {
    containerComponents.push({
      type: 12,
      items: [{
        media: { url: `attachment://${input.filename}` },
        description: input.description,
      }],
    });
  }
  if (input.footer) containerComponents.push({ type: 10, content: input.footer });
  return {
    content: null,
    embeds: [],
    flags: DISCORD_COMPONENTS_V2_FLAG,
    allowed_mentions: { parse: [] },
    components: [
      {
        type: 17,
        accent_color: RNGDLE_MESSAGE_ACCENTS[input.accentRarity ?? input.roll.current.rarity],
        components: containerComponents,
      },
      ...(input.includeActions === false ? [] : resultComponents(input.roll, input.now)),
    ],
  };
}

function webhookUrl(applicationId: string, token: string): string {
  const apiBase = process.env.BITEDLE_DISCORD_API_BASE_URL || "https://discord.com/api/v10";
  return `${apiBase}/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(token)}/messages/@original`;
}

async function patchMultipart(
  url: string,
  payload: Record<string, unknown>,
  file: Buffer,
  filename: string,
  contentType: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const form = new FormData();
  form.append("payload_json", JSON.stringify(payload));
  form.append("files[0]", new Blob([new Uint8Array(file)], { type: contentType }), filename);
  return fetchImpl(url, { method: "PATCH", body: form });
}

async function patchJson(url: string, payload: Record<string, unknown>, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function responseError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  return `${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`;
}

export async function deliverRngdleRoll(input: {
  applicationId: string;
  token: string;
  roll: RngdleDiscordRoll;
  rank: number;
  playerCount: number;
  stats: RngdleResultCardStats;
  animate: boolean;
  riskAnimationPercent?: number;
  attachmentSizeLimit?: number;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  renderRiskAnimation?: typeof renderRngdleRiskAnimation;
}): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const sleep = input.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const now = input.now ?? Date.now;
  const renderRisk = input.renderRiskAnimation ?? renderRngdleRiskAnimation;
  const url = webhookUrl(input.applicationId, input.token);
  const limit = safeLimit(input.attachmentSizeLimit);
  const resultCopy = rngdleResultCopy(input.roll, input.rank, input.playerCount, input.stats.newBadges, now());
  const timingOverride = (): number | null => {
    const override = process.env.BITEDLE_RNGDLE_FINAL_EDIT_DELAY_MS;
    return process.env.NODE_ENV !== "production" && override !== undefined
      ? Math.max(0, Number(override) || 0)
      : null;
  };
  const animationDelay = (duration: number) => timingOverride() ?? duration + FINAL_EDIT_MARGIN_MS;
  const waitForAnimation = async (duration: number) => {
    await sleep(animationDelay(duration));
  };
  const hold = async (duration: number) => {
    await sleep(timingOverride() ?? duration);
  };

  // A reroll plays as three beats: the new number lands at full value, the risk
  // is drawn against it, then the card settles on what survived. The reveal is
  // therefore rendered from an unpenalised score - showing the reduced EP or the
  // "-37% FROM …" line before the risk has run would give the outcome away.
  const isReroll = input.riskAnimationPercent !== undefined;
  const revealResult = isReroll ? scoreRngdleNumber(input.roll.current.number) : input.roll.current;
  const revealStats = isReroll ? { ...input.stats, rerollDeltaEp: null } : input.stats;

  // Clear Discord's "thinking…" (or a reroll's stale buttons) immediately with
  // a text-only edit; every render below happens behind a visible message.
  const opener = await patchJson(url, {
    ...rngdleRollPayload({
      roll: input.roll,
      now: now(),
      footer: `🎰 **${escapeDiscordText(input.roll.displayName)} is ${isReroll ? "rerolling" : "rolling"}…**`,
      includeActions: false,
      accentRarity: revealResult.rarity,
    }),
    attachments: [],
  }, fetchImpl);
  if (!opener.ok) console.warn(`rngdle: opener edit failed (${await responseError(opener)})`);

  let animation: Buffer | null = null;
  let durationMs = 0;
  let still: Buffer | null = null;

  if (input.animate) {
    const cacheKey = assetCacheKey(input.roll, revealResult, input.rank, input.playerCount, revealStats);
    const cached = readAssetCache(cacheKey);
    if (cached) {
      animation = cached.animation;
      durationMs = cached.durationMs;
    } else {
      try {
        const rendered = await renderRngdleDiscordAnimation(
          revealResult,
          input.roll.displayName,
          input.rank,
          input.playerCount,
          revealStats,
        );
        animation = rendered.animation;
        durationMs = rendered.durationMs;
        writeAssetCache(cacheKey, rendered);
      } catch (error) {
        // A failed GIF still leaves the final card worth delivering.
        console.error("rngdle: animation rendering failed", error);
      }
    }
  }

  let animationPosted = false;
  if (animation && animation.byteLength <= limit) {
    const animationCopy = isReroll
      ? { header: null, footer: `🎰 **${escapeDiscordText(input.roll.displayName)}'s rerolled number is landing…**` }
      : { header: `🎰 **${escapeDiscordText(input.roll.displayName)} is rolling…**`, footer: "" };
    const animationResponse = await patchMultipart(url, {
      ...rngdleRollPayload({
        roll: input.roll,
        now: now(),
        filename: RNGDLE_DISCORD_GIF_FILENAME,
        description: "RNGDLE number and badge reveal",
        ...animationCopy,
        includeActions: input.roll.rerolledAt === null,
        accentRarity: revealResult.rarity,
      }),
      attachments: [{ id: 0, filename: RNGDLE_DISCORD_GIF_FILENAME, description: "RNGDLE number and badge reveal" }],
    }, animation, RNGDLE_DISCORD_GIF_FILENAME, "image/gif", fetchImpl);
    animationPosted = animationResponse.ok;
    if (!animationResponse.ok) console.warn(`rngdle: animation edit failed (${await responseError(animationResponse)})`);
  } else if (animation) {
    console.warn(`rngdle: animation exceeded the interaction attachment limit (${limit} bytes)`);
  }

  // Both kicked off with the reveal already on screen, so their cost is paid out
  // of playback time. The risk animation is usually a cache hit from roll time.
  const pendingRisk: Promise<RngdleRiskAnimation | null> | null = isReroll
    ? cachedRiskAnimation(input.riskAnimationPercent!, renderRisk).catch((error: unknown) => {
      console.error("rngdle: risk animation rendering failed", error);
      return null;
    })
    : null;
  const pendingStill: Promise<Buffer> | null = animationPosted
    ? renderRngdleDiscordStill(
      input.roll.current,
      input.roll.displayName,
      input.rank,
      input.playerCount,
      input.stats,
    ).catch((error: unknown) => {
      console.error("rngdle: still rendering failed during playback", error);
      return null as unknown as Buffer;
    })
    : null;

  if (animationPosted) {
    await waitForAnimation(durationMs);
    // Let the number sit at full value before anything starts taking EP off it.
    if (isReroll) await hold(REVEAL_HOLD_MS);
  }

  if (pendingRisk) {
    const risk = await pendingRisk;
    if (risk && risk.animation.byteLength <= limit) {
      const riskResponse = await patchMultipart(url, {
        ...rngdleRollPayload({
          roll: input.roll,
          now: now(),
          filename: RNGDLE_DISCORD_RISK_GIF_FILENAME,
          description: "RNGDLE reroll risk selection from 1 to 99 percent",
          footer: `🎲 **${escapeDiscordText(input.roll.displayName)} is rolling the reroll risk…**`,
          includeActions: false,
          accentRarity: revealResult.rarity,
        }),
        attachments: [{ id: 0, filename: RNGDLE_DISCORD_RISK_GIF_FILENAME, description: "RNGDLE reroll risk selection from 1 to 99 percent" }],
      }, risk.animation, RNGDLE_DISCORD_RISK_GIF_FILENAME, "image/gif", fetchImpl);
      if (riskResponse.ok) {
        await waitForAnimation(risk.durationMs);
        // Hold on RISK LOCKED so the penalty registers before the card lands.
        await hold(RISK_HOLD_MS);
      } else {
        console.warn(`rngdle: risk animation edit failed (${await responseError(riskResponse)})`);
      }
    } else if (risk) {
      console.warn(`rngdle: risk animation exceeded the interaction attachment limit (${limit} bytes)`);
    }
  }

  if (pendingStill) still = await pendingStill;
  if (!still) {
    try {
      still = await renderRngdleDiscordStill(
        input.roll.current,
        input.roll.displayName,
        input.rank,
        input.playerCount,
        input.stats,
      );
    } catch (error) {
      console.error("rngdle: image rendering failed", error);
      const fallback = await patchJson(url, {
        ...rngdleRollPayload({
          roll: input.roll,
          now: now(),
          header: resultCopy.header,
          footer: resultCopy.footer,
        }),
        attachments: [],
      }, fetchImpl);
      if (!fallback.ok) throw new Error(`RNGDLE text fallback failed (${await responseError(fallback)})`);
      return;
    }
  }

  if (still.byteLength <= limit) {
    const finalPayload = {
      ...rngdleRollPayload({
        roll: input.roll,
        now: now(),
        filename: RNGDLE_DISCORD_PNG_FILENAME,
        description: `RNGDLE result ${input.roll.current.number}`,
        header: resultCopy.header,
        footer: resultCopy.footer,
      }),
      attachments: [{ id: 0, filename: RNGDLE_DISCORD_PNG_FILENAME, description: `RNGDLE result ${input.roll.current.number}` }],
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await patchMultipart(url, finalPayload, still, RNGDLE_DISCORD_PNG_FILENAME, "image/png", fetchImpl);
      if (response.ok) {
        // Pre-draw the reroll penalty and render its risk animation now, so a
        // reroll click on this instance answers instantly.
        await warmRerollRisk(input.roll, renderRisk);
        return;
      }
      console.warn(`rngdle: still-image edit failed (${await responseError(response)})`);
      if (attempt === 0) await sleep(FINAL_EDIT_RETRY_MS);
    }
  }

  const fallback = await patchJson(url, {
    ...rngdleRollPayload({
      roll: input.roll,
      now: now(),
      header: resultCopy.header,
      footer: resultCopy.footer,
    }),
    attachments: [],
  }, fetchImpl);
  if (!fallback.ok) throw new Error(`RNGDLE final text edit failed (${await responseError(fallback)})`);
}

export async function deliverRngdleLeaderboard(input: {
  applicationId: string;
  token: string;
  entries: RngdleLeaderboardEntry[];
  totalPlayers?: number;
  attachmentSizeLimit?: number;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = webhookUrl(input.applicationId, input.token);
  if (input.entries.length === 0) {
    await patchJson(url, {
      content: "No one has rolled RNGDLE in this server yet.",
      allowed_mentions: { parse: [] }, components: [], attachments: [],
    }, fetchImpl);
    return;
  }
  const image = await renderRngdleDiscordLeaderboard(input.entries, input.totalPlayers ?? input.entries.length);
  if (image.byteLength <= safeLimit(input.attachmentSizeLimit)) {
    const response = await patchMultipart(url, {
      content: "🏆 **RNGDLE all-time leaderboard**",
      allowed_mentions: { parse: [] }, components: [],
      attachments: [{ id: 0, filename: RNGDLE_DISCORD_LEADERBOARD_FILENAME, description: "RNGDLE all-time guild leaderboard" }],
    }, image, RNGDLE_DISCORD_LEADERBOARD_FILENAME, "image/png", fetchImpl);
    if (response.ok) return;
  }
  const lines = input.entries.slice(0, 10).map((entry, index) =>
    `**${index + 1}.** ${escapeDiscordText(entry.displayName)} — ${entry.totalEp.toLocaleString("en-US")} EP (${entry.rolls} rolls)`,
  );
  const fallback = await patchJson(url, {
    content: ["🏆 **RNGDLE all-time leaderboard**", ...lines].join("\n"),
    allowed_mentions: { parse: [] }, components: [], attachments: [],
  }, fetchImpl);
  if (!fallback.ok) throw new Error(`RNGDLE leaderboard delivery failed (${await responseError(fallback)})`);
}

export async function deliverRngdleProfile(input: {
  applicationId: string;
  token: string;
  profile: RngdleUserProfile;
  attachmentSizeLimit?: number;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = webhookUrl(input.applicationId, input.token);
  const image = await renderRngdleDiscordProfile(input.profile);
  if (image.byteLength <= safeLimit(input.attachmentSizeLimit)) {
    const response = await patchMultipart(url, {
      content: `👤 **${escapeDiscordText(input.profile.displayName)}'s RNGDLE profile**`,
      allowed_mentions: { parse: [] },
      components: [{ type: 1, components: [{ type: 2, style: 2, label: "Leaderboard", custom_id: RNGDLE_LEADERBOARD_BUTTON_ID }] }],
      attachments: [{ id: 0, filename: RNGDLE_DISCORD_PROFILE_FILENAME, description: `${input.profile.displayName}'s RNGDLE profile` }],
    }, image, RNGDLE_DISCORD_PROFILE_FILENAME, "image/png", fetchImpl);
    if (response.ok) return;
  }
  const fallback = await patchJson(url, {
    content: `👤 **${escapeDiscordText(input.profile.displayName)}** · #${input.profile.allTimeRank}/${input.profile.totalPlayers} · ${input.profile.careerEp.toLocaleString("en-US")} career EP · ${input.profile.games} games`,
    allowed_mentions: { parse: [] }, components: [], attachments: [],
  }, fetchImpl);
  if (!fallback.ok) throw new Error(`RNGDLE profile delivery failed (${await responseError(fallback)})`);
}

/**
 * Ephemeral note posted as a followup rather than an interaction reply, for
 * use once the interaction has already been acknowledged — at that point a
 * type-4 reply is no longer available.
 */
export async function deliverRngdleNotice(input: {
  applicationId: string;
  token: string;
  content: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const apiBase = process.env.BITEDLE_DISCORD_API_BASE_URL || "https://discord.com/api/v10";
  const url = `${apiBase}/webhooks/${encodeURIComponent(input.applicationId)}/${encodeURIComponent(input.token)}`;
  const response = await (input.fetchImpl ?? fetch)(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: input.content, flags: 64, allowed_mentions: { parse: [] } }),
  });
  if (!response.ok) console.warn(`rngdle: notice delivery failed (${await responseError(response)})`);
}

export async function deliverRngdleError(input: {
  applicationId: string;
  token: string;
  content: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const response = await patchJson(webhookUrl(input.applicationId, input.token), {
    content: input.content,
    allowed_mentions: { parse: [] },
    components: [],
    attachments: [],
  }, input.fetchImpl ?? fetch);
  if (!response.ok) throw new Error(`RNGDLE error delivery failed (${await responseError(response)})`);
}
