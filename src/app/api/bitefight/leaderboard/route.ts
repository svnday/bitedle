import { NextResponse, type NextRequest } from "next/server";
import { bitefightLeaderboardFrom } from "@/lib/bitefight";
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
  const user = userId ? await getStore().getUser(userId) : null;
  if (!user || user.discordUserId !== discordUserId) {
    return NextResponse.json({ error: "Discord identity required" }, { status: 428 });
  }
  return NextResponse.json({
    entries: bitefightLeaderboardFrom(await getStore().allBitefights(), discordUserId),
  });
}
