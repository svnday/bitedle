import type { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, defaultName, getDb, newUserId, saveDb, userIdFromCookie } from "./db";

export interface Identity {
  id: string;
}

/**
 * Returns the caller's player id, provisioning an anonymous player (with a
 * placeholder name) on first contact. No sign-in — the cookie IS the identity.
 */
export function ensureUser(request: NextRequest): Identity {
  const existing = userIdFromCookie(request.cookies.get(AUTH_COOKIE)?.value);
  if (existing) return { id: existing };

  const db = getDb();
  const id = newUserId();
  db.users[id] = { name: defaultName(id), createdAt: Date.now() };
  saveDb();
  return { id };
}

/** (Re)issues the identity cookie, refreshing its one-year expiry. */
export function attachIdentity(res: NextResponse, identity: Identity): NextResponse {
  res.cookies.set(AUTH_COOKIE, identity.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
