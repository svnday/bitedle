import { NextResponse, type NextRequest, after } from "next/server";
import { guildIdFromRequest } from "@/lib/discord";
import { updateLivePreviewMessage } from "@/lib/discord-live-preview";
import { attachIdentity, ensureUser } from "@/lib/identity";
import { layoutFor, stateFor, todayStr } from "@/lib/game";
import { getStore } from "@/lib/store";
import { BOARD_SIZE, type GameRecord } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const index = body?.index;
  if (!Number.isInteger(index) || index < 0 || index >= BOARD_SIZE) {
    return NextResponse.json({ error: "Invalid cell" }, { status: 400 });
  }

  const identity = await ensureUser(request);
  const store = getStore();
  const date = todayStr();
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
        { error: "You already played today's Bitedle", state: await stateFor(identity.id, date) },
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
      updateLivePreviewMessage({ guildId }).catch((e) => {
        console.error(`click: live preview update failed for guild ${guildId}`, e);
      }),
    );
  }

  return attachIdentity(
    NextResponse.json({ result, state: await stateFor(identity.id, date) }),
    identity,
  );
}
