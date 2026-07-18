import { NextResponse, type NextRequest } from "next/server";
import { SNOWFLAKE_RE } from "@/lib/discord";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

/** A /bitesweeper marker older than this is stale — the launch it belonged to
 *  either booted long ago or never did. */
const MARKER_TTL_MS = 10 * 60_000;

/**
 * Tells a booting Activity instance which game mode it is locked to. A type-12
 * launch carries no payload, so this is how the client learns whether it was
 * opened by /bitesweeper: the first participant of an unbound instance claims
 * the channel's pending marker and binds the instance, and everyone else
 * (including late joiners) reads the binding. Classic instances bind too, so
 * a stale marker can never flip an already-running classic Activity.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const instanceId =
    typeof body?.instanceId === "string" && body.instanceId.length > 0 && body.instanceId.length <= 100
      ? body.instanceId
      : null;
  const channelId =
    typeof body?.channelId === "string" && SNOWFLAKE_RE.test(body.channelId) ? body.channelId : null;
  // Fail safe, never 4xx: a broken payload just plays classic.
  if (!instanceId) return NextResponse.json({ mode: "classic" });

  const mode = await getStore().resolveActivityMode(
    instanceId,
    channelId,
    Date.now() - MARKER_TTL_MS,
  );
  return NextResponse.json({ mode });
}
