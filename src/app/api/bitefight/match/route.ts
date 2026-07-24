import { NextResponse, type NextRequest, after } from "next/server";
import {
  bitefightStateFor,
  forfeitBitefight,
  punchBitefight,
  readyBitefight,
  rematchBitefight,
} from "@/lib/bitefight";
import { updateBitefightPreview } from "@/lib/bitefight-discord-preview";
import { DISCORD_USER_HEADER_NAME, SNOWFLAKE_RE } from "@/lib/discord";
import { resolveUser } from "@/lib/identity";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

const PUNCH_WINDOW_MS = 1_000;
const MAX_PUNCH_REQUESTS_PER_WINDOW = 80;
const punchWindows = new Map<string, { startedAt: number; requests: number }>();

function allowPunchRequest(matchId: string, discordUserId: string, now = Date.now()): boolean {
  const key = `${matchId}:${discordUserId}`;
  const current = punchWindows.get(key);
  if (!current || now - current.startedAt >= PUNCH_WINDOW_MS) {
    punchWindows.set(key, { startedAt: now, requests: 1 });
    if (punchWindows.size > 2_000) {
      for (const [entryKey, entry] of punchWindows) {
        if (now - entry.startedAt >= PUNCH_WINDOW_MS) punchWindows.delete(entryKey);
      }
    }
    return true;
  }
  current.requests += 1;
  return current.requests <= MAX_PUNCH_REQUESTS_PER_WINDOW;
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
    return NextResponse.json({ error: "Invalid fight" }, { status: 400 });
  }
  const state = await bitefightStateFor(matchId, identity.discordUserId, identity.userId);
  if (state) after(() => updateBitefightPreview(matchId));
  return state
    ? NextResponse.json(state)
    : NextResponse.json({ error: "Fight not found" }, { status: 404 });
}

export async function POST(request: NextRequest) {
  const identity = await identityFor(request);
  if (!identity) return NextResponse.json({ error: "Discord identity required" }, { status: 428 });
  const body = await request.json().catch(() => null);
  if (!validMatchId(body?.matchId)) {
    return NextResponse.json({ error: "Invalid fight" }, { status: 400 });
  }
  try {
    let matchId = body.matchId as string;
    let accepted: boolean | undefined;
    if (body.action === "ready") {
      await readyBitefight(matchId, identity.discordUserId);
    } else if (body.action === "punch") {
      if (!Number.isSafeInteger(body.sequence)) {
        return NextResponse.json({ error: "Invalid punch" }, { status: 400 });
      }
      if (!allowPunchRequest(matchId, identity.discordUserId)) {
        return NextResponse.json(
          { error: "Punches are arriving too quickly" },
          { status: 429 },
        );
      }
      const result = await punchBitefight({
        matchId,
        discordUserId: identity.discordUserId,
        sequence: body.sequence,
      });
      accepted = result.accepted;
    } else if (body.action === "forfeit") {
      await forfeitBitefight(matchId, identity.discordUserId);
    } else if (body.action === "rematch") {
      const rematch = await rematchBitefight(matchId, identity.discordUserId);
      matchId = rematch.id;
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    const state = await bitefightStateFor(matchId, identity.discordUserId, identity.userId);
    if (!state) {
      return NextResponse.json({ error: "Fight not found" }, { status: 404 });
    }
    after(() => updateBitefightPreview(matchId, body.action !== "punch"));
    return NextResponse.json({ ...state, ...(accepted === undefined ? {} : { accepted }) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Fight update failed" },
      { status: 409 },
    );
  }
}
