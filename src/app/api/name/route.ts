import { NextResponse, type NextRequest } from "next/server";
import { attachIdentity, ensureUser, sanitizeName } from "@/lib/identity";
import { getStore } from "@/lib/store";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const name = sanitizeName(body?.name);
  if (!name) {
    return NextResponse.json(
      { error: "Please enter a name (up to 20 characters)" },
      { status: 400 },
    );
  }

  const identity = await ensureUser(request);
  await getStore().setUserName(identity.id, name);

  return attachIdentity(NextResponse.json({ username: name }), identity);
}
