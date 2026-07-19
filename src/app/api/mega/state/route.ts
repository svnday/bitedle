import { NextResponse, type NextRequest, after } from "next/server";
import {
  guildIdFromRequest,
  playerDate,
  playerTimeZone,
} from "@/lib/discord";
import { megaStateFor } from "@/lib/game-mega";
import { attachIdentity, ensureUser } from "@/lib/identity";
import { getStore } from "@/lib/store";
import {
  ensureBitesweeperBoard,
  recordBitesweeperPresence,
} from "@/lib/bitesweeper-presence";
import { updateBitesweeperPreview } from "@/lib/bitesweeper-discord-preview";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const identity = await ensureUser(request);
  const date = playerDate(request);
  const store = getStore();
  const instanceId = await ensureBitesweeperBoard(request, store, identity.id, date);
  const state = await megaStateFor(
    identity.id,
    date,
    playerTimeZone(request),
  );
  await recordBitesweeperPresence(request, store, identity.id, date);
  const guildId = guildIdFromRequest(request);
  if (guildId && instanceId) {
    after(() =>
      updateBitesweeperPreview({ guildId, instanceId }).catch((e) => {
        console.error(`mega-state: preview update failed for guild ${guildId}`, e);
      }),
    );
  }
  return attachIdentity(NextResponse.json(state), identity);
}
