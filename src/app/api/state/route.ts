import { NextResponse, type NextRequest, after } from "next/server";
import { guildIdFromRequest, isBlockedDiscordId } from "@/lib/discord";
import { attachIdentity, requireDiscordUser } from "@/lib/identity";
import { stateFor, todayStr } from "@/lib/game";
import { updateLivePreviewMessage } from "@/lib/discord-live-preview";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const date = todayStr();
  const guildId = guildIdFromRequest(request);
  const identity = await requireDiscordUser(request);
  if (!identity) {
    return NextResponse.json(
      { error: "Couldn't link your Discord identity. Close Bitedle and launch it again." },
      { status: 428 },
    );
  }
  const store = getStore();

  // Defense-in-depth: catch a session opened before the block whose player is
  // linked to a blocked Discord id (the interaction gate stops fresh launches).
  const me = await store.getUser(identity.id);
  if (isBlockedDiscordId(me?.discordUserId)) {
    return NextResponse.json({ error: "You don't have access to Bitedle." }, { status: 403 });
  }

  if (guildId) {
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
