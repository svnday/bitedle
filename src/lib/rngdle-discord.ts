import type { RngdleDiscordRoll, RngdleLeaderboardEntry, RngdleUserProfile } from "./rngdle-discord-store";
import {
  RNGDLE_DISCORD_GIF_FILENAME,
  RNGDLE_DISCORD_LEADERBOARD_FILENAME,
  RNGDLE_DISCORD_PNG_FILENAME,
  RNGDLE_DISCORD_PROFILE_FILENAME,
  renderRngdleDiscordAssets,
  renderRngdleDiscordLeaderboard,
  renderRngdleDiscordProfile,
  renderRngdleDiscordStill,
  type RngdleResultCardStats,
} from "./rngdle-discord-renderer";
import { canRerollRngdle } from "./rngdle/time";

const DEFAULT_ATTACHMENT_LIMIT = 8 * 1024 * 1024;
const FINAL_EDIT_MARGIN_MS = 180;
const FINAL_EDIT_RETRY_MS = 250;

export const RNGDLE_REROLL_CUSTOM_ID_PREFIX = "rngdle-reroll:v1:";
export const RNGDLE_REROLL_BUTTON_LABEL = "Reroll 1-99% Risk";
export const RNGDLE_LEADERBOARD_BUTTON_ID = "rngdle-leaderboard:v1";
export const RNGDLE_PROFILE_BUTTON_ID = "rngdle-profile:v1";

export function rngdleRerollCustomId(gameDay: string, userId: string): string {
  return `${RNGDLE_REROLL_CUSTOM_ID_PREFIX}${gameDay}:${userId}`;
}

export function parseRngdleRerollCustomId(customId: string): { gameDay: string; userId: string } | null {
  if (!customId.startsWith(RNGDLE_REROLL_CUSTOM_ID_PREFIX)) return null;
  const payload = customId.slice(RNGDLE_REROLL_CUSTOM_ID_PREFIX.length);
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
  if (canRerollRngdle(roll.initialRolledAt, roll.rerolledAt, now)) {
    buttons.push({
      type: 2,
      style: 4,
      label: RNGDLE_REROLL_BUTTON_LABEL,
      custom_id: rngdleRerollCustomId(roll.gameDay, roll.userId),
    });
  }
  buttons.push(
    { type: 2, style: 2, label: "Leaderboard", custom_id: RNGDLE_LEADERBOARD_BUTTON_ID },
    { type: 2, style: 1, label: "My Profile", custom_id: RNGDLE_PROFILE_BUTTON_ID },
  );
  return [{
    type: 1,
    components: buttons,
  }];
}

export function rngdleResultContent(roll: RngdleDiscordRoll, rank: number, playerCount: number, newBadges = 0): string {
  const result = roll.current;
  const penalty = result.penaltyPercent === null
    ? ""
    : ` after a **${result.penaltyPercent}%** reroll risk (${result.rawEp.toLocaleString("en-US")} raw EP)`;
  return [
    `🎰 **${escapeDiscordText(roll.displayName)} rolled ${result.number.toLocaleString("en-US")}**`,
    `**${result.creditedEp.toLocaleString("en-US")} EP**${penalty} · ${result.badges.length} badges · today's guild rank **#${rank}/${playerCount}**`,
    `**+${newBadges}** new ${newBadges === 1 ? "badge" : "badges"} discovered`,
  ].join("\n");
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
  attachmentSizeLimit?: number;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const sleep = input.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const now = input.now ?? Date.now;
  const url = webhookUrl(input.applicationId, input.token);
  const limit = safeLimit(input.attachmentSizeLimit);
  const content = rngdleResultContent(input.roll, input.rank, input.playerCount, input.stats.newBadges);
  let still: Buffer;
  let animation: Buffer | null = null;
  let durationMs = 0;

  try {
    if (input.animate) {
      const assets = await renderRngdleDiscordAssets(
        input.roll.current,
        input.roll.displayName,
        input.rank,
        input.playerCount,
        input.stats,
      );
      animation = assets.animation;
      still = assets.still;
      durationMs = assets.durationMs;
    } else {
      still = await renderRngdleDiscordStill(
        input.roll.current,
        input.roll.displayName,
        input.rank,
        input.playerCount,
        input.stats,
      );
    }
  } catch (error) {
    console.error("rngdle: image rendering failed", error);
    const fallback = await patchJson(url, {
      content,
      allowed_mentions: { parse: [] },
      components: resultComponents(input.roll, now()),
      attachments: [],
    }, fetchImpl);
    if (!fallback.ok) throw new Error(`RNGDLE text fallback failed (${await responseError(fallback)})`);
    return;
  }

  let animationPosted = false;
  if (animation && animation.byteLength <= limit) {
    const animationResponse = await patchMultipart(url, {
      content: `🎰 **${escapeDiscordText(input.roll.displayName)} is rolling…**`,
      allowed_mentions: { parse: [] },
      components: resultComponents(input.roll, now()),
      attachments: [{ id: 0, filename: RNGDLE_DISCORD_GIF_FILENAME, description: "RNGDLE number and badge reveal" }],
    }, animation, RNGDLE_DISCORD_GIF_FILENAME, "image/gif", fetchImpl);
    animationPosted = animationResponse.ok;
    if (!animationResponse.ok) console.warn(`rngdle: animation edit failed (${await responseError(animationResponse)})`);
  } else if (animation) {
    console.warn(`rngdle: animation exceeded the interaction attachment limit (${limit} bytes)`);
  }

  if (animationPosted) {
    const override = process.env.BITEDLE_RNGDLE_FINAL_EDIT_DELAY_MS;
    const delay = process.env.NODE_ENV !== "production" && override !== undefined
      ? Math.max(0, Number(override) || 0)
      : durationMs + FINAL_EDIT_MARGIN_MS;
    await sleep(delay);
  }

  if (still.byteLength <= limit) {
    const finalPayload = {
      content,
      allowed_mentions: { parse: [] },
      components: resultComponents(input.roll, now()),
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
    content,
    allowed_mentions: { parse: [] },
    components: resultComponents(input.roll, now()),
    attachments: [],
  }, fetchImpl);
  if (!fallback.ok) throw new Error(`RNGDLE final text edit failed (${await responseError(fallback)})`);
}

export async function deliverRngdleLeaderboard(input: {
  applicationId: string;
  token: string;
  entries: RngdleLeaderboardEntry[];
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
  const image = await renderRngdleDiscordLeaderboard(input.entries);
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
