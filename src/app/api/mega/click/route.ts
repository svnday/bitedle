import { NextResponse, type NextRequest } from "next/server";
import { isBlockedDiscordId, playerDate, playerTimeZone } from "@/lib/discord";
import { megaLayoutFor, megaStateFor } from "@/lib/game-mega";
import { attachIdentity, ensureUser } from "@/lib/identity";
import { getStore } from "@/lib/store";
import { MEGA_BOARD_SIZE, type MegaGameRecord } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const index = body?.index;
  if (!Number.isInteger(index) || index < 0 || index >= MEGA_BOARD_SIZE) {
    return NextResponse.json({ error: "Invalid cell" }, { status: 400 });
  }

  const identity = await ensureUser(request);
  const store = getStore();
  const timeZone = playerTimeZone(request);
  const date = playerDate(request);
  const me = await store.getUser(identity.id);
  if (isBlockedDiscordId(me?.discordUserId)) {
    return NextResponse.json({ error: "You don't have access to Bitedle." }, { status: 403 });
  }

  const game: MegaGameRecord = (await store.getMegaGame(date, identity.id)) ?? {
    clicks: [],
    status: "playing",
    score: null,
    finishedAt: null,
    boardSeed: null,
  };

  if (game.status !== "playing") {
    return attachIdentity(
      NextResponse.json(
        {
          error: "This Bitesweeper board is finished. Choose Play again for a fresh board.",
          state: await megaStateFor(identity.id, date, timeZone),
        },
        { status: 409 },
      ),
      identity,
    );
  }
  if (game.clicks.some((click) => click.index === index)) {
    return attachIdentity(
      NextResponse.json({ error: "Cell already revealed" }, { status: 409 }),
      identity,
    );
  }

  const result = megaLayoutFor(date, game.boardSeed ?? null)[index];
  game.clicks.push({ index, result });
  if (result === "bomb") {
    game.status = "lost";
    game.finishedAt = Date.now();
  } else if (result === "check") {
    game.status = "won";
    game.score = game.clicks.length;
    game.finishedAt = Date.now();
  }
  await store.putMegaGame(date, identity.id, game);

  return attachIdentity(
    NextResponse.json({
      result,
      state: await megaStateFor(identity.id, date, timeZone),
    }),
    identity,
  );
}
