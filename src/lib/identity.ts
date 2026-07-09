import type { NextRequest, NextResponse } from "next/server";
import { DISCORD_USER_HEADER_NAME, guildIdFromRequest, SNOWFLAKE_RE } from "./discord";
import { getStore } from "./store";

export const AUTH_COOKIE = "bitedle_id";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Identity {
  id: string;
}

export function defaultName(id: string): string {
  return `Player-${id.slice(0, 4)}`;
}

/**
 * Cleans a free-form display name: strips control characters, collapses
 * whitespace, caps the length. Returns null if nothing usable remains.
 */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw
    .replace(/\p{C}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20)
    .trim();
  return name.length > 0 ? name : null;
}

/** The caller's player id if their cookie names a known player, else null. */
export async function resolveUser(request: NextRequest): Promise<string | null> {
  const value = request.cookies.get(AUTH_COOKIE)?.value;
  const store = getStore();
  if (value && UUID_RE.test(value)) {
    const user = await store.getUser(value);
    if (user !== null) return value;
  }

  const discordUserId = request.headers.get(DISCORD_USER_HEADER_NAME);
  if (!discordUserId || !SNOWFLAKE_RE.test(discordUserId)) return null;
  return store.getUserIdByDiscordId(discordUserId);
}

/**
 * Returns the caller's player id, provisioning an anonymous player (with a
 * placeholder name) on first contact. No sign-in — the cookie IS the identity.
 */
export async function ensureUser(request: NextRequest): Promise<Identity> {
  const existing = await resolveUser(request);
  if (existing) return { id: existing };

  const id = crypto.randomUUID();
  await getStore().createUser(id, defaultName(id));
  return { id };
}

/** Discord guild gameplay must be tied to a real Discord identity. */
export async function requireDiscordUser(request: NextRequest): Promise<Identity | null> {
  if (!guildIdFromRequest(request)) return ensureUser(request);

  const id = await resolveUser(request);
  if (!id) return null;
  const user = await getStore().getUser(id);
  return user?.discordUserId ? { id } : null;
}

/**
 * (Re)issues the identity cookie, refreshing its one-year expiry.
 *
 * SameSite=None + Partitioned in production so the cookie survives inside a
 * sandboxed iframe (Discord Activities) — browsers refuse stricter SameSite
 * cookies on any iframe navigation. Applied site-wide, not just for Discord:
 * the cookie is a low-value anonymous UUID, so the broadened cross-site
 * behavior is an acceptable tradeoff. SameSite=None requires Secure, which
 * requires HTTPS, so this only applies once actually deployed (production).
 */
export function attachIdentity(res: NextResponse, identity: Identity): NextResponse {
  const isProd = process.env.NODE_ENV === "production";
  res.cookies.set(AUTH_COOKIE, identity.id, {
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    partitioned: isProd,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
