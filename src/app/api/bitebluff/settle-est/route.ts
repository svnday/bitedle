// Vercel cron schedules are UTC. This distinct second path lets Hobby and
// higher plans run one daily job at each possible 11 PM Eastern UTC hour
// without using a multi-run expression. Settlement itself is idempotent.
import type { NextRequest } from "next/server";
import { GET as settle } from "../settle/route";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return settle(request);
}
