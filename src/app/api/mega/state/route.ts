import { NextResponse, type NextRequest } from "next/server";
import { guildIdFromRequest, playerDate, playerTimeZone } from "@/lib/discord";
import { megaStateFor } from "@/lib/game-mega";
import { attachIdentity, ensureUser } from "@/lib/identity";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (guildIdFromRequest(request) !== null) {
    return NextResponse.json(
      { error: "Bitedle XL is only playable on the website." },
      { status: 403 },
    );
  }
  const identity = await ensureUser(request);
  const state = await megaStateFor(
    identity.id,
    playerDate(request),
    playerTimeZone(request),
  );
  return attachIdentity(NextResponse.json(state), identity);
}
