import { NextResponse, type NextRequest } from "next/server";
import {
  DISCORD_USER_HEADER_NAME,
  isBlockedDiscordId,
  SNOWFLAKE_RE,
} from "@/lib/discord";
import { getStore } from "@/lib/store";
import { bitebluffLeaderboard } from "@/lib/bitebluff-service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
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
      { error: "Open the Activity once to link your Discord identity." },
      { status: 428 },
    );
  }
  return NextResponse.json(await bitebluffLeaderboard(userId));
}
