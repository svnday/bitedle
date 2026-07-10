import { NextResponse, type NextRequest, after } from "next/server";
import { guildIdFromRequest, isBlockedDiscordId, playerDate, playerTimeZone } from "@/lib/discord";
import { updateLivePreviewMessage } from "@/lib/discord-live-preview";
import { attachIdentity, requireDiscordUser } from "@/lib/identity";
import { layoutFor, stateFor } from "@/lib/game";
import { getStore } from "@/lib/store";
import { BOARD_SIZE, type GameRecord } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const index = body?.index;
  if (!Number.isInteger(index) || index < 0 || index >= BOARD_SIZE) {
    return NextResponse.json({ error: "Invalid cell" }, { status: 400 });
  }

  const identity = await requireDiscordUser(request);
  if (!identity) {
    return NextResponse.json(
      { error: "Couldn't link your Discord identity. Close Bitedle and launch it again." },
      { status: 428 },
    );
  }
  const store = getStore();
  // Same header the player's /api/state used, so board and clicks agree on day.
  const timeZone = playerTimeZone(request);
  const date = playerDate(request);

  // Defense-in-depth: a session opened before the block, linked to a blocked
  // Discord id, can't keep playing (the interaction gate stops fresh launches).
  const me = await store.getUser(identity.id);
  if (isBlockedDiscordId(me?.discordUserId)) {
    return NextResponse.json({ error: "You don't have access to Bitedle." }, { status: 403 });
  }

  const game: GameRecord = (await store.getGame(date, identity.id)) ?? {
    clicks: [],
    status: "playing",
    score: null,
    finishedAt: null,
    guildId: guildIdFromRequest(request),
  };

  if (game.status !== "playing") {
    return attachIdentity(
      NextResponse.json(
        { error: "You already played today's Bitedle", state: await stateFor(identity.id, date, timeZone) },
        { status: 409 },
      ),
      identity,
    );
  }
  if (game.clicks.some((c) => c.index === index)) {
    return attachIdentity(
      NextResponse.json({ error: "Cell already revealed" }, { status: 409 }),
      identity,
    );
  }

  const result = layoutFor(date)[index];
  game.clicks.push({ index, result });
  if (result === "bomb") {
    game.status = "lost";
    game.finishedAt = Date.now();
  } else if (result === "check") {
    game.status = "won";
    game.score = game.clicks.length;
    game.finishedAt = Date.now();
  }
  await store.putGame(date, identity.id, game);
  if (game.guildId) {
    const guildId = game.guildId;
    after(() =>
      updateLivePreviewMessage({ guildId, date }).catch((e) => {
        console.error(`click: live preview update failed for guild ${guildId}`, e);
      }),
    );
  }

  return attachIdentity(
    NextResponse.json({ result, state: await stateFor(identity.id, date, timeZone) }),
    identity,
  );
}
