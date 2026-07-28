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
  settleOverdueBitebluffRounds,
} from "@/lib/bitebluff-service";
import {
  deliverBitebluffFinalResults,
  retryPendingBitebluffFinalResults,
} from "@/lib/bitebluff-discord-preview";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
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
  const userId = await getStore().getUserIdByDiscordId(discordUserId);
  if (!userId) {
    return NextResponse.json(
      { error: "Open the Activity once to link your Discord identity, then run /bitebluff again." },
      { status: 428 },
    );
  }
  const user = await getStore().getUser(userId);
  if (user?.discordUserId !== discordUserId) {
    return NextResponse.json({ error: "Discord identity mismatch." }, { status: 403 });
  }

  const settled = await settleOverdueBitebluffRounds();
  if (settled.length > 0) {
    after(async () => {
      for (const result of settled) {
        await deliverBitebluffFinalResults(result.round.id).catch((error) => {
          console.error(`bitebluff/state: final delivery failed for ${result.round.id}`, error);
        });
      }
      await retryPendingBitebluffFinalResults().catch((error) => {
        console.error("bitebluff/state: pending final delivery retry failed", error);
      });
    });
  }
  return NextResponse.json(await bitebluffPrivateState(userId, guildId));
}
