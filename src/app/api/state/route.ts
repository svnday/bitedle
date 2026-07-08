import { NextResponse, type NextRequest, after } from "next/server";
import { guildIdFromRequest } from "@/lib/discord";
import { attachIdentity, ensureUser } from "@/lib/identity";
import { stateFor, todayStr } from "@/lib/game";
import { updateLivePreviewMessage } from "@/lib/discord-live-preview";
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
    // Opening the Activity is a launch — record it so the live preview scopes
    // to this window's players. Awaited before the after() render below.
    await store.stampLaunch(date, identity.id, Date.now());
    // No interaction token here — this can only post/edit through the token
    // stored by the launch that opened the Activity (fine: that launch just
    // happened, so the token is fresh).
    after(() =>
      updateLivePreviewMessage({ guildId }).catch((e) => {
        console.error(`state: live preview update failed for guild ${guildId}`, e);
      }),
    );
  }

  const state = await stateFor(identity.id, date);
  return attachIdentity(NextResponse.json(state), identity);
}
