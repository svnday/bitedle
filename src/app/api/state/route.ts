import { NextResponse, type NextRequest } from "next/server";
import { attachIdentity, ensureUser } from "@/lib/identity";
import { stateFor, todayStr } from "@/lib/game";

export async function GET(request: NextRequest) {
  const identity = await ensureUser(request);
  const state = await stateFor(identity.id, todayStr());
  return attachIdentity(NextResponse.json(state), identity);
}
