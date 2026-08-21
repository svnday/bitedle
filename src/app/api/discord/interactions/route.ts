import { NextResponse, type NextRequest, after } from "next/server";
import { verifyKey } from "discord-interactions";
import { puzzleNumber, todayStr } from "@/lib/game";
import { shiftDay } from "@/lib/time";
import type { GameRecord } from "@/lib/types";
import { shareText } from "@/lib/share-text";
import { renderSummaryImage, sortTodayRows } from "@/lib/discord-summary";
import { LAUNCH_BUTTON_ID, updateLivePreviewMessage } from "@/lib/discord-live-preview";
import { isBlockedDiscordId } from "@/lib/discord";
import { getStore } from "@/lib/store";
import type { GameMode } from "@/lib/types";
import {
  BITERACER_CHALLENGE_TTL_MS,
  acceptRace,
  declineRace,
  expireRace,
  racePlayer,
  randomRacePassage,
} from "@/lib/biteracer-race";
import type { BiteracerRaceRecord } from "@/lib/types";
import { updateBiteracerPreview } from "@/lib/biteracer-discord-preview";
import {
  BITEFIGHT_CHALLENGE_TTL_MS,
  acceptBitefight,
  bitefightPlayer,
  declineBitefight,
  expireBitefight,
  hasActiveBitefight,
} from "@/lib/bitefight";
import type { BitefightRecord } from "@/lib/types";
import { updateBitefightPreview } from "@/lib/bitefight-discord-preview";
import {
  acceptBiteshooter,
  biteshooterPlayer,
  declineBiteshooter,
  hasActiveBiteshooter,
  settleBiteshooter,
} from "@/lib/biteshooter";
import type { BiteshooterRecord } from "@/lib/types";
import { updateBiteshooterPreview } from "@/lib/biteshooter-discord-preview";
import {
  beginBitesweeperPreview,
  updateBitesweeperPreview,
  BITESWEEPER_LAUNCH_BUTTON_ID,
  BITESWEEPER_WEBHOOK_TOKEN_TTL_MS,
  type BitesweeperPreviewPlayer,
} from "@/lib/bitesweeper-discord-preview";
import { BITEBALL_MAX_QUESTION_LENGTH, selectBiteballAnswer } from "@/lib/biteball";
import { deliverBiteballResponse } from "@/lib/biteball-discord";
import {
  deliverRngdleLeaderboard,
  deliverRngdleError,
  deliverRngdleNotice,
  deliverRngdleProfile,
  deliverRngdleRoll,
  parseRngdleReplayCustomId,
  parseRngdleRerollCustomId,
  RNGDLE_LEADERBOARD_BUTTON_ID,
  RNGDLE_PROFILE_BUTTON_ID,
  RNGDLE_REPLAY_CUSTOM_ID_PREFIX,
  RNGDLE_REROLL_CUSTOM_ID_PREFIX,
  takePendingRngdlePenalty,
} from "@/lib/rngdle-discord";
import { getRngdleDiscordRepository } from "@/lib/rngdle-discord-store";
import { scoreRngdleNumber, selectRngdleNumber, selectRngdlePenalty } from "@/lib/rngdle/scoring";
import { canRerollRngdle, rngdleGameDay, rngdleNextResetAt } from "@/lib/rngdle/time";

// Imports next/og (via discord-summary) for the preview image — needs Node.
export const runtime = "nodejs";
// RNGDLE's deferred delivery renders a GIF, waits out its playback, then posts
// the final card — comfortably longer than the old 60s ceiling on a cold,
// CPU-constrained instance, which killed the function mid-render and left the
// interaction stuck on "thinking…".
export const maxDuration = 120;

function siteUrl(): string {
  // VERCEL_URL is the unique URL of *this* deployment, not the stable
  // production domain, so it's deliberately not used as a fallback here.
  return process.env.NEXT_PUBLIC_SITE_URL || "https://bitedle.vercel.app";
}

function reply(content: string, ephemeral = false) {
  return NextResponse.json({
    type: 4,
    data: {
      content,
      allowed_mentions: { parse: [] },
      ...(ephemeral ? { flags: 64 } : {}),
    },
  });
}

interface InteractionUser {
  id?: string;
  username?: string;
  global_name?: string | null;
  avatar?: string | null;
  bot?: boolean;
}

interface Interaction {
  type: number;
  data?: {
    name?: string;
    custom_id?: string;
    options?: { name: string; value?: string; options?: { name: string; value?: string }[] }[];
    resolved?: { users?: Record<string, InteractionUser> };
  };
  member?: { user?: InteractionUser };
  user?: InteractionUser;
  channel_id?: string;
  guild_id?: string;
  /** Present on all interactions — needed for interaction-webhook posts/edits. */
  application_id?: string;
  token?: string;
  attachment_size_limit?: number;
}

const BITERACER_JOIN_PREFIX = "biteracer-join:";
const BITERACER_DECLINE_PREFIX = "biteracer-decline:";
const BITEFIGHT_JOIN_PREFIX = "bitefight-join:";
const BITEFIGHT_DECLINE_PREFIX = "bitefight-decline:";
const BITESHOOTER_JOIN_PREFIX = "biteshooter-join:";
const BITESHOOTER_DECLINE_PREFIX = "biteshooter-decline:";

function interactionName(user: InteractionUser | undefined): string {
  return user?.global_name ?? user?.username ?? "Player";
}

