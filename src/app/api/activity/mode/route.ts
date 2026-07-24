import { NextResponse, type NextRequest } from "next/server";
import { DISCORD_USER_HEADER_NAME, SNOWFLAKE_RE } from "@/lib/discord";
import { resolveUser } from "@/lib/identity";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

/** A /bitesweeper marker or launch intent older than this is stale — the
 *  launch it belonged to either booted long ago or never did. */
const MARKER_TTL_MS = 10 * 60_000;

/**
 * Tells a booting Activity participant which game mode to render. A type-12
 * launch carries no payload, so this is how the client learns which command
 * opened it. Resolution is per-user where possible — the caller's identity
 * cookie (sent even during the SDK handshake, unlike the Discord-id header)
 * maps to their linked Discord id, whose pending launch intent names the game
 * THEY asked for — so channel-mates sharing one Activity instance can play
 * different games. Players without a linked cookie fall back to the
 * instance-level binding / channel-marker heuristics.
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

  const discordUserId = request.headers.get(DISCORD_USER_HEADER_NAME);
  if (discordUserId && SNOWFLAKE_RE.test(discordUserId)) {
    const matchId = await getStore().claimBitefightLaunch(
      discordUserId,
      Date.now() - MARKER_TTL_MS,
    );
    if (matchId) return NextResponse.json({ mode: "bitefight", matchId });
    const raceId = await getStore().claimBiteracerRaceLaunch(
      discordUserId,
      Date.now() - MARKER_TTL_MS,
    );
    if (raceId) return NextResponse.json({ mode: "biteracer", raceId });
  }

  // Read-only identity: never provision a user from a boot ping, and never
  // let an identity hiccup break the boot.
  let userId: string | null = null;
  try {
    userId = await resolveUser(request);
  } catch (e) {
    console.warn("activity/mode: identity resolution failed", e);
  }

  const mode = await getStore().resolveActivityModeForUser(
    instanceId,
    channelId,
    userId,
    Date.now() - MARKER_TTL_MS,
  );
  return NextResponse.json({ mode });
}
