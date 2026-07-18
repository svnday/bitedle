import { NextResponse, type NextRequest } from "next/server";
import { guildIdFromRequest, playerDate } from "@/lib/discord";
import { computeMegaUserStats } from "@/lib/game-mega";
import { attachIdentity, ensureUser } from "@/lib/identity";

export async function GET(request: NextRequest) {
  if (guildIdFromRequest(request) !== null) {
    return NextResponse.json(
      { error: "Bitedle XL is only playable on the website." },
      { status: 403 },
    );
  }
  const identity = await ensureUser(request);
  const stats = await computeMegaUserStats(identity.id, playerDate(request));
  return attachIdentity(NextResponse.json(stats), identity);
}
