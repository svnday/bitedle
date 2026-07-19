import { NextResponse, type NextRequest, after } from "next/server";
import {
  guildIdFromRequest,
  isBlockedDiscordId,
  playerDate,
  playerTimeZone,
} from "@/lib/discord";
import { megaStateFor } from "@/lib/game-mega";
import { attachIdentity, ensureUser } from "@/lib/identity";
import { getStore } from "@/lib/store";
import { MEGA_BOARD_SIZE, type MegaGameRecord } from "@/lib/types";
import {
  ensureBitesweeperBoard,
  recordBitesweeperPresence,
} from "@/lib/bitesweeper-presence";
import { updateBitesweeperPreview } from "@/lib/bitesweeper-discord-preview";

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
  const instanceId = await ensureBitesweeperBoard(request, store, identity.id, date);
  const me = await store.getUser(identity.id);
  if (isBlockedDiscordId(me?.discordUserId)) {
    return NextResponse.json({ error: "You don't have access to Bitesweeper." }, { status: 403 });
  }

  const game: MegaGameRecord = (await store.getMegaGame(date, identity.id)) ?? {
    clicks: [],
    flags: [],
    status: "playing",
    score: null,
    finishedAt: null,
    boardSeed: null,
    activityInstanceId: null,
  };
  if (game.status !== "playing") {
    return attachIdentity(
      NextResponse.json({ error: "This Bitesweeper board is already finished." }, { status: 409 }),
      identity,
    );
  }
  if (game.clicks.some((click) => click.index === index)) {
    return attachIdentity(
      NextResponse.json({ error: "Revealed squares can't be flagged." }, { status: 409 }),
      identity,
    );
  }

  game.flags = game.flags.includes(index)
    ? game.flags.filter((flaggedIndex) => flaggedIndex !== index)
    : [...game.flags, index].sort((a, b) => a - b);
  await store.putMegaGame(date, identity.id, game);
  await recordBitesweeperPresence(request, store, identity.id, date);

  const guildId = guildIdFromRequest(request);
  if (guildId && instanceId) {
    after(() =>
      updateBitesweeperPreview({ guildId, instanceId }).catch((e) => {
        console.error(`mega-flag: preview update failed for guild ${guildId}`, e);
      }),
    );
  }

  return attachIdentity(
    NextResponse.json(await megaStateFor(identity.id, date, timeZone)),
    identity,
  );
}
