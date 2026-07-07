import { NextResponse, type NextRequest } from "next/server";
import { verifyKey } from "discord-interactions";
import { puzzleNumber, todayStr } from "@/lib/game";
import { shareText } from "@/lib/share-text";
import { getStore } from "@/lib/store";

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

  if (body?.type === 2 && body?.data?.name === "bitedle") {
    // Response type 12 = LAUNCH_ACTIVITY, so an ordinary CHAT_INPUT command
    // can launch the Activity inline too — an app can only have one
    // PRIMARY_ENTRY_POINT command (that's /play), so this is the only way
    // for a second command to do the same thing.
    return NextResponse.json({ type: 12 });
  }

  if (body?.type === 2 && body?.data?.name === "share") {
    return handleShare(body);
  }

  return reply("Unknown command.");
}
