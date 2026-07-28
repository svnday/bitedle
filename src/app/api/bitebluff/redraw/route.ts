import { after, NextResponse, type NextRequest } from "next/server";
import {
  DISCORD_USER_HEADER_NAME,
  guildIdFromRequest,
  isBlockedDiscordId,
  SNOWFLAKE_RE,
} from "@/lib/discord";
import { getStore } from "@/lib/store";
import {
  bitebluffPrivateState,
  redrawBitebluff,
} from "@/lib/bitebluff-service";
import {
  normalizeBitebluffBurnPositions,
  normalizeBitebluffRedrawCount,
} from "@/lib/bitebluff-cards";
import { getBitebluffRepository } from "@/lib/bitebluff-store";
import { updateBitebluffPublicPreview } from "@/lib/bitebluff-discord-preview";
import { bitebluffDate, bitebluffRedrawMode } from "@/lib/bitebluff-time";
import type { BitebluffRedrawRequest } from "@/lib/bitebluff-types";

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
  const now = new Date();
  const redrawMode = bitebluffRedrawMode(bitebluffDate(now));
  let redrawRequest: BitebluffRedrawRequest;
  try {
    if (redrawMode === "selected-cards") {
      if (!Array.isArray(body?.positions)) throw new Error("Invalid positions");
      redrawRequest = {
        positions: normalizeBitebluffBurnPositions(body.positions),
      };
    } else {
      redrawRequest = {
        count: normalizeBitebluffRedrawCount(body?.count),
      };
    }
  } catch {
    return NextResponse.json(
      {
        error:
          redrawMode === "selected-cards"
            ? "Choose 1, 2, or 3 different cards from your hand to Burn & Draw."
            : "Choose 1, 2, or 3 random cards to Burn & Draw.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await redrawBitebluff(
      userId,
      guildId,
      redrawRequest,
      now,
    );
    if (result.applied) {
      const destinations =
        await getBitebluffRepository().destinationsForRound(result.entry.roundId);
      after(async () => {
        for (const destination of destinations) {
          await updateBitebluffPublicPreview(destination.id).catch((error) => {
            console.error(
              `bitebluff/redraw: preview failed for ${destination.id}`,
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
            : "Burn & Draw could not be completed.",
      },
      { status: 409 },
    );
  }
}
