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
import { passageFor } from "@/lib/game-biteracer";
import { BITERACER_CHALLENGE_TTL_MS, racePlayer } from "@/lib/biteracer-race";
import type { BiteracerRaceRecord } from "@/lib/types";
import { updateBiteracerPreview } from "@/lib/biteracer-discord-preview";
import {
  beginBitesweeperPreview,
  updateBitesweeperPreview,
  BITESWEEPER_LAUNCH_BUTTON_ID,
  BITESWEEPER_WEBHOOK_TOKEN_TTL_MS,
  type BitesweeperPreviewPlayer,
} from "@/lib/bitesweeper-discord-preview";

// Imports next/og (via discord-summary) for the preview image — needs Node.
export const runtime = "nodejs";

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
    options?: { name: string; value: string }[];
    resolved?: { users?: Record<string, InteractionUser> };
  };
  member?: { user?: InteractionUser };
  user?: InteractionUser;
  channel_id?: string;
  guild_id?: string;
  /** Present on all interactions — needed for interaction-webhook posts/edits. */
  application_id?: string;
  token?: string;
}

const BITERACER_JOIN_PREFIX = "biteracer-join:";
const BITERACER_DECLINE_PREFIX = "biteracer-decline:";

function interactionName(user: InteractionUser | undefined): string {
  return user?.global_name ?? user?.username ?? "Player";
}

async function handleBiteracerChallenge(body: Interaction): Promise<NextResponse> {
  const challenger = body.member?.user ?? body.user;
  const opponentId = body.data?.options?.find((option) => option.name === "opponent")?.value;
  const opponent = opponentId ? body.data?.resolved?.users?.[opponentId] : undefined;
  if (!challenger?.id || !opponentId || !opponent) {
    return reply("Couldn't identify both racers. Try the command again.", true);
  }
  if (challenger.id === opponentId) return reply("You can't race yourself.", true);
  if (opponent.bot) return reply("Bots are quick, but they can't enter Biteracer.", true);

  const now = Date.now();
  const race: BiteracerRaceRecord = {
    id: crypto.randomUUID(),
    guildId: body.guild_id ?? null,
    channelId: body.channel_id ?? null,
    passage: passageFor(todayStr()),
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
  await getStore().createBiteracerRace(race);
  return NextResponse.json({
    type: 4,
    data: {
      content: `🏁 **${race.players[0].name}** challenged **${race.players[1].name}** to a Biteracer 1v1!`,
      allowed_mentions: { parse: [] },
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
    race.status = "expired";
    race.finishedAt = Date.now();
    await store.putBiteracerRace(race);
    after(() => updateBiteracerPreview(race.id, true));
    return reply("That challenge expired. Start a new one with /biteracer.", true);
  }

  if (decline) {
    if (playerIndex !== 1 || race.status !== "pending") {
      return reply("This race can no longer be declined.", true);
    }
    race.status = "declined";
    race.finishedAt = Date.now();
    await store.putBiteracerRace(race);
    after(() => updateBiteracerPreview(race.id, true));
    return reply("Race declined.", true);
  }

  if (race.status === "pending") {
    if (playerIndex !== 1) return reply("Waiting for your opponent to accept.", true);
    race.status = "accepted";
    race.acceptedAt = Date.now();
    await store.putBiteracerRace(race);
    after(() => updateBiteracerPreview(race.id, true));
  }
  if (!["accepted", "countdown", "racing"].includes(race.status)) {
    return reply("That race is already over.", true);
  }
  await store.setBiteracerRaceLaunch(callerId, race.id, Date.now());
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
  mode: "classic" | "mega",
  viaEntryPoint: boolean,
): Promise<void> {
  const callerId = body.member?.user?.id ?? body.user?.id;
  if (!callerId) return;
  try {
    await getStore().recordLaunchIntent(callerId, mode, Date.now(), viaEntryPoint);
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
  // /bitedle, /bitesweeper, "Play now!" button, /share, /results) before
  // recording the guild channel or launching, so a blocked user can't play
  // or interfere.
  if (body?.type === 2 || body?.type === 3) {
    const callerId = body.member?.user?.id ?? body.user?.id;
    if (isBlockedDiscordId(callerId)) {
      return reply("🚫 You don't have access to Bitedle.", true);
    }
  }

  if ((body?.type === 2 || body?.type === 3) && body.guild_id && body.channel_id) {
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
