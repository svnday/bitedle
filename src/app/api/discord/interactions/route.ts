import { NextResponse, type NextRequest, after } from "next/server";
import { verifyKey } from "discord-interactions";
import { puzzleNumber, todayStr } from "@/lib/game";
import { shareText } from "@/lib/share-text";
import { renderSummaryImage, sortTodayRows } from "@/lib/discord-summary";
import { LAUNCH_BUTTON_ID, updateLivePreviewMessage } from "@/lib/discord-live-preview";
import { getStore } from "@/lib/store";

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
      ...(ephemeral ? { flags: 64 } : {}),
    },
  });
}

interface Interaction {
  type: number;
  data?: { name?: string; custom_id?: string };
  member?: { user?: { id?: string } };
  user?: { id?: string };
  channel_id?: string;
  guild_id?: string;
  /** Present on all interactions — needed for interaction-webhook posts/edits. */
  application_id?: string;
  token?: string;
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
 * style as the daily summary) and edits it into the deferred
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

  if ((body?.type === 2 || body?.type === 3) && body.guild_id && body.channel_id) {
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
    // The entry point command "play" (APP_HANDLER, so it reaches us here
    // instead of Discord auto-posting a "Game Invitation" card) and the
    // ordinary /bitedle command both launch the same way — an app can have
    // only one PRIMARY_ENTRY_POINT.
    return launchActivity(body);
  }

  if (body?.type === 3 && body?.data?.custom_id === LAUNCH_BUTTON_ID) {
    // "Play now!" button on the live preview message. Launching from it also
    // mints a fresh interaction token, extending how long the preview stays
    // editable.
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
