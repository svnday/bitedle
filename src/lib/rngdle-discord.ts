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
  type RngdleResultCardStats,
} from "./rngdle-discord-renderer";
import { canRerollRngdle, rngdleRerollDeadline } from "./rngdle/time";

const DEFAULT_ATTACHMENT_LIMIT = 8 * 1024 * 1024;
const FINAL_EDIT_MARGIN_MS = 180;
const FINAL_EDIT_RETRY_MS = 250;
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
  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toLocaleString("en-US")} points`;
}

function rngdleResultCopy(roll: RngdleDiscordRoll, rank: number, playerCount: number, newBadges = 0, now = Date.now()): {
  header: string | null;
  footer: string;
} {
  const result = roll.current;
  if (roll.rerolledAt !== null && result.penaltyPercent !== null) {
    return {
      header: null,
      footer: `**Reroll locked · -${result.penaltyPercent}% from ${result.rawEp.toLocaleString("en-US")} base points · ${signedPoints(result.creditedEp - roll.initial.creditedEp)}**`,
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
        accent_color: RNGDLE_MESSAGE_ACCENTS[input.roll.current.rarity],
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
  const animationDelay = (duration: number) => {
    const override = process.env.BITEDLE_RNGDLE_FINAL_EDIT_DELAY_MS;
    return process.env.NODE_ENV !== "production" && override !== undefined
      ? Math.max(0, Number(override) || 0)
      : duration + FINAL_EDIT_MARGIN_MS;
  };
  const waitForAnimation = async (duration: number) => {
    await sleep(animationDelay(duration));
  };

  // The risk animation is rendered and posted before the much heavier roll
  // animation so the reroll button clears as soon as the player commits.
  // Rendering the roll assets afterwards overlaps with its playback.
  let riskAnimation: Buffer | null = null;
  let riskDurationMs = 0;
  let riskPostedAt: number | null = null;

  if (input.riskAnimationPercent !== undefined) {
    try {
      const risk = await renderRisk(input.riskAnimationPercent);
      riskAnimation = risk.animation;
      riskDurationMs = risk.durationMs;
    } catch (error) {
      console.error("rngdle: risk animation rendering failed", error);
    }
  }

  if (riskAnimation && riskAnimation.byteLength <= limit) {
    const riskResponse = await patchMultipart(url, {
      ...rngdleRollPayload({
        roll: input.roll,
        now: now(),
        filename: RNGDLE_DISCORD_RISK_GIF_FILENAME,
        description: "RNGDLE reroll risk selection from 1 to 99 percent",
        footer: `🎲 **${escapeDiscordText(input.roll.displayName)} is rolling the reroll risk…**`,
        includeActions: false,
      }),
      attachments: [{ id: 0, filename: RNGDLE_DISCORD_RISK_GIF_FILENAME, description: "RNGDLE reroll risk selection from 1 to 99 percent" }],
    }, riskAnimation, RNGDLE_DISCORD_RISK_GIF_FILENAME, "image/gif", fetchImpl);
    if (riskResponse.ok) riskPostedAt = now();
    else console.warn(`rngdle: risk animation edit failed (${await responseError(riskResponse)})`);
  } else if (riskAnimation) {
    console.warn(`rngdle: risk animation exceeded the interaction attachment limit (${limit} bytes)`);
  }

  let animation: Buffer | null = null;
  let durationMs = 0;

  if (input.animate) {
    try {
      const rendered = await renderRngdleDiscordAnimation(
        input.roll.current,
        input.roll.displayName,
        input.rank,
        input.playerCount,
        input.stats,
      );
      animation = rendered.animation;
      durationMs = rendered.durationMs;
    } catch (error) {
      // A failed GIF still leaves the final card worth delivering.
      console.error("rngdle: animation rendering failed", error);
    }
  }

  if (riskPostedAt !== null) {
    await sleep(Math.max(0, animationDelay(riskDurationMs) - (now() - riskPostedAt)));
  }

  let animationPosted = false;
  if (animation && animation.byteLength <= limit) {
    const animationCopy = input.roll.rerolledAt === null
      ? { header: `🎰 **${escapeDiscordText(input.roll.displayName)} is rolling…**`, footer: "" }
      : { header: null, footer: `🎰 **${escapeDiscordText(input.roll.displayName)}'s rerolled number is landing…**` };
    const animationResponse = await patchMultipart(url, {
      ...rngdleRollPayload({
        roll: input.roll,
        now: now(),
        filename: RNGDLE_DISCORD_GIF_FILENAME,
        description: "RNGDLE number and badge reveal",
        ...animationCopy,
        includeActions: input.roll.rerolledAt === null,
      }),
      attachments: [{ id: 0, filename: RNGDLE_DISCORD_GIF_FILENAME, description: "RNGDLE number and badge reveal" }],
    }, animation, RNGDLE_DISCORD_GIF_FILENAME, "image/gif", fetchImpl);
    animationPosted = animationResponse.ok;
    if (!animationResponse.ok) console.warn(`rngdle: animation edit failed (${await responseError(animationResponse)})`);
  } else if (animation) {
    console.warn(`rngdle: animation exceeded the interaction attachment limit (${limit} bytes)`);
  }

  // Rendered once the GIF is already on screen, so it costs playback time
  // rather than delaying the first edit.
  const pendingStill = renderRngdleDiscordStill(
    input.roll.current,
    input.roll.displayName,
    input.rank,
    input.playerCount,
    input.stats,
  ).then((buffer) => ({ buffer }), (error: unknown) => ({ error }));

  if (animationPosted) {
    await waitForAnimation(durationMs);
  }

  const rendered = await pendingStill;
  if (!("buffer" in rendered)) {
    console.error("rngdle: image rendering failed", rendered.error);
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
  const still = rendered.buffer;

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
      if (response.ok) return;
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

async function avatarDataUrl(profile: RngdleUserProfile, fetchImpl: typeof fetch): Promise<string | null> {
  if (!profile.avatar) return null;
  try {
    const response = await fetchImpl(`https://cdn.discordapp.com/avatars/${profile.userId}/${profile.avatar}.png?size=128`);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "image/png";
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
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
  const image = await renderRngdleDiscordProfile(
    input.profile,
    await avatarDataUrl(input.profile, fetchImpl),
  );
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
    content: `👤 **${escapeDiscordText(input.profile.displayName)}** · #${input.profile.allTimeRank}/${input.profile.totalPlayers} · ${input.profile.careerEp.toLocaleString("en-US")} career points · ${input.profile.games} games`,
    allowed_mentions: { parse: [] }, components: [], attachments: [],
  }, fetchImpl);
  if (!fallback.ok) throw new Error(`RNGDLE profile delivery failed (${await responseError(fallback)})`);
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
