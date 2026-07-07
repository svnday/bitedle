import { NextResponse, type NextRequest } from "next/server";
import { attachIdentity, ensureUser } from "@/lib/identity";
import { computeUserStats, todayStr } from "@/lib/game";

export async function GET(request: NextRequest) {
  const identity = await ensureUser(request);
  const stats = await computeUserStats(identity.id, todayStr());
  return attachIdentity(NextResponse.json(stats), identity);
}
