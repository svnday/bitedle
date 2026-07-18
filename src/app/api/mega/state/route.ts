import { NextResponse, type NextRequest } from "next/server";
import { playerDate, playerTimeZone } from "@/lib/discord";
import { megaStateFor } from "@/lib/game-mega";
import { attachIdentity, ensureUser } from "@/lib/identity";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const identity = await ensureUser(request);
  const state = await megaStateFor(
    identity.id,
    playerDate(request),
    playerTimeZone(request),
  );
  return attachIdentity(NextResponse.json(state), identity);
}
