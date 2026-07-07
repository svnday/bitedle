import { NextResponse, type NextRequest } from "next/server";
import { getDb, saveDb, type GameRecord } from "@/lib/db";
import { attachIdentity, ensureUser } from "@/lib/identity";
import { layoutFor, stateFor, todayStr } from "@/lib/game";
import { BOARD_SIZE } from "@/lib/types";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const index = body?.index;
  if (!Number.isInteger(index) || index < 0 || index >= BOARD_SIZE) {
    return NextResponse.json({ error: "Invalid cell" }, { status: 400 });
  }

  const identity = ensureUser(request);
  const db = getDb();
  const date = todayStr();
  const games = (db.games[date] ??= {});
  const game: GameRecord = (games[identity.id] ??= {
    clicks: [],
    status: "playing",
    score: null,
    finishedAt: null,
  });

  if (game.status !== "playing") {
    return attachIdentity(
      NextResponse.json(
        { error: "You already played today's Bitedle", state: stateFor(db, identity.id, date) },
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

  const result = layoutFor(db.secret, date)[index];
  game.clicks.push({ index, result });
  if (result === "bomb") {
    game.status = "lost";
    game.finishedAt = Date.now();
  } else if (result === "check") {
    game.status = "won";
    game.score = game.clicks.length;
    game.finishedAt = Date.now();
  }
  saveDb();

  return attachIdentity(
    NextResponse.json({ result, state: stateFor(db, identity.id, date) }),
    identity,
  );
}
