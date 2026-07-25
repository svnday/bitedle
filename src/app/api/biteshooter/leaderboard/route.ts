import { NextResponse, type NextRequest } from "next/server";
import { biteshooterLeaderboardFrom } from "@/lib/biteshooter";
import { DISCORD_USER_HEADER_NAME, SNOWFLAKE_RE } from "@/lib/discord";
import { resolveUser } from "@/lib/identity";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const discordUserId = request.headers.get(DISCORD_USER_HEADER_NAME);
  if (!discordUserId || !SNOWFLAKE_RE.test(discordUserId)) {
    return NextResponse.json({ error: "Discord identity required" }, { status: 428 });
  }
  const userId = await resolveUser(request);
  if (!userId) return NextResponse.json({ error: "Discord identity required" }, { status: 428 });
  const user = await getStore().getUser(userId);
  if (user?.discordUserId !== discordUserId) {
    return NextResponse.json({ error: "Discord identity required" }, { status: 428 });
  }
  return NextResponse.json({
    entries: biteshooterLeaderboardFrom(
      await getStore().allBiteshooters(),
      discordUserId,
    ),
  });
}
