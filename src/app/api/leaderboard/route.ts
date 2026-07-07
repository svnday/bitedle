import { NextResponse, type NextRequest } from "next/server";
import { guildIdFromRequest } from "@/lib/discord";
import { resolveUser } from "@/lib/identity";
import { computeLeaderboard, todayStr } from "@/lib/game";

export async function GET(request: NextRequest) {
  // Read-only: identifies the caller to mark their rows, but never provisions.
  const meId = await resolveUser(request);
  const guildId = guildIdFromRequest(request);
  return NextResponse.json(await computeLeaderboard(todayStr(), meId, guildId));
}
