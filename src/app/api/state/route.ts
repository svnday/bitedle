import { NextResponse, type NextRequest, after } from "next/server";
import { guildIdFromRequest } from "@/lib/discord";
import { attachIdentity, ensureUser } from "@/lib/identity";
import { stateFor, todayStr } from "@/lib/game";
import { updateLivePreviewMessageWithCooldown } from "@/lib/discord-live-preview";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const identity = await ensureUser(request);
  const date = todayStr();
  const guildId = guildIdFromRequest(request);

  if (guildId) {
    const store = getStore();
    const game = await store.getGame(date, identity.id);
    if (!game) {
      await store.putGame(date, identity.id, {
        clicks: [],
        status: "playing",
        score: null,
        finishedAt: null,
        guildId,
      });
    }
    after(() => updateLivePreviewMessageWithCooldown({ guildId }));
  }

  const state = await stateFor(identity.id, date);
  return attachIdentity(NextResponse.json(state), identity);
}
