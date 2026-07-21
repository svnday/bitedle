import { NextResponse, type NextRequest } from "next/server";
import { playerDate, playerTimeZone } from "@/lib/discord";
import { biteracerStateFor, passageFor } from "@/lib/game-biteracer";
import { attachIdentity, ensureUser } from "@/lib/identity";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

// Idempotent clock start, called on the player's FIRST keystroke (not page
// load) so the server clock starts when typing actually begins. The store's
// first-insert-wins upsert means a refresh mid-run never resets the clock.
export async function POST(request: NextRequest) {
  const identity = await ensureUser(request);
  const date = playerDate(request);
  const passage = passageFor(date);
  await getStore().startBiteracerGame(date, identity.id, passage.id, Date.now());
  const state = await biteracerStateFor(identity.id, date, playerTimeZone(request));
  return attachIdentity(NextResponse.json(state), identity);
}
