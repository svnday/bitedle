import { NextResponse, type NextRequest } from "next/server";
import { recordBitesweeperPresence } from "@/lib/bitesweeper-presence";
import { activityInstanceIdFromRequest, discordAvatarUrl, playerDate } from "@/lib/discord";
import { resolveUser } from "@/lib/identity";
import { getStore } from "@/lib/store";
import { megaLivesRemaining } from "@/lib/game-mega";
import type { BitesweeperPlayer } from "@/lib/types";

export const runtime = "nodejs";

const ACTIVE_WINDOW_MS = 2 * 60_000;

export async function GET(request: NextRequest) {
  const instanceId = activityInstanceIdFromRequest(request);
  if (!instanceId) {
    return NextResponse.json({ players: [] satisfies BitesweeperPlayer[] });
  }

  const meId = await resolveUser(request);
  if (!meId) {
    return NextResponse.json({ players: [] satisfies BitesweeperPlayer[] });
  }

  const store = getStore();
  await recordBitesweeperPresence(request, store, meId, playerDate(request));
  const rows = await store.bitesweeperPlayers(instanceId, Date.now() - ACTIVE_WINDOW_MS);
  const players: BitesweeperPlayer[] = rows
    .filter((row) => row.userId !== meId)
    .map((row) => ({
      name: row.name,
      discordAvatarUrl: discordAvatarUrl(row.discordUserId, row.discordAvatar),
      status: row.status,
      score: row.score,
      clicks: row.clicks,
      flags: row.flags,
      livesRemaining: megaLivesRemaining(row.clicks),
    }));
  return NextResponse.json({ players });
}