async function handleBiteracerChallenge(body: Interaction): Promise<NextResponse> {
  const challenger = body.member?.user ?? body.user;
  const opponentValue = body.data?.options?.find(
    (option) => option.name === "opponent",
  )?.value;
  const opponentId = typeof opponentValue === "string" ? opponentValue : undefined;
  const opponent = opponentId ? body.data?.resolved?.users?.[opponentId] : undefined;
  if (!challenger?.id || !opponentId || !opponent) {
    return reply("Couldn't identify both racers. Try the command again.", true);
  }
  if (challenger.id === opponentId) return reply("You can't race yourself.", true);
  if (opponent.bot) return reply("Bots are quick, but they can't enter Biteracer.", true);

  const now = Date.now();
  const store = getStore();
  const raceHistory = (await store.allBiteracerRaces()).sort(
    (a, b) => a.createdAt - b.createdAt,
  );
  const race: BiteracerRaceRecord = {
    id: crypto.randomUUID(),
    revision: 0,
    guildId: body.guild_id ?? null,
    channelId: body.channel_id ?? null,
    passage: randomRacePassage(raceHistory.map((previous) => previous.passage.id)),
    status: "pending",
    createdAt: now,
    acceptedAt: null,
    countdownAt: null,
    startedAt: null,
    finishedAt: null,
    winnerDiscordUserId: null,
    rematchOf: null,
    preview:
      body.application_id && body.token
        ? {
            applicationId: body.application_id,
            webhookToken: body.token,
            tokenCreatedAt: now,
          }
        : null,
    players: [
      racePlayer({
        discordUserId: challenger.id,
        name: interactionName(challenger),
        avatar: challenger.avatar ?? null,
      }),
      racePlayer({
        discordUserId: opponentId,
        name: interactionName(opponent),
        avatar: opponent.avatar ?? null,
      }),
    ],
  };
  await store.createBiteracerRace(race);
  return NextResponse.json({
    type: 4,
    data: {
      content: `🏁 <@${opponentId}> — **${race.players[0].name}** challenged you to a Biteracer 1v1!`,
      // Deliberately allow exactly one notification: the selected opponent
      // on the initial challenge. All preview edits and later replies keep
      // allowed_mentions.parse empty, so the race cannot repeatedly ping.
      allowed_mentions: { users: [opponentId] },
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 3,
              label: "Accept / Join race",
              custom_id: `${BITERACER_JOIN_PREFIX}${race.id}`,
            },
            {
              type: 2,
              style: 4,
              label: "Decline",
              custom_id: `${BITERACER_DECLINE_PREFIX}${race.id}`,
            },
          ],
        },
      ],
    },
  });
}

async function handleBiteracerButton(body: Interaction): Promise<NextResponse> {
  const customId = body.data?.custom_id ?? "";
  const decline = customId.startsWith(BITERACER_DECLINE_PREFIX);
  const raceId = customId.slice(
    decline ? BITERACER_DECLINE_PREFIX.length : BITERACER_JOIN_PREFIX.length,
  );
  const callerId = body.member?.user?.id ?? body.user?.id;
  const store = getStore();
  const race = await store.getBiteracerRace(raceId);
  if (!callerId || !race) return reply("That race no longer exists.", true);
  const playerIndex = race.players.findIndex((player) => player.discordUserId === callerId);
  if (playerIndex < 0) return reply("Only the two challenged racers can use these buttons.", true);
  if (race.status === "pending" && Date.now() - race.createdAt > BITERACER_CHALLENGE_TTL_MS) {
    await expireRace(race.id);
    after(() => updateBiteracerPreview(race.id, true));
    return reply("That challenge expired. Start a new one with /biteracer.", true);
  }

  if (decline) {
    try {
      await declineRace(race.id, callerId);
    } catch {
      return reply("This race can no longer be declined.", true);
    }
    after(() => updateBiteracerPreview(race.id, true));
    return reply("Race declined.", true);
  }

  if (race.status === "pending") {
    if (playerIndex !== 1) return reply("Waiting for your opponent to accept.", true);
    try {
      await acceptRace(race.id, callerId);
    } catch {
      return reply("This challenge can no longer be accepted.", true);
    }
    after(() => updateBiteracerPreview(race.id, true));
  }
  const current = await store.getBiteracerRace(race.id);
  if (!current || !["accepted", "countdown", "racing"].includes(current.status)) {
    return reply("That race is already over.", true);
  }
  await Promise.all([
    store.clearBitefightLaunch(callerId),
    store.clearBiteshooterLaunch(callerId),
  ]);
  await store.setBiteracerRaceLaunch(callerId, current.id, Date.now());
  return NextResponse.json({ type: 12 });
}

async function handleBitefightChallenge(body: Interaction): Promise<NextResponse> {
  const challenger = body.member?.user ?? body.user;
  const opponentValue = body.data?.options?.find(
    (option) => option.name === "opponent",
  )?.value;
  const opponentId = typeof opponentValue === "string" ? opponentValue : undefined;
  const opponent = opponentId ? body.data?.resolved?.users?.[opponentId] : undefined;
  if (!challenger?.id || !opponentId || !opponent) {
    return reply("Couldn't identify both fighters. Try the command again.", true);
  }
  if (challenger.id === opponentId) return reply("You can't fight yourself.", true);
  if (opponent.bot) return reply("Bots aren't allowed in the Bitefight ring.", true);
  if (await hasActiveBitefight(challenger.id)) {
    return reply("Finish your current Bitefight before starting another.", true);
  }
  if (await hasActiveBitefight(opponentId)) {
    return reply("That player is already in an active Bitefight.", true);
  }

  const now = Date.now();
  const match: BitefightRecord = {
    id: crypto.randomUUID(),
    revision: 0,
    guildId: body.guild_id ?? null,
    channelId: body.channel_id ?? null,
    status: "pending",
    createdAt: now,
    acceptedAt: null,
    countdownAt: null,
    startedAt: null,
    finishedAt: null,
    winnerDiscordUserId: null,
    finishReason: null,
    rematchOf: null,
    rematchMatchId: null,
    preview:
      body.application_id && body.token
        ? {
            applicationId: body.application_id,
            webhookToken: body.token,
            tokenCreatedAt: now,
          }
        : null,
    players: [
      bitefightPlayer({
        discordUserId: challenger.id,
        name: interactionName(challenger),
        avatar: challenger.avatar ?? null,
      }),
      bitefightPlayer({
        discordUserId: opponentId,
        name: interactionName(opponent),
        avatar: opponent.avatar ?? null,
      }),
    ],
  };
  await getStore().createBitefight(match);
  after(() => updateBitefightPreview(match.id, true));
  return NextResponse.json({
    type: 4,
    data: {
      content: `🥊 <@${opponentId}> — **${match.players[0].name}** challenged you to a Bitefight!`,
      // The initial challenge is the only Bitefight message allowed to notify.
      // Every live-preview edit and later reply explicitly suppresses mentions.
      allowed_mentions: { users: [opponentId] },
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 3,
              label: "Accept / Enter ring",
              custom_id: `${BITEFIGHT_JOIN_PREFIX}${match.id}`,
            },
            {
              type: 2,
              style: 4,
              label: "Decline",
              custom_id: `${BITEFIGHT_DECLINE_PREFIX}${match.id}`,
            },
          ],
        },
      ],
    },
  });
}

