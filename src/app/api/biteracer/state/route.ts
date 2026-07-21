import { NextResponse, type NextRequest } from "next/server";
import { playerDate, playerTimeZone } from "@/lib/discord";
import { biteracerStateFor } from "@/lib/game-biteracer";
import { attachIdentity, ensureUser } from "@/lib/identity";

export const runtime = "nodejs";

// Read-only: the passage is visible from the start (nothing to hide, unlike
// Bitedle's board), so this never mutates — starting the clock is /start's job.
export async function GET(request: NextRequest) {
  const identity = await ensureUser(request);
  const state = await biteracerStateFor(identity.id, playerDate(request), playerTimeZone(request));
  return attachIdentity(NextResponse.json(state), identity);
}
