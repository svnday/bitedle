import { NextResponse, type NextRequest } from "next/server";
import { resolveUser } from "@/lib/identity";
import { computeLeaderboard, todayStr } from "@/lib/game";

export async function GET(request: NextRequest) {
  // Read-only: identifies the caller to mark their rows, but never provisions.
  const meId = await resolveUser(request);
  return NextResponse.json(await computeLeaderboard(todayStr(), meId));
}