async function handleBitefightButton(body: Interaction): Promise<NextResponse> {
  const customId = body.data?.custom_id ?? "";
  const decline = customId.startsWith(BITEFIGHT_DECLINE_PREFIX);
  const matchId = customId.slice(
    decline ? BITEFIGHT_DECLINE_PREFIX.length : BITEFIGHT_JOIN_PREFIX.length,
  );
  const callerId = body.member?.user?.id ?? body.user?.id;
  const store = getStore();
  const match = await store.getBitefight(matchId);
  if (!callerId || !match) return reply("That fight no longer exists.", true);
  const playerIndex = match.players.findIndex((player) => player.discordUserId === callerId);
  if (playerIndex < 0) return reply("Only the two fighters can use these buttons.", true);
  if (match.status === "pending" && Date.now() - match.createdAt >= BITEFIGHT_CHALLENGE_TTL_MS) {
    await expireBitefight(match.id);
    after(() => updateBitefightPreview(match.id, true));
    return reply("That challenge expired. Start a new one with /bitefight.", true);
  }

  if (decline) {
    try {
      await declineBitefight(match.id, callerId);
      after(() => updateBitefightPreview(match.id, true));
      return reply("Bitefight declined.", true);
    } catch {
      return reply("This fight can no longer be declined.", true);
    }
  }

  if (match.status === "pending") {
    if (playerIndex !== 1) return reply("Waiting for your opponent to accept.", true);
    try {
      await acceptBitefight(match.id, callerId);
      after(() => updateBitefightPreview(match.id, true));
    } catch {
      return reply("This challenge can no longer be accepted.", true);
    }
  }
  const current = await store.getBitefight(match.id);
  if (!current || !["accepted", "countdown", "fighting"].includes(current.status)) {
    return reply("That fight is already over.", true);
  }
  await Promise.all([
    store.clearBiteracerRaceLaunch(callerId),
    store.clearBiteshooterLaunch(callerId),
  ]);
  await store.setBitefightLaunch(callerId, current.id, Date.now());
  return NextResponse.json({ type: 12 });
}

async function handleBiteshooterChallenge(body: Interaction): Promise<NextResponse> {
  const challenger = body.member?.user ?? body.user;
  const opponentValue = body.data?.options?.find(
    (option) => option.name === "opponent",
  )?.value;
  const opponentId = typeof opponentValue === "string" ? opponentValue : undefined;
  const opponent = opponentId ? body.data?.resolved?.users?.[opponentId] : undefined;
  if (!challenger?.id || !opponentId || !opponent) {
    return reply("Couldn't identify both shooters. Try the command again.", true);
  }
  if (challenger.id === opponentId) return reply("You can't challenge yourself.", true);
  if (opponent.bot) return reply("Bots aren't allowed in a Biteshooter duel.", true);

  // Biteshooter has its own active-match lock. Playing Classic, Bitesweeper,
  // Biteracer, or Bitefight never blocks this challenge.
  if (await hasActiveBiteshooter(challenger.id)) {
    return reply("Finish your current Biteshooter before starting another.", true);
  }
  if (await hasActiveBiteshooter(opponentId)) {
    return reply("That player is already in an active Biteshooter.", true);
  }

  const now = Date.now();
  const match: BiteshooterRecord = {
    id: crypto.randomUUID(),
    revision: 0,
    guildId: body.guild_id ?? null,
    channelId: body.channel_id ?? null,
    status: "pending",
    seed: crypto.randomUUID(),
    createdAt: now,
    acceptedAt: null,
    countdownAt: null,
    startedAt: null,
    finishedAt: null,
    winnerDiscordUserId: null,
    finishReason: null,
    rematchOf: null,
    rematchMatchId: null,
    preview:
      body.application_id && body.token
        ? {
            applicationId: body.application_id,
            webhookToken: body.token,
            tokenCreatedAt: now,
          }
        : null,
    players: [
      biteshooterPlayer({
        discordUserId: challenger.id,
        name: interactionName(challenger),
        avatar: challenger.avatar ?? null,
      }),
      biteshooterPlayer({
        discordUserId: opponentId,
        name: interactionName(opponent),
        avatar: opponent.avatar ?? null,
      }),
    ],
  };

  // The preliminary checks above settle expired matches and provide specific
  // feedback. This atomic insert closes the race between simultaneous slash
  // commands so the same player cannot enter two active Biteshooters.
  if (!(await getStore().createBiteshooterIfPlayersAvailable(match))) {
    return reply("One of you is already in an active Biteshooter.", true);
  }

  after(() => updateBiteshooterPreview(match.id, true));
  return NextResponse.json({
    type: 4,
    data: {
      content: `🎯 <@${opponentId}> — **${match.players[0].name}** challenged you to a Biteshooter 1v1! You have one minute to accept.`,
      // This initial challenge is the only Biteshooter message allowed to
      // notify. Preview edits and every later interaction suppress mentions.
      allowed_mentions: { users: [opponentId] },
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 3,
              label: "Accept / Join duel",
              custom_id: `${BITESHOOTER_JOIN_PREFIX}${match.id}`,
            },
            {
              type: 2,
              style: 4,
              label: "Decline",
              custom_id: `${BITESHOOTER_DECLINE_PREFIX}${match.id}`,
            },
          ],
        },
      ],
    },
  });
}

