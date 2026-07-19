import crypto from "node:crypto";
import { NextResponse, type NextRequest, after } from "next/server";
import {
  activityInstanceIdFromRequest,
  guildIdFromRequest,
  isBlockedDiscordId,
  playerDate,
  playerTimeZone,
} from "@/lib/discord";
import { megaStateFor } from "@/lib/game-mega";
import { attachIdentity, ensureUser } from "@/lib/identity";
import { getStore } from "@/lib/store";
import { recordBitesweeperPresence } from "@/lib/bitesweeper-presence";
import { updateBitesweeperPreview } from "@/lib/bitesweeper-discord-preview";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const identity = await ensureUser(request);
  const store = getStore();
  const timeZone = playerTimeZone(request);
  const date = playerDate(request);
  const me = await store.getUser(identity.id);
  if (isBlockedDiscordId(me?.discordUserId)) {
    return NextResponse.json({ error: "You don't have access to Bitesweeper." }, { status: 403 });
  }

  const replayed = await store.replayMegaGame(date, identity.id, crypto.randomUUID());
  if (!replayed) {
    return attachIdentity(
      NextResponse.json(
        { error: "Finish the current Bitesweeper board before playing again." },
        { status: 409 },
      ),
      identity,
    );
  }

  await recordBitesweeperPresence(request, store, identity.id, date);
  const guildId = guildIdFromRequest(request);
  const instanceId = activityInstanceIdFromRequest(request);
  if (guildId && instanceId) {
    after(() =>
      updateBitesweeperPreview({ guildId, instanceId }).catch((e) => {
        console.error(`mega-replay: preview update failed for guild ${guildId}`, e);
      }),
    );
  }

  return attachIdentity(
    NextResponse.json(await megaStateFor(identity.id, date, timeZone)),
    identity,
  );
}
