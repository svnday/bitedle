import { NextResponse, type NextRequest } from "next/server";
import { getDb, sanitizeName, saveDb } from "@/lib/db";
import { attachIdentity, ensureUser } from "@/lib/identity";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const name = sanitizeName(body?.name);
  if (!name) {
    return NextResponse.json(
      { error: "Please enter a name (up to 20 characters)" },
      { status: 400 },
    );
  }

  const identity = ensureUser(request);
  getDb().users[identity.id].name = name;
  saveDb();

  return attachIdentity(NextResponse.json({ username: name }), identity);
}
