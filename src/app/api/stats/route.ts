import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { attachIdentity, ensureUser } from "@/lib/identity";
import { computeUserStats, todayStr } from "@/lib/game";

export async function GET(request: NextRequest) {
  const identity = ensureUser(request);
  const stats = computeUserStats(getDb(), identity.id, todayStr());
  return attachIdentity(NextResponse.json(stats), identity);
}
