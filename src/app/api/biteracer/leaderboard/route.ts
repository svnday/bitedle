import { NextResponse, type NextRequest } from "next/server";
import { playerDate } from "@/lib/discord";
import { computeBiteracerLeaderboard } from "@/lib/game-biteracer";
import { resolveUser } from "@/lib/identity";

export async function GET(request: NextRequest) {
  // Read-only: identifies the caller to mark their rows, but never provisions.
  const meId = await resolveUser(request);
  return NextResponse.json(await computeBiteracerLeaderboard(playerDate(request), meId));
}
