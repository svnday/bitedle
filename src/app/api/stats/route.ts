import { NextResponse, type NextRequest } from "next/server";
import { guildIdFromRequest, playerDate } from "@/lib/discord";
import { attachIdentity, ensureUser, requireDiscordUser } from "@/lib/identity";
import { computeUserStats } from "@/lib/game";

export async function GET(request: NextRequest) {
  const identity = guildIdFromRequest(request)
    ? await requireDiscordUser(request)
    : await ensureUser(request);
  if (!identity) {
    return NextResponse.json(
      { error: "Couldn't link your Discord identity. Close Bitedle and launch it again." },
      { status: 428 },
    );
  }
  const stats = await computeUserStats(identity.id, playerDate(request));
  return attachIdentity(NextResponse.json(stats), identity);
}
