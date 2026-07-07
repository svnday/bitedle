import type { NextRequest, NextResponse } from "next/server";
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
  if (!value || !UUID_RE.test(value)) return null;
  const user = await getStore().getUser(value);
  return user === null ? null : value;
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

/** (Re)issues the identity cookie, refreshing its one-year expiry. */
export function attachIdentity(res: NextResponse, identity: Identity): NextResponse {
  res.cookies.set(AUTH_COOKIE, identity.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
