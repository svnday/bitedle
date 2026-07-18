import { NextResponse, type NextRequest, after } from "next/server";
import { guildIdFromRequest, isBlockedDiscordId, playerDate, SNOWFLAKE_RE } from "@/lib/discord";
import { updateLivePreviewMessage } from "@/lib/discord-live-preview";
import { attachIdentity, ensureUser } from "@/lib/identity";
import { getStore } from "@/lib/store";

/**
 * Links a player's real Discord identity (for avatar display only) to their
 * existing anonymous Bitedle player. Never affects gameplay — purely a
 * display enhancement for Discord surfaces and the leaderboard.
 */
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const discordUserId = body?.discordUserId;
  const discordAvatar = body?.discordAvatar ?? null;
  const discordName = body?.discordName;
  if (typeof discordUserId !== "string" || !SNOWFLAKE_RE.test(discordUserId)) {
    return NextResponse.json({ error: "Invalid Discord user id" }, { status: 400 });
  }
  // A blocked user never links an avatar/name or merges devices.
  if (isBlockedDiscordId(discordUserId)) {
    return NextResponse.json({ error: "You don't have access to Bitedle." }, { status: 403 });
  }
  if (discordAvatar !== null && typeof discordAvatar !== "string") {
    return NextResponse.json({ error: "Invalid avatar" }, { status: 400 });
  }
  if (typeof discordName !== "string" || discordName.length === 0) {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }

  const identity = await ensureUser(request);
  const store = getStore();

  // Cross-device dedupe: Discord's desktop, mobile and browser clients have
  // separate cookie jars, so the same person would otherwise become a new
  // anonymous player on each device. If this Discord id already belongs to a
  // (canonical, oldest) player, fold the caller's cookie user into it and
  // re-point this device's cookie below. A request already in flight with the
  // old cookie can recreate an orphan game for a few ms; identify runs every
  // embedded session, so the next launch re-absorbs it.
  const canonicalId = await store.getUserIdByDiscordId(discordUserId);
  let effectiveId = identity.id;
  if (canonicalId !== null && canonicalId !== identity.id) {
    await store.mergeUsers(identity.id, canonicalId);
    effectiveId = canonicalId;
  }

  try {
    await store.setDiscordIdentity(effectiveId, discordUserId, discordAvatar);
  } catch (e) {
    // Unique-index conflict (23505): two devices ran their first-ever
    // identify concurrently and the other one linked a moment ago — merge
    // into that winner instead of failing.
    if ((e as { code?: string })?.code !== "23505") throw e;
    const winner = await store.getUserIdByDiscordId(discordUserId);
    if (!winner || winner === effectiveId) throw e;
    await store.mergeUsers(effectiveId, winner);
    effectiveId = winner;
    await store.setDiscordIdentity(effectiveId, discordUserId, discordAvatar);
  }

  // The Discord identity is verified (unlike a free-form chosen name), so it
  // always takes over as the display name — every session, in case the
  // player has since changed their Discord name.
  await store.setUserName(effectiveId, discordName);
  const guildId = guildIdFromRequest(request);
  if (guildId) {
    const date = playerDate(request);
    // Record the launch under the CANONICAL id and the player's local date —
    // the cross-device merge above may have just moved this session's game off
    // the cookie user that /api/state recorded, so re-record to keep the
    // player in this guild's window.
    await store.recordLaunch(date, effectiveId, guildId, Date.now());
    after(() =>
      updateLivePreviewMessage({ guildId }).catch((e) => {
        console.error(`discord-identify: live preview update failed for guild ${guildId}`, e);
      }),
    );
  }
  return attachIdentity(NextResponse.json({ ok: true }), { id: effectiveId });
}
