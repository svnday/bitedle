import { NextResponse, type NextRequest } from "next/server";

/**
 * Stateless proxy to Discord's OAuth token endpoint. The Embedded App SDK's
 * authorize() command only returns a code; exchanging it for an access token
 * requires the client secret, which must never reach the browser.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const code = body?.code;
  if (typeof code !== "string" || code.length === 0) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Discord OAuth not configured" }, { status: 500 });
  }

  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
    }),
  });
  if (!tokenRes.ok) {
    return NextResponse.json({ error: "Discord token exchange failed" }, { status: 502 });
  }

  const { access_token } = await tokenRes.json();
  return NextResponse.json({ access_token });
}
