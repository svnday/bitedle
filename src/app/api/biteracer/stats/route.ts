import { NextResponse, type NextRequest } from "next/server";
import { playerDate } from "@/lib/discord";
import { computeBiteracerUserStats } from "@/lib/game-biteracer";
import { attachIdentity, ensureUser } from "@/lib/identity";

export async function GET(request: NextRequest) {
  const identity = await ensureUser(request);
  const stats = await computeBiteracerUserStats(identity.id, playerDate(request));
  return attachIdentity(NextResponse.json(stats), identity);
}
