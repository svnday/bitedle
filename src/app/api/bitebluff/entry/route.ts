import { after, NextResponse, type NextRequest } from "next/server";
import {
  DISCORD_USER_HEADER_NAME,
  discordChannelIdFromRequest,
  guildIdFromRequest,
  isBlockedDiscordId,
  SNOWFLAKE_RE,
} from "@/lib/discord";
import { getStore } from "@/lib/store";
import {
  bitebluffPrivateState,
  enterBitebluff,
  recordBitebluffDestination,
} from "@/lib/bitebluff-service";
import { getBitebluffRepository } from "@/lib/bitebluff-store";
import { updateBitebluffPublicPreview } from "@/lib/bitebluff-discord-preview";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const guildId = guildIdFromRequest(request);
  if (!guildId) {
    return NextResponse.json(
      { error: "Launch Bitebluff from a Discord server channel." },
      { status: 428 },
    );
  }
  const discordUserId = request.headers.get(DISCORD_USER_HEADER_NAME);
  if (
    !discordUserId ||
    !SNOWFLAKE_RE.test(discordUserId) ||
    isBlockedDiscordId(discordUserId)
  ) {
    return NextResponse.json(
      { error: "A linked Discord identity is required for Bitebluff." },
      { status: 428 },
    );
  }
  const store = getStore();
  const userId = await store.getUserIdByDiscordId(discordUserId);
  const user = userId ? await store.getUser(userId) : null;
  if (!userId || user?.discordUserId !== discordUserId) {
    return NextResponse.json(
      { error: "Discord identity is not linked. Close the Activity and launch it again." },
      { status: 428 },
    );
  }
  const body = await request.json().catch(() => null);
  const wager = body?.wager;
  if (!Number.isSafeInteger(wager) || wager <= 0) {
    return NextResponse.json(
      { error: "The wager must be a positive whole number of Bites." },
      { status: 400 },
    );
  }

  try {
    const result = await enterBitebluff(
      {
        userId,
        discordUserId,
        displayName: user.name,
        avatarHash: user.discordAvatar,
      },
      wager,
      guildId,
    );
    const channelId = discordChannelIdFromRequest(request);
    if (channelId) {
      await recordBitebluffDestination({
        roundId: result.entry.roundId,
        guildId,
        channelId,
        applicationId: "",
        webhookToken: "",
        tokenCreatedAt: Date.now(),
        now: Date.now(),
      });
      const destinations = await getBitebluffRepository().destinationsForRound(
        result.entry.roundId,
      );
      after(async () => {
        for (const destination of destinations) {
          await updateBitebluffPublicPreview(destination.id).catch((error) => {
            console.error(
              `bitebluff/entry: preview failed for ${destination.id}`,
              error,
            );
          });
        }
      });
    }
    return NextResponse.json(await bitebluffPrivateState(userId, guildId));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Couldn't place that Bitebluff wager.",
      },
      { status: 409 },
    );
  }
}
