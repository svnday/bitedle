import { NextResponse, type NextRequest } from "next/server";
import { SNOWFLAKE_RE } from "@/lib/discord";
import { attachIdentity, ensureUser } from "@/lib/identity";
import { getStore } from "@/lib/store";

/**
 * Links a player's real Discord identity (for avatar display only) to their
 * existing anonymous Bitedle player. Never posts anywhere, never affects
 * gameplay — purely a display enhancement for the leaderboard.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const discordUserId = body?.discordUserId;
  const discordAvatar = body?.discordAvatar ?? null;
  const discordName = body?.discordName;
  if (typeof discordUserId !== "string" || !SNOWFLAKE_RE.test(discordUserId)) {
    return NextResponse.json({ error: "Invalid Discord user id" }, { status: 400 });
  }
  if (discordAvatar !== null && typeof discordAvatar !== "string") {
    return NextResponse.json({ error: "Invalid avatar" }, { status: 400 });
  }
  if (typeof discordName !== "string" || discordName.length === 0) {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }

  const identity = await ensureUser(request);
  const store = getStore();
  await store.setDiscordIdentity(identity.id, discordUserId, discordAvatar);
  // The Discord identity is verified (unlike a free-form chosen name), so it
  // always takes over as the display name — every session, in case the
  // player has since changed their Discord name.
  await store.setUserName(identity.id, discordName);
  return attachIdentity(NextResponse.json({ ok: true }), identity);
}
