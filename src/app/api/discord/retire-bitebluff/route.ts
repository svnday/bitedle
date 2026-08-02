import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

function authorized(request: NextRequest): boolean {
  const expected = process.env.BITEDLE_SECRET;
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !actual) return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return (
    expectedBytes.length === actualBytes.length &&
    timingSafeEqual(expectedBytes, actualBytes)
  );
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!clientId || !botToken) {
    return NextResponse.json(
      { error: "Discord application credentials are unavailable." },
      { status: 503 },
    );
  }

  const commandsUrl = `https://discord.com/api/v10/applications/${clientId}/commands`;
  const headers = { Authorization: `Bot ${botToken}` };
  const listResponse = await fetch(commandsUrl, { headers, cache: "no-store" });
  if (!listResponse.ok) {
    return NextResponse.json(
      { error: "Could not list Discord commands.", status: listResponse.status },
      { status: 502 },
    );
  }

  const commands = (await listResponse.json()) as Array<{
    id: string;
    name: string;
    type: number;
  }>;
  const bitebluff = commands.find(
    (command) => command.type === 1 && command.name === "bitebluff",
  );
  if (!bitebluff) {
    return NextResponse.json({ ok: true, deleted: false });
  }

  const deleteResponse = await fetch(`${commandsUrl}/${bitebluff.id}`, {
    method: "DELETE",
    headers,
  });
  if (!deleteResponse.ok) {
    return NextResponse.json(
      { error: "Could not delete /bitebluff.", status: deleteResponse.status },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, deleted: true });
}
