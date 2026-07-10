import { NextResponse, type NextRequest } from "next/server";
import { guildIdFromRequest, playerDate } from "@/lib/discord";
import { resolveUser } from "@/lib/identity";
import { computeLeaderboard } from "@/lib/game";

export async function GET(request: NextRequest) {
  // Read-only: identifies the caller to mark their rows, but never provisions.
  const meId = await resolveUser(request);
  const guildId = guildIdFromRequest(request);
  // The viewer's local day — they see the leaderboard for the puzzle they're on.
  return NextResponse.json(await computeLeaderboard(playerDate(request), meId, guildId));
}
