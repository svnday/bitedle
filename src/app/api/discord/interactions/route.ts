import { NextResponse, type NextRequest } from "next/server";
import { verifyKey } from "discord-interactions";

function siteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "https://bitedle.vercel.app";
}

function reply(content: string) {
  return NextResponse.json({
    type: 4,
    data: {
      content,
      flags: 64,
    },
  });
}

export async function POST(request: NextRequest) {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  const rawBody = await request.text();

  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  const isValid =
    publicKey && signature && timestamp && (await verifyKey(rawBody, signature, timestamp, publicKey));

  if (!isValid) {
    // Discord sends a PING here (with a valid signature) to verify this URL
    // before it will let the Developer Portal save it as the Interactions
    // Endpoint URL — without this check, that verification step fails.
    return new NextResponse("Bad request signature", { status: 401 });
  }

  const body = JSON.parse(rawBody);

  if (body?.type === 1) {
    return NextResponse.json({ type: 1 });
  }

  if (body?.type === 2 && body?.data?.name === "play") {
    return reply(`Play today's Bitedle: ${siteUrl()}`);
  }

  if (body?.type === 2 && body?.data?.name === "share") {
    return reply(`Share your Bitedle results from: ${siteUrl()}`);
  }

  return reply("Unknown command.");
}
