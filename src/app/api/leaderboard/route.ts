import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, getDb, userIdFromCookie } from "@/lib/db";
import { computeLeaderboard, todayStr } from "@/lib/game";

export async function GET(request: NextRequest) {
  // Read-only: identifies the caller to mark their rows, but never provisions.
  const meId = userIdFromCookie(request.cookies.get(AUTH_COOKIE)?.value);
  return NextResponse.json(computeLeaderboard(getDb(), todayStr(), meId));
}
