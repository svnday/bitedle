import { NextResponse, type NextRequest } from "next/server";
import { guildIdFromRequest, playerDate } from "@/lib/discord";
import { computeLeaderboard } from "@/lib/game";
import { resolveUser } from "@/lib/identity";

export async function GET(request: NextRequest) {
  if (guildIdFromRequest(request) !== null) {
    return NextResponse.json(
      { error: "Bitedle XL is only playable on the website." },
      { status: 403 },
    );
  }
  const meId = await resolveUser(request);
  return NextResponse.json(await computeLeaderboard(playerDate(request), meId, null, "mega"));
}