async function handleBiteshooterButton(body: Interaction): Promise<NextResponse> {
  const customId = body.data?.custom_id ?? "";
  const decline = customId.startsWith(BITESHOOTER_DECLINE_PREFIX);
  const matchId = customId.slice(
    decline ? BITESHOOTER_DECLINE_PREFIX.length : BITESHOOTER_JOIN_PREFIX.length,
  );
  const callerId = body.member?.user?.id ?? body.user?.id;
  const store = getStore();
  const existing = await store.getBiteshooter(matchId);
  if (!callerId || !existing) return reply("That Biteshooter duel no longer exists.", true);
  const playerIndex = existing.players.findIndex(
    (player) => player.discordUserId === callerId,
  );
  if (playerIndex < 0) {
    return reply("Only the two challenged shooters can use these buttons.", true);
  }

  // Settlement is request-driven: it covers both the one-minute acceptance
  // deadline and the one-minute accepted-but-unjoined deadline before a stale
  // button is allowed to launch anything.
  const match = await settleBiteshooter(existing.id);
  if (match.status === "expired") {
    after(() => updateBiteshooterPreview(match.id, true));
    return reply("That challenge expired. Start a new one with /biteshooter.", true);
  }
  if (match.status === "cancelled") {
    after(() => updateBiteshooterPreview(match.id, true));
    return reply(
      existing.status === "accepted"
        ? "That duel was cancelled because one or both players did not join within one minute."
        : "That Biteshooter duel was cancelled.",
      true,
    );
  }

  if (decline) {
    try {
      await declineBiteshooter(match.id, callerId);
      after(() => updateBiteshooterPreview(match.id, true));
      return reply("Biteshooter challenge declined.", true);
    } catch {
      return reply("This duel can no longer be declined.", true);
    }
  }

  if (match.status === "pending") {
    if (playerIndex !== 1) return reply("Waiting for your opponent to accept.", true);
    try {
      await acceptBiteshooter(match.id, callerId);
      after(() => updateBiteshooterPreview(match.id, true));
    } catch {
      return reply("This challenge can no longer be accepted.", true);
    }
  }

  const current = await settleBiteshooter(match.id);
  if (!["accepted", "countdown", "fighting"].includes(current.status)) {
    return reply("That Biteshooter duel is already over.", true);
  }

  // A fresh participant-specific marker wins over this caller's older duel
  // markers without touching any underlying Bitefight/Biteracer match.
  await Promise.all([
    store.clearBitefightLaunch(callerId),
    store.clearBiteracerRaceLaunch(callerId),
  ]);
  await store.setBiteshooterLaunch(callerId, current.id, Date.now());
  return NextResponse.json({ type: 12 });
}

function bitesweeperFallbackPlayers(body: Interaction): BitesweeperPreviewPlayer[] {
  const interactionUser = body.member?.user ?? body.user;
  return interactionUser?.id
    ? [{
        userId: interactionUser.id,
        date: todayStr(),
        name: interactionUser.global_name ?? interactionUser.username ?? "A player",
        discordUserId: interactionUser.id,
        discordAvatar: interactionUser.avatar ?? null,
        clicks: [],
        flags: [],
      }]
    : [];
}

async function startBitesweeperPreview(
  body: Interaction,
  onlyIfStale = false,
): Promise<void> {
  if (!body.guild_id || !body.application_id || !body.token) return;
  if (onlyIfStale) {
    const existing = await getStore().getBitesweeperPreview(body.guild_id);
    if (existing && Date.now() - existing.tokenCreatedAt < BITESWEEPER_WEBHOOK_TOKEN_TTL_MS) {
      return;
    }
  }
  await beginBitesweeperPreview({
    guildId: body.guild_id,
    interaction: { applicationId: body.application_id, token: body.token },
  });
  const guildId = body.guild_id;
  const fallbackPlayers = bitesweeperFallbackPlayers(body);
  after(() =>
    updateBitesweeperPreview({ guildId, fallbackPlayers }).catch((e) => {
      console.error(`interactions: Bitesweeper preview failed for guild ${guildId}`, e);
    }),
  );
}

async function handleShare(body: Interaction): Promise<NextResponse> {
  const discordUserId: string | undefined = body?.member?.user?.id ?? body?.user?.id;
  if (!discordUserId) return reply("Couldn't identify you — try again.", true);

  const store = getStore();
  const userId = await store.getUserIdByDiscordId(discordUserId);
  if (!userId) {
    return reply(
      `Play today's Bitedle first with /play, then come back and share your result! ${siteUrl()}`,
      true,
    );
  }

  // A Discord interaction carries no browser timezone, so we can't know the
  // player's local day. Their current puzzle is within ±1 of the server day
  // (the timezone range), so scan those three and share their newest finished
  // result — works whatever timezone they reset on.
  const today = todayStr();
  let best: GameRecord | null = null;
  let bestDate = today;
  for (const d of [shiftDay(today, 1), today, shiftDay(today, -1)]) {
    const g = await store.getGame(d, userId);
    if (g && g.status !== "playing" && (!best || (g.finishedAt ?? 0) > (best.finishedAt ?? 0))) {
      best = g;
      bestDate = d;
    }
  }
  if (!best) {
    return reply("You haven't finished today's Bitedle yet — run /play!", true);
  }

  const misses = best.clicks.filter((c) => c.result === "x").length;
  return reply(
    shareText({ puzzleNumber: puzzleNumber(bestDate), status: best.status, score: best.score, misses }),
  );
}

/**
 * Records which game the caller just asked for, so their booting Activity
 * client picks it over the channel's shared instance mode (channel-mates can
 * play different games at once). viaEntryPoint marks the generic "play"
 * command, which Discord's App Launcher also fires — that weaker signal must
 * not yank the user out of a game they're already in. Awaited, not after() —
 * serverless.
 */
