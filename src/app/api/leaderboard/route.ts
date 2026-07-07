import { NextResponse, type NextRequest } from "next/server";
import { GUILD_HEADER_NAME, guildIdFromRequest } from "@/lib/discord";
import { resolveUser } from "@/lib/identity";
import { computeLeaderboard, todayStr } from "@/lib/game";

export async function GET(request: NextRequest) {
  // Read-only: identifies the caller to mark their rows, but never provisions.
  const meId = await resolveUser(request);
  const guildId = guildIdFromRequest(request);
  const board = await computeLeaderboard(todayStr(), meId, guildId);
  // TEMPORARY diagnostic (to be removed): surfaces exactly what guild header
  // the server actually received, so this is visible without DevTools.
  return NextResponse.json({
    ...board,
    debug: { guildIdHeaderRaw: request.headers.get(GUILD_HEADER_NAME), resolvedGuildId: guildId },
  });
}
