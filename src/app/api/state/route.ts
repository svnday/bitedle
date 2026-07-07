import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { attachIdentity, ensureUser } from "@/lib/identity";
import { stateFor, todayStr } from "@/lib/game";

export async function GET(request: NextRequest) {
  const identity = ensureUser(request);
  const state = stateFor(getDb(), identity.id, todayStr());
  return attachIdentity(NextResponse.json(state), identity);
}