async function recordIntent(
  body: Interaction,
  mode: GameMode,
  viaEntryPoint: boolean,
): Promise<void> {
  const callerId = body.member?.user?.id ?? body.user?.id;
  if (!callerId) return;
  try {
    const store = getStore();
    await store.recordLaunchIntent(callerId, mode, Date.now(), viaEntryPoint);
    // Strong, explicit Classic/Bitesweeper launches supersede this caller's
    // participant-specific duel marker without cancelling any underlying
    // match. The App Launcher's generic /play signal is deliberately weak:
    // reopening Discord must resume the caller's active duel.
    if (!viaEntryPoint) {
      await Promise.all([
        store.clearBitefightLaunch(callerId),
        store.clearBiteracerRaceLaunch(callerId),
        store.clearBiteshooterLaunch(callerId),
      ]);
    }
  } catch (e) {
    console.warn("interactions: failed to record launch intent", e);
  }
}

/**
 * Launches the Activity (response type 12) and refreshes the live channel
 * preview off the response path, riding this interaction's webhook token —
 * Bitedle has no bot member in these servers, so the interaction webhook is
 * the only way to put a message in the channel (same trick as /results).
 */
function launchActivity(body: Interaction): NextResponse {
  if (body.guild_id && body.application_id && body.token) {
    const guildId = body.guild_id;
    const interaction = { applicationId: body.application_id, token: body.token };
    after(() =>
      updateLivePreviewMessage({ guildId, interaction }).catch((e) => {
        console.error(`interactions: live preview update failed for guild ${guildId}`, e);
      }),
    );
  }
  return NextResponse.json({ type: 12 }); // LAUNCH_ACTIVITY
}

/**
 * /results — on demand, renders the day's channel-stats summary image (same
 * style as the daily recap) and edits it into the deferred
 * reply. Unlike the launch preview this is never throttled — the caller asked
 * for it explicitly. Uses the interaction webhook (not a bot channel post), so
 * it also works where the app is user-installed and the bot isn't a member.
 */
async function postResults(guildId: string, appId: string, token: string): Promise<void> {
  const editUrl = `https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`;
  try {
    const date = todayStr();
    const rows = await getStore().finishedGamesOn(date, guildId);

    if (rows.length === 0) {
      await fetch(editUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "No one's finished today's Bitedle yet — be the first!" }),
      });
      return;
    }

    const pngBuffer = await renderSummaryImage(sortTodayRows(rows), date).arrayBuffer();
    const form = new FormData();
    form.append(
      "payload_json",
      JSON.stringify({
        content: `📊 Bitedle #${puzzleNumber(date)} — today's results`,
        allowed_mentions: { parse: [] },
        // Replace the deferred message's (empty) attachment set with our image.
        attachments: [{ id: 0, filename: "results.png" }],
      }),
    );
    form.append("files[0]", new Blob([pngBuffer], { type: "image/png" }), "results.png");

    const res = await fetch(editUrl, { method: "PATCH", body: form }); // fetch sets the multipart boundary
    if (!res.ok) {
      console.error(`/results: webhook edit failed (${res.status}): ${await res.text()}`);
    }
  } catch (e) {
    console.error(`/results: render/edit error for guild ${guildId}`, e);
    // Best effort: turn the perpetual "thinking…" state into a readable error.
    await fetch(editUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Couldn't build today's results just now — try again in a moment." }),
    }).catch(() => {});
  }
}

