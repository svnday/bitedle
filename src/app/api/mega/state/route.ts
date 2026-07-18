import { NextResponse, type NextRequest } from "next/server";
import { playerDate, playerTimeZone } from "@/lib/discord";
import { megaStateFor } from "@/lib/game-mega";
import { attachIdentity, ensureUser } from "@/lib/identity";
import { getStore } from "@/lib/store";
import { recordBitesweeperPresence } from "@/lib/bitesweeper-presence";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const identity = await ensureUser(request);
  const date = playerDate(request);
  const state = await megaStateFor(
    identity.id,
    date,
    playerTimeZone(request),
  );
  await recordBitesweeperPresence(request, getStore(), identity.id, date);
  return attachIdentity(NextResponse.json(state), identity);
}
