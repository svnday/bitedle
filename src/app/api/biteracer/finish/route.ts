import { NextResponse, type NextRequest } from "next/server";
import { playerDate, playerTimeZone } from "@/lib/discord";
import { biteracerStateFor, passageById } from "@/lib/game-biteracer";
import { attachIdentity, ensureUser } from "@/lib/identity";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const typedText = body?.typedText;
  if (typeof typedText !== "string" || typedText.length === 0) {
    return NextResponse.json({ error: "Missing typed text" }, { status: 400 });
  }

  const identity = await ensureUser(request);
  const date = playerDate(request);
  const timeZone = playerTimeZone(request);
  const store = getStore();
  const game = await store.getBiteracerGame(date, identity.id);
  const passage = game ? passageById(game.passageId) : null;
  if (!passage) {
    return NextResponse.json({ error: "This passage is no longer available." }, { status: 409 });
  }

  // The client hard-caps input at the passage length and auto-submits on
  // reaching it, so anything else is an incomplete or malformed submission —
  // a plain 400, never silently truncated or partially credited.
  if (typedText.length !== passage.text.length) {
    return NextResponse.json(
      { error: "Finish typing the full passage before submitting." },
      { status: 400 },
    );
  }

  if (!game || game.status !== "playing") {
    return attachIdentity(
      NextResponse.json(
        {
          error: game ? "You already finished today's Biteracer" : "Start today's run first",
          state: await biteracerStateFor(identity.id, date, timeZone),
        },
        { status: 409 },
      ),
      identity,
    );
  }

  // Server-authoritative clock: started_at was recorded by /start and is
  // immutable, so a client can never claim a faster time than actually
  // elapsed. Floor of 1 guards divide-by-zero if now === startedAt.
  const now = Date.now();
  const elapsedMs = Math.max(1, now - game.startedAt);
  // Final-state, position-by-position comparison (not a keystroke log) — with
  // free backspace-correction, only the submitted string matters.
  let correctChars = 0;
  for (let i = 0; i < passage.text.length; i++) {
    if (typedText[i] === passage.text[i]) correctChars++;
  }
  const errorCount = passage.text.length - correctChars;
  const accuracy = Math.round((correctChars / passage.text.length) * 1000) / 10;
  const minutes = elapsedMs / 60_000;
  const rawWpm = Math.round((typedText.length / 5 / minutes) * 10) / 10;
  const netWpm = Math.round((correctChars / 5 / minutes) * 10) / 10;

  const finished = await store.finishBiteracerGame(date, identity.id, {
    finishedAt: now,
    netWpm,
    rawWpm,
    accuracy,
    elapsedMs,
    correctChars,
    errorCount,
  });
  if (!finished) {
    // Lost the race to a concurrent finish (e.g. a duplicate submit).
    return attachIdentity(
      NextResponse.json(
        {
          error: "You already finished today's Biteracer",
          state: await biteracerStateFor(identity.id, date, timeZone),
        },
        { status: 409 },
      ),
      identity,
    );
  }
  return attachIdentity(
    NextResponse.json(await biteracerStateFor(identity.id, date, timeZone)),
    identity,
  );
}
