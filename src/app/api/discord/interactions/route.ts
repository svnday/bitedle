import { NextResponse, type NextRequest } from "next/server";

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
  const rawBody = await request.text();
  let body: any;

  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

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

export function GET() {
  // Developer Portal verifies the interactions endpoint by sending a GET
  // request. Respond with 200 OK so the portal can validate the URL.
  return NextResponse.json({ ok: true });
}
