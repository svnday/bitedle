import { NextResponse, type NextRequest, after } from "next/server";
import { verifyKey } from "discord-interactions";
import { puzzleNumber, todayStr } from "@/lib/game";
import { shareText } from "@/lib/share-text";
import { renderSummaryImage, sortTodayRows, postImageToChannel } from "@/lib/discord-summary";
import { getStore } from "@/lib/store";

// Imports next/og (via discord-summary) for the preview image — needs Node.
export const runtime = "nodejs";

// At most one on-demand channel-stats preview per guild every 20 minutes, so
// repeated Activity launches don't spam the channel the way Discord's default
// "Game Invitation" card did.
const PREVIEW_COOLDOWN_MS = 20 * 60 * 1000;

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
      ...(ephemeral ? { flags: 64 } : {}),
    },
  });
}

interface Interaction {
  type: number;
  data?: { name?: string };
  member?: { user?: { id?: string } };
  user?: { id?: string };
  channel_id?: string;
  guild_id?: string;
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

  const date = todayStr();
  const game = await store.getGame(date, userId);
  if (!game || game.status === "playing") {
    return reply("You haven't finished today's Bitedle yet — run /play!", true);
  }

  const misses = game.clicks.filter((c) => c.result === "x").length;
  return reply(
    shareText({ puzzleNumber: puzzleNumber(date), status: game.status, score: game.score, misses }),
  );
}

/**
 * Posts a channel-stats preview image when someone launches the Activity, but
 * only once per PREVIEW_COOLDOWN_MS per guild — replacing Discord's default
 * per-launch "Game Invitation" card with something useful and non-spammy.
 * Runs via `after()` so it never blocks the launch response.
 */
async function postChannelPreview(guildId: string, channelId: string): Promise<void> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return; // e.g. user-install contexts where the bot isn't present

  const store = getStore();
  const now = Date.now();
  const last = await store.getLastPreviewAt(guildId);
  if (now - last < PREVIEW_COOLDOWN_MS) return; // still cooling down — stay quiet

  const date = todayStr();
  const rows = await store.finishedGamesOn(date, guildId);
  if (rows.length === 0) return; // nothing finished yet — don't post an empty card

  // Claim the cooldown slot before the slow render/post so two near-simultaneous
  // launches can't both post. Roll back on failure so a transient error (or the
  // bot not being in this channel) doesn't burn the whole hour.
  await store.setLastPreviewAt(guildId, now);
  try {
    const pngBuffer = await renderSummaryImage(sortTodayRows(rows), date).arrayBuffer();
    const posted = await postImageToChannel({
      channelId,
      botToken,
      pngBuffer,
      content: "📊 Someone's playing Bitedle — here's how the channel's doing so far!",
    });
    if (!posted.ok) {
      console.error(
        `interactions: preview POST failed for guild ${guildId} (${posted.status}): ${posted.body}`,
      );
      await store.setLastPreviewAt(guildId, last);
    }
  } catch (e) {
    console.error(`interactions: preview render/post error for guild ${guildId}`, e);
    await store.setLastPreviewAt(guildId, last);
  }
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

  if (body?.type === 2 && body.guild_id && body.channel_id) {
    // Auto-detect the daily summary's target channel from real usage —
    // whichever channel a command was most recently run in becomes that
    // server's target. Must be awaited (not fire-and-forget): a serverless
    // function invocation isn't guaranteed to keep running background work
    // after the response is sent.
    try {
      await getStore().setGuildChannel(body.guild_id, body.channel_id);
    } catch (e) {
      console.warn("interactions: failed to record guild channel", e);
    }
  }

  if (body?.type === 2 && (body?.data?.name === "play" || body?.data?.name === "bitedle")) {
    // Response type 12 = LAUNCH_ACTIVITY launches the Activity. The entry point
    // command "play" (now APP_HANDLER, so it reaches us here instead of Discord
    // auto-posting a "Game Invitation" card) and the ordinary /bitedle command
    // both launch this way — an app can have only one PRIMARY_ENTRY_POINT.
    // After launching, post a throttled channel-stats preview instead of
    // Discord's per-launch card. `after` runs it off the response path so the
    // launch stays well within Discord's 3s window.
    if (body.guild_id && body.channel_id) {
      const guildId = body.guild_id;
      const channelId = body.channel_id;
      after(() => postChannelPreview(guildId, channelId));
    }
    return NextResponse.json({ type: 12 });
  }

  if (body?.type === 2 && body?.data?.name === "share") {
    return handleShare(body);
  }

  return reply("Unknown command.");
}