function handleResults(body: Interaction): NextResponse {
  if (!body.guild_id) {
    return reply("Run /results in a server to see that server's Bitedle results for today.", true);
  }
  if (!body.application_id || !body.token) {
    return reply("Couldn't build results right now — try again.", true);
  }
  const guildId = body.guild_id;
  const appId = body.application_id;
  const token = body.token;
  // Defer (Discord shows "thinking…"), then edit in the image from after() so
  // the render/post never blocks past Discord's 3s window.
  after(() => postResults(guildId, appId, token));
  return NextResponse.json({ type: 5 }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
}

function handleBiteball(body: Interaction): NextResponse {
  const questionValue = body.data?.options?.find(
    (option) => option.name === "question",
  )?.value;
  const question = typeof questionValue === "string" ? questionValue.trim() : "";

  if (!question) {
    return reply("Give Biteball a question to answer.", true);
  }
  if (question.length > BITEBALL_MAX_QUESTION_LENGTH) {
    return reply(
      `Keep your Biteball question to ${BITEBALL_MAX_QUESTION_LENGTH} characters or fewer.`,
      true,
    );
  }
  if (!body.application_id || !body.token) {
    return reply("Biteball couldn't consult the oracle just now — try again.", true);
  }

  // Pick once before background delivery so the animation, still, message
  // text, and any fallback all receive the same answer.
  const answer = selectBiteballAnswer();
  const delivery = {
    applicationId: body.application_id,
    token: body.token,
    question,
    answer,
    attachmentSizeLimit: body.attachment_size_limit,
  };
  after(() =>
    deliverBiteballResponse(delivery).catch((error) => {
      console.error("biteball: deferred response delivery failed", error);
    }),
  );

  // A normal deferred message, never a LAUNCH_ACTIVITY response.
  return NextResponse.json({ type: 5 });
}

function rngdleDeliveryRank(
  standings: Awaited<ReturnType<ReturnType<typeof getRngdleDiscordRepository>["dailyStandings"]>>,
  userId: string,
): { rank: number; playerCount: number } {
  return {
    rank: standings.find((entry) => entry.userId === userId)?.rank ?? standings.length,
    playerCount: Math.max(1, standings.length),
  };
}

async function processRngdleCommand(
  body: Interaction,
  user: InteractionUser & { id: string },
  subcommand: string,
  profileUser?: InteractionUser & { id: string },
): Promise<void> {
  const guildId = body.guild_id!;
  const applicationId = body.application_id!;
  const token = body.token!;
  try {
    const repository = getRngdleDiscordRepository();
    if (subcommand === "leaderboard") {
      // The card shows ten rows and a total, so fetch ten rows and a total
      // rather than aggregating every roll in the guild to count its players.
      const [entries, totalPlayers] = await Promise.all([
        repository.leaderboard(guildId, 10),
        repository.playerCount(guildId),
      ]);
      await deliverRngdleLeaderboard({
        applicationId,
        token,
        entries,
        totalPlayers,
        attachmentSizeLimit: body.attachment_size_limit,
      });
      return;
    }

    const gameDay = rngdleGameDay();
    if (subcommand === "user") {
      const target = profileUser ?? user;
      const profile = await repository.userProfile(guildId, target.id, gameDay);
      if (!profile) {
        await deliverRngdleError({
          applicationId,
          token,
          content: `${interactionName(target)} hasn't rolled RNGDLE in this server yet.`,
        });
        return;
      }
      const currentProfile = {
        ...profile,
        displayName: interactionName(target),
        avatar: target.avatar ?? profile.avatar,
      };
      await deliverRngdleProfile({
        applicationId,
        token,
        profile: currentProfile,
        attachmentSizeLimit: body.attachment_size_limit,
      });
      return;
    }

    const now = Date.now();
    const rollGameDay = rngdleGameDay(new Date(now));
    const result = scoreRngdleNumber(selectRngdleNumber());
    const creation = await repository.createInitial({
      guildId,
      userId: user.id,
      displayName: interactionName(user),
      avatar: user.avatar ?? null,
      gameDay: rollGameDay,
      initial: result,
      current: result,
      initialRolledAt: now,
      rerolledAt: null,
    });
    const [standings, profile] = await Promise.all([
      repository.dailyStandings(guildId, rollGameDay),
      repository.userProfile(guildId, user.id, rollGameDay),
    ]);
    const { rank, playerCount } = rngdleDeliveryRank(standings, user.id);
    await deliverRngdleRoll({
      applicationId,
      token,
      roll: creation.roll,
      rank,
      playerCount,
      animate: creation.created,
      stats: {
        gameDay: rollGameDay,
        nextResetAt: rngdleNextResetAt(new Date(now)),
        now,
        currentStreak: profile?.currentStreak ?? 1,
        careerEp: profile?.careerEp ?? creation.roll.current.creditedEp,
        newBadges: profile?.todayNewBadges ?? creation.roll.current.badges.length,
        rerollDeltaEp: creation.roll.rerolledAt === null
          ? null
          : creation.roll.current.creditedEp - creation.roll.initial.creditedEp,
      },
      attachmentSizeLimit: body.attachment_size_limit,
    });
  } catch (error) {
    console.error("rngdle: command processing failed", error);
    await deliverRngdleError({
      applicationId,
      token,
      content: "RNGDLE couldn't complete that request just now. Try again in a moment.",
    }).catch((deliveryError) => console.error("rngdle: error fallback failed", deliveryError));
  }
}

function handleRngdle(body: Interaction): NextResponse {
  if (!body.guild_id) {
    return reply("Run /rngdle in a server so rolls and leaderboards stay guild-scoped.", true);
  }
  const user = body.member?.user ?? body.user;
  if (!user?.id || !body.application_id || !body.token) {
    return reply("RNGDLE couldn't identify this roll. Try the command again.", true);
  }

  const subcommand = body.data?.options?.[0]?.name;
  if (subcommand !== "roll" && subcommand !== "leaderboard" && subcommand !== "user") {
    return reply("Choose /rngdle roll, /rngdle leaderboard, or /rngdle user.", true);
  }
  const targetValue = body.data?.options?.[0]?.options?.find((option) => option.name === "player")?.value;
  const target = typeof targetValue === "string" ? body.data?.resolved?.users?.[targetValue] : undefined;
  after(() => processRngdleCommand(
    body,
    user as InteractionUser & { id: string },
    subcommand,
    target?.id ? target as InteractionUser & { id: string } : undefined,
  ));
  return NextResponse.json({ type: 5 });
}

async function handleRngdleReroll(body: Interaction): Promise<NextResponse> {
  const parsed = parseRngdleRerollCustomId(body.data?.custom_id ?? "");
  const user = body.member?.user ?? body.user;
  if (!parsed || !user?.id || !body.guild_id) {
    return reply("That RNGDLE reroll button is invalid.", true);
  }
  if (parsed.userId !== user.id) {
    return reply("Only the player who rolled can use this reroll.", true);
  }
  if (!body.application_id || !body.token) {
    return reply("RNGDLE couldn't start that reroll. Try again.", true);
  }
  if (parsed.gameDay !== rngdleGameDay()) {
    return reply("That RNGDLE roll is from a previous game day.", true);
  }

  // Every database call moves behind the acknowledgement. On a cold instance
  // the schema check plus four round trips can exceed Discord's 3s deadline,
  // which players see as "bitedle didn't respond in time".
  after(() => processRngdleReroll(body, user as InteractionUser & { id: string }, parsed));
  return NextResponse.json({ type: 6 });
}

async function processRngdleReroll(
  body: Interaction,
  user: InteractionUser & { id: string },
  parsed: { gameDay: string; userId: string },
): Promise<void> {
  const applicationId = body.application_id!;
  const token = body.token!;
  const guildId = body.guild_id!;
  const notice = (content: string) => deliverRngdleNotice({ applicationId, token, content });
  try {
    const repository = getRngdleDiscordRepository();
    const existing = await repository.getRoll(guildId, user.id, parsed.gameDay);
    const now = Date.now();
    if (!existing) return await notice("That RNGDLE roll no longer exists.");
    if (!canRerollRngdle(existing.initialRolledAt, existing.rerolledAt, now)) {
      return await notice(existing.rerolledAt === null
        ? "Today's RNGDLE reroll window closed at the daily reset."
        : "You already used the one reroll for today's RNGDLE.");
    }

    // Prefer the penalty pre-drawn at roll time — its risk animation is already
    // rendered on this instance, so the reroll answers without a render wait.
    const penalty = takePendingRngdlePenalty(guildId, user.id, parsed.gameDay) ?? selectRngdlePenalty();
    const outcome = await repository.reroll({
      guildId,
      userId: user.id,
      gameDay: parsed.gameDay,
      displayName: interactionName(user),
      avatar: user.avatar ?? null,
      result: scoreRngdleNumber(selectRngdleNumber(), penalty),
      now,
    });
    if (outcome.status !== "updated") {
      return await notice(outcome.status === "expired"
        ? "Today's RNGDLE reroll window closed at the daily reset."
        : "You already used the one reroll for today's RNGDLE.");
    }
    const [standings, profile] = await Promise.all([
      repository.dailyStandings(guildId, parsed.gameDay),
      repository.userProfile(guildId, user.id, parsed.gameDay),
    ]);
    const { rank, playerCount } = rngdleDeliveryRank(standings, user.id);
    await deliverRngdleRoll({
      applicationId,
      token,
      roll: outcome.roll,
      rank,
      playerCount,
      animate: true,
      stats: {
        gameDay: parsed.gameDay,
        nextResetAt: rngdleNextResetAt(new Date(now)),
        now,
        currentStreak: profile?.currentStreak ?? 1,
        careerEp: profile?.careerEp ?? outcome.roll.current.creditedEp,
        newBadges: profile?.todayNewBadges ?? outcome.roll.current.badges.length,
        rerollDeltaEp: outcome.roll.current.creditedEp - outcome.roll.initial.creditedEp,
      },
      riskAnimationPercent: penalty,
      attachmentSizeLimit: body.attachment_size_limit,
    });
  } catch (error) {
    console.error("rngdle: reroll processing failed", error);
    await notice("RNGDLE couldn't complete that reroll just now. Try again in a moment.")
      .catch((noticeError) => console.error("rngdle: reroll notice failed", noticeError));
  }
}

async function handleRngdleReplay(body: Interaction): Promise<NextResponse> {
  const parsed = parseRngdleReplayCustomId(body.data?.custom_id ?? "");
  const user = body.member?.user ?? body.user;
  if (!parsed || !user?.id || !body.guild_id) {
    return reply("That RNGDLE replay button is invalid.", true);
  }
  if (parsed.userId !== user.id) {
    return reply("Only the player who rolled can replay this result.", true);
  }
  if (!body.application_id || !body.token) {
    return reply("RNGDLE couldn't replay that result. Try again.", true);
  }
  if (parsed.gameDay !== rngdleGameDay()) {
    return reply("That RNGDLE result is from a previous game day.", true);
  }

  // Acknowledged before any database work, for the same reason as the reroll.
  after(() => processRngdleReplay(body, user as InteractionUser & { id: string }, parsed));
  return NextResponse.json({ type: 6 });
}

async function processRngdleReplay(
  body: Interaction,
  user: InteractionUser & { id: string },
  parsed: { gameDay: string; userId: string },
): Promise<void> {
  const applicationId = body.application_id!;
  const token = body.token!;
  const guildId = body.guild_id!;
  const notice = (content: string) => deliverRngdleNotice({ applicationId, token, content });
  try {
    const repository = getRngdleDiscordRepository();
    const roll = await repository.getRoll(guildId, user.id, parsed.gameDay);
    if (!roll || roll.rerolledAt === null) {
      return await notice("That completed RNGDLE reroll could not be found.");
    }
    const now = Date.now();
    const [standings, profile] = await Promise.all([
      repository.dailyStandings(guildId, parsed.gameDay),
      repository.userProfile(guildId, user.id, parsed.gameDay),
    ]);
    const { rank, playerCount } = rngdleDeliveryRank(standings, user.id);
    await deliverRngdleRoll({
      applicationId,
      token,
      roll,
      rank,
      playerCount,
      animate: true,
      stats: {
        gameDay: parsed.gameDay,
        nextResetAt: rngdleNextResetAt(new Date(now)),
        now,
        currentStreak: profile?.currentStreak ?? 1,
        careerEp: profile?.careerEp ?? roll.current.creditedEp,
        newBadges: profile?.todayNewBadges ?? roll.current.badges.length,
        rerollDeltaEp: roll.current.creditedEp - roll.initial.creditedEp,
      },
      attachmentSizeLimit: body.attachment_size_limit,
    });
  } catch (error) {
    console.error("rngdle: replay processing failed", error);
    await notice("RNGDLE couldn't replay that result just now. Try again in a moment.")
      .catch((noticeError) => console.error("rngdle: replay notice failed", noticeError));
  }
}

function handleRngdleUtilityButton(body: Interaction, mode: "leaderboard" | "user"): NextResponse {
  if (!body.guild_id || !body.application_id || !body.token) {
    return reply("Run that RNGDLE action in a server.", true);
  }
  const user = body.member?.user ?? body.user;
  if (!user?.id) return reply("RNGDLE couldn't identify you.", true);
  after(() => processRngdleCommand(
    body,
    user as InteractionUser & { id: string },
    mode,
    mode === "user" ? user as InteractionUser & { id: string } : undefined,
  ));
  return NextResponse.json({ type: 5 });
}

/**
 * RNGDLE replies through the interaction webhook and never reads
 * guild_channels, so it skips the pre-routing write below — and the schema
 * bootstrap that write can trigger on a cold instance.
 */
function isRngdleInteraction(body: Interaction): boolean {
  if (body.type === 2) return body.data?.name === "rngdle";
  if (body.type !== 3) return false;
  const customId = body.data?.custom_id ?? "";
  return customId.startsWith(RNGDLE_REROLL_CUSTOM_ID_PREFIX)
    || customId.startsWith(RNGDLE_REPLAY_CUSTOM_ID_PREFIX)
    || customId === RNGDLE_LEADERBOARD_BUTTON_ID
    || customId === RNGDLE_PROFILE_BUTTON_ID;
}

export async function POST(request: NextRequest) {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  const rawBody = await request.text();

  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  const isValid =
    publicKey && signature && timestamp && (await verifyKey(rawBody, signature, timestamp, publicKey));

  if (!isValid) {
    // Discord sends a PING here (with a valid signature) to verify this URL
    // before it will let the Developer Portal save it as the Interactions
    // Endpoint URL — without this check, that verification step fails.
    return new NextResponse("Bad request signature", { status: 401 });
  }

  const body = JSON.parse(rawBody) as Interaction;

  if (body?.type === 1) {
    return NextResponse.json({ type: 1 });
  }

  // Blocklist gate: reject every command/component interaction (launch,
  // /bitedle, /bitesweeper, every 1v1, "Play now!" button, /share, /results) before
  // recording the guild channel or launching, so a blocked user can't play
  // or interfere.
  if (body?.type === 2 || body?.type === 3) {
    const callerId = body.member?.user?.id ?? body.user?.id;
    if (isBlockedDiscordId(callerId)) {
      return reply("🚫 You don't have access to Bitedle.", true);
    }
  }

  if (
    (body?.type === 2 || body?.type === 3) &&
    body.data?.name !== "biteball" &&
    !isRngdleInteraction(body) &&
    body.guild_id &&
    body.channel_id
  ) {
    // Records the guild's most recent command channel and — load-bearing —
    // guarantees the guild_channels row exists before the preview/recap
    // upserts touch it. Must be awaited (not fire-and-forget): a serverless
    // function invocation isn't guaranteed to keep running background work
    // after the response is sent.
    try {
      await getStore().setGuildChannel(body.guild_id, body.channel_id);
    } catch (e) {
      console.warn("interactions: failed to record guild channel", e);
    }
  }

  if (body?.type === 2 && body?.data?.name === "biteball") {
    return handleBiteball(body);
  }

  if (body?.type === 2 && body?.data?.name === "rngdle") {
    return handleRngdle(body);
  }

  if (body?.type === 3 && body?.data?.custom_id?.startsWith(RNGDLE_REROLL_CUSTOM_ID_PREFIX)) {
    return handleRngdleReroll(body);
  }

  if (body?.type === 3 && body?.data?.custom_id?.startsWith(RNGDLE_REPLAY_CUSTOM_ID_PREFIX)) {
    return handleRngdleReplay(body);
  }

  if (body?.type === 3 && body?.data?.custom_id === RNGDLE_LEADERBOARD_BUTTON_ID) {
    return handleRngdleUtilityButton(body, "leaderboard");
  }

  if (body?.type === 3 && body?.data?.custom_id === RNGDLE_PROFILE_BUTTON_ID) {
    return handleRngdleUtilityButton(body, "user");
  }

  if (body?.type === 2 && (body?.data?.name === "play" || body?.data?.name === "bitedle")) {
    // The entry point command "play" (APP_HANDLER, so it reaches us here
    // instead of Discord auto-posting a "Game Invitation" card) and the
    // ordinary /bitedle command both launch the same way — an app can have
    // only one PRIMARY_ENTRY_POINT. "play" is weak intent: the App Launcher
    // fires it too, and reopening the app mustn't switch a running game.
    await recordIntent(body, "classic", body.data?.name === "play");
    return launchActivity(body);
  }

  if (body?.type === 2 && body?.data?.name === "biteracer") {
    return handleBiteracerChallenge(body);
  }

  if (
    body?.type === 3 &&
    (body?.data?.custom_id?.startsWith(BITERACER_JOIN_PREFIX) ||
      body?.data?.custom_id?.startsWith(BITERACER_DECLINE_PREFIX))
  ) {
    return handleBiteracerButton(body);
  }

  if (body?.type === 2 && body?.data?.name === "bitefight") {
    return handleBitefightChallenge(body);
  }

  if (
    body?.type === 3 &&
    (body?.data?.custom_id?.startsWith(BITEFIGHT_JOIN_PREFIX) ||
      body?.data?.custom_id?.startsWith(BITEFIGHT_DECLINE_PREFIX))
  ) {
    return handleBitefightButton(body);
  }

  if (body?.type === 2 && body?.data?.name === "biteshooter") {
    return handleBiteshooterChallenge(body);
  }

  if (
    body?.type === 3 &&
    (body?.data?.custom_id?.startsWith(BITESHOOTER_JOIN_PREFIX) ||
      body?.data?.custom_id?.startsWith(BITESHOOTER_DECLINE_PREFIX))
  ) {
    return handleBiteshooterButton(body);
  }

  if (body?.type === 2 && body?.data?.name === "bitesweeper") {
    // Bitesweeper launch: record the caller's intent, and park a channel-keyed
    // marker (the fallback for players whose browser isn't Discord-linked yet)
    // the booting Activity instance claims via /api/activity/mode. Awaited,
    // not after() — serverless. Its channel preview is separate from Classic's
    // preview and starts as a gray board, then the Activity state/click routes
    // edit it.
    await recordIntent(body, "mega", false);
    if (body.channel_id) {
      try {
        await getStore().markBitesweeperLaunch(
          body.channel_id,
          Date.now(),
          null,
          body.member?.user?.id ?? body.user?.id ?? null,
        );
      } catch (e) {
        console.warn("interactions: failed to mark Bitesweeper launch", e);
      }
    }
    await startBitesweeperPreview(body);
    return NextResponse.json({ type: 12 }); // LAUNCH_ACTIVITY
  }

  if (body?.type === 3 && body?.data?.custom_id === BITESWEEPER_LAUNCH_BUTTON_ID) {
    await recordIntent(body, "mega", false);
    if (body.channel_id) {
      const preview = body.guild_id
        ? await getStore().getBitesweeperPreview(body.guild_id)
        : null;
      await getStore().markBitesweeperLaunch(
        body.channel_id,
        Date.now(),
        preview?.instanceId ?? null,
        body.member?.user?.id ?? body.user?.id ?? null,
      );
    }
    // A fresh preview can keep using its original webhook token. An old
    // button starts a new editable preview message with this interaction.
    await startBitesweeperPreview(body, true);
    return NextResponse.json({ type: 12 });
  }

  if (body?.type === 3 && body?.data?.custom_id === LAUNCH_BUTTON_ID) {
    // "Play now!" button on the live preview message. Launching from it also
    // mints a fresh interaction token, extending how long the preview stays
    // editable.
    await recordIntent(body, "classic", false);
    return launchActivity(body);
  }

  if (body?.type === 2 && body?.data?.name === "share") {
    return handleShare(body);
  }

  if (body?.type === 2 && body?.data?.name === "results") {
    return handleResults(body);
  }

  return reply("Unknown command.");
}
