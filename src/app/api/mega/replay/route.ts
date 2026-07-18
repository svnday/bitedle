import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  guildIdFromRequest,
  isBlockedDiscordId,
  playerDate,
  playerTimeZone,
} from "@/lib/discord";
import { megaStateFor } from "@/lib/game-mega";
import { attachIdentity, ensureUser } from "@/lib/identity";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (guildIdFromRequest(request) !== null) {
    return NextResponse.json(
      { error: "Bitedle XL is only playable on the website." },
      { status: 403 },
    );
  }

  const identity = await ensureUser(request);
  const store = getStore();
  const timeZone = playerTimeZone(request);
  const date = playerDate(request);
  const me = await store.getUser(identity.id);
  if (isBlockedDiscordId(me?.discordUserId)) {
    return NextResponse.json({ error: "You don't have access to Bitedle." }, { status: 403 });
  }

  const replayed = await store.replayMegaGame(date, identity.id, crypto.randomUUID());
  if (!replayed) {
    return attachIdentity(
      NextResponse.json(
        { error: "Finish the current Bitedle XL board before playing again." },
        { status: 409 },
      ),
      identity,
    );
  }

  return attachIdentity(
    NextResponse.json(await megaStateFor(identity.id, date, timeZone)),
    identity,
  );
}
