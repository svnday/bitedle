import { NextResponse, type NextRequest, after } from "next/server";
import {
  finishRace,
  raceStateFor,
  readyRace,
  rematchRace,
  updateRaceProgress,
} from "@/lib/biteracer-race";
import { DISCORD_USER_HEADER_NAME, SNOWFLAKE_RE } from "@/lib/discord";
import { resolveUser } from "@/lib/identity";
import { getStore } from "@/lib/store";
import { updateBiteracerPreview } from "@/lib/biteracer-discord-preview";

export const runtime = "nodejs";

async function raceIdentity(request: NextRequest) {
  const discordUserId = request.headers.get(DISCORD_USER_HEADER_NAME);
  if (!discordUserId || !SNOWFLAKE_RE.test(discordUserId)) return null;
  const userId = await resolveUser(request);
  if (!userId) return null;
  const user = await getStore().getUser(userId);
  return user?.discordUserId === discordUserId ? { userId, discordUserId } : null;
}

function validRaceId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

export async function GET(request: NextRequest) {
  const identity = await raceIdentity(request);
  if (!identity) return NextResponse.json({ error: "Discord identity required" }, { status: 428 });
  const raceId = request.nextUrl.searchParams.get("raceId");
  if (!validRaceId(raceId)) return NextResponse.json({ error: "Invalid race" }, { status: 400 });
  const state = await raceStateFor(raceId, identity.discordUserId, identity.userId);
  if (state) after(() => updateBiteracerPreview(raceId));
  return state
    ? NextResponse.json(state)
    : NextResponse.json({ error: "Race not found" }, { status: 404 });
}

export async function POST(request: NextRequest) {
  const identity = await raceIdentity(request);
  if (!identity) return NextResponse.json({ error: "Discord identity required" }, { status: 428 });
  const body = await request.json().catch(() => null);
  if (!validRaceId(body?.raceId)) {
    return NextResponse.json({ error: "Invalid race" }, { status: 400 });
  }
  try {
    if (body.action === "ready") {
      await readyRace(body.raceId, identity.discordUserId);
    } else if (body.action === "progress") {
      if (typeof body.typed !== "string" || body.typed.length > 1_000) {
        return NextResponse.json({ error: "Invalid progress" }, { status: 400 });
      }
      await updateRaceProgress({
        raceId: body.raceId,
        discordUserId: identity.discordUserId,
        typed: body.typed,
        sequence: body.sequence,
      });
    } else if (body.action === "finish") {
      if (typeof body.typed !== "string") {
        return NextResponse.json({ error: "Invalid finish" }, { status: 400 });
      }
      await finishRace(body.raceId, identity.discordUserId, body.typed);
    } else if (body.action === "rematch") {
      const race = await rematchRace(body.raceId, identity.discordUserId);
      const state = await raceStateFor(race.id, identity.discordUserId, identity.userId);
      after(() => updateBiteracerPreview(race.id, true));
      return NextResponse.json(state);
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    const state = await raceStateFor(body.raceId, identity.discordUserId, identity.userId);
    after(() =>
      updateBiteracerPreview(
        body.raceId,
        body.action === "ready" || body.action === "finish",
      ),
    );
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Race update failed" },
      { status: 409 },
    );
  }
}
