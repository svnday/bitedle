import { NextResponse, type NextRequest, after } from "next/server";
import {
  aimBiteshooter,
  biteshooterStateFor,
  cancelBiteshooter,
  forfeitBiteshooter,
  readyBiteshooter,
  rematchBiteshooter,
} from "@/lib/biteshooter";
import { updateBiteshooterPreview } from "@/lib/biteshooter-discord-preview";
import { DISCORD_USER_HEADER_NAME, SNOWFLAKE_RE } from "@/lib/discord";
import { resolveUser } from "@/lib/identity";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

const AIM_WINDOW_MS = 1_000;
const MAX_AIM_REQUESTS_PER_WINDOW = 30;
const aimWindows = new Map<string, { startedAt: number; requests: number }>();

function allowAimRequest(matchId: string, discordUserId: string, now = Date.now()): boolean {
  const key = `${matchId}:${discordUserId}`;
  const current = aimWindows.get(key);
  if (!current || now - current.startedAt >= AIM_WINDOW_MS) {
    aimWindows.set(key, { startedAt: now, requests: 1 });
    if (aimWindows.size > 2_000) {
      for (const [entryKey, entry] of aimWindows) {
        if (now - entry.startedAt >= AIM_WINDOW_MS) aimWindows.delete(entryKey);
      }
    }
    return true;
  }
  current.requests += 1;
  return current.requests <= MAX_AIM_REQUESTS_PER_WINDOW;
}
async function identityFor(request: NextRequest) {
  const discordUserId = request.headers.get(DISCORD_USER_HEADER_NAME);
  if (!discordUserId || !SNOWFLAKE_RE.test(discordUserId)) return null;
  const userId = await resolveUser(request);
  if (!userId) return null;
  const user = await getStore().getUser(userId);
  return user?.discordUserId === discordUserId ? { userId, discordUserId } : null;
}

function validMatchId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

export async function GET(request: NextRequest) {
  const identity = await identityFor(request);
  if (!identity) return NextResponse.json({ error: "Discord identity required" }, { status: 428 });
  const matchId = request.nextUrl.searchParams.get("matchId");
  if (!validMatchId(matchId)) {
    return NextResponse.json({ error: "Invalid match" }, { status: 400 });
  }
  const state = await biteshooterStateFor(matchId, identity.discordUserId, identity.userId);
  if (state) after(() => updateBiteshooterPreview(matchId));
  return state
    ? NextResponse.json(state)
    : NextResponse.json({ error: "Match not found" }, { status: 404 });
}

export async function POST(request: NextRequest) {
  const identity = await identityFor(request);
  if (!identity) return NextResponse.json({ error: "Discord identity required" }, { status: 428 });
  const body = await request.json().catch(() => null);
  if (!validMatchId(body?.matchId)) {
    return NextResponse.json({ error: "Invalid match" }, { status: 400 });
  }
  try {
    let matchId = body.matchId as string;
    let accepted: boolean | undefined;
    let damage: number | undefined;
    if (body.action === "ready") {
      await readyBiteshooter(matchId, identity.discordUserId);
    } else if (body.action === "aim") {
      if (
        !Number.isSafeInteger(body.sequence) ||
        !Number.isSafeInteger(body.targetIndex) ||
        typeof body.point?.x !== "number" ||
        typeof body.point?.y !== "number"
      ) {
        return NextResponse.json({ error: "Invalid aim" }, { status: 400 });
      }
      if (!allowAimRequest(matchId, identity.discordUserId)) {
        return NextResponse.json(
          { error: "Shots are arriving too quickly" },
          { status: 429 },
        );
      }
      const result = await aimBiteshooter({
        matchId,
        discordUserId: identity.discordUserId,
        sequence: body.sequence,
        targetIndex: body.targetIndex,
        point: body.point,
      });
      accepted = result.accepted;
      damage = result.damage;
    } else if (body.action === "cancel") {
      await cancelBiteshooter(matchId, identity.discordUserId);
    } else if (body.action === "forfeit") {
      await forfeitBiteshooter(matchId, identity.discordUserId);
    } else if (body.action === "rematch") {
      const rematch = await rematchBiteshooter(matchId, identity.discordUserId);
      matchId = rematch.id;
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    const state = await biteshooterStateFor(matchId, identity.discordUserId, identity.userId);
    if (!state) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }
    after(() => updateBiteshooterPreview(matchId, body.action !== "aim"));
    return NextResponse.json({
      ...state,
      ...(accepted === undefined ? {} : { accepted, damage }),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Match update failed" },
      { status: 409 },
    );
  }
}
