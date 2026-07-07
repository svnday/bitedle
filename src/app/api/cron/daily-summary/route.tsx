import { NextResponse, type NextRequest } from "next/server";
import { ImageResponse } from "next/og";
import { getStore, type TodayRow } from "@/lib/store";
import { todayStr, puzzleNumber } from "@/lib/game";
import { discordAvatarUrl } from "@/lib/discord";
import { squareTrail } from "@/lib/share-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // side-effecting (posts to Discord); never statically cache

interface GuildResult {
  guildId: string;
  status: "posted" | "skipped" | "failed" | "error";
  players?: number;
  error?: string;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    console.error("daily-summary: missing DISCORD_BOT_TOKEN");
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  const date = todayStr();
  const store = getStore();
  const guildChannels = await store.allGuildChannels();
  const results: GuildResult[] = [];

  // Each server's summary is independent — one failing/errored server must
  // never stop the rest from posting.
  for (const { guildId, channelId } of guildChannels) {
    try {
      const rows = await store.finishedGamesOn(date, guildId);
      if (rows.length === 0) {
        results.push({ guildId, status: "skipped" });
        continue;
      }

      const sorted = [...rows].sort((a, b) => {
        if (a.status !== b.status) return a.status === "won" ? -1 : 1;
        if (a.status === "won" && a.score !== b.score) return (a.score ?? 0) - (b.score ?? 0);
        if (a.status === "lost" && a.clickCount !== b.clickCount) return b.clickCount - a.clickCount;
        return a.finishedAt - b.finishedAt;
      }); // same ordering as computeLeaderboard's today-sort in src/lib/game.ts

      const pngBuffer = await renderSummaryImage(sorted, date).arrayBuffer();
      const posted = await postToDiscord({ channelId, botToken, pngBuffer });
      if (!posted.ok) {
        console.error(`daily-summary: Discord POST failed for guild ${guildId} (${posted.status}): ${posted.body}`);
        results.push({ guildId, status: "failed", error: `Discord ${posted.status}` });
        continue;
      }

      results.push({ guildId, status: "posted", players: sorted.length });
    } catch (e) {
      console.error(`daily-summary: error processing guild ${guildId}`, e);
      results.push({ guildId, status: "error", error: String(e) });
    }
  }

  return NextResponse.json({ results });
}

function renderSummaryImage(rows: TodayRow[], date: string) {
  const perRow = 6;
  const cardWidth = 168;
  const cardHeight = 190;
  const rowsCount = Math.ceil(rows.length / perRow);
  const width = 1200;
  const height = 140 + rowsCount * (cardHeight + 20) + 40;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#0f172a",
          padding: 40,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", marginBottom: 24 }}>
          <div style={{ fontSize: 40, fontWeight: 700, color: "#f8fafc" }}>
            {`Bitedle #${puzzleNumber(date)}`}
          </div>
          <div style={{ fontSize: 22, color: "#94a3b8", marginTop: 4 }}>{date}</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, width: "100%" }}>
          {rows.map((r) => {
            const misses = r.clickCount - 1;
            const avatarUrl = discordAvatarUrl(r.discordUserId, r.discordAvatar);
            return (
              <div
                key={r.userId}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  width: cardWidth,
                  height: cardHeight,
                  backgroundColor: "#1e293b",
                  borderRadius: 16,
                  padding: 16,
                }}
              >
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="" width={64} height={64} style={{ borderRadius: 9999 }} />
                ) : (
                  <div
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 9999,
                      backgroundColor: "#334155",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 28,
                      color: "#f8fafc",
                    }}
                  >
                    {r.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div style={{ fontSize: 26, marginTop: 12 }}>{squareTrail(r.status, misses)}</div>
                <div
                  style={{
                    fontSize: 16,
                    color: "#f8fafc",
                    marginTop: 8,
                    maxWidth: cardWidth - 16,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                >
                  {r.name}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    ),
    { width, height },
  );
}

async function postToDiscord(opts: {
  channelId: string;
  botToken: string;
  pngBuffer: ArrayBuffer;
}): Promise<{ ok: boolean; status: number; body: string }> {
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content: "Here are today's results so far!" }));
  form.append("files[0]", new Blob([opts.pngBuffer], { type: "image/png" }), "results.png");

  const res = await fetch(`https://discord.com/api/v10/channels/${opts.channelId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${opts.botToken}` }, // no Content-Type — fetch sets the multipart boundary itself
    body: form,
  });

  return { ok: res.ok, status: res.status, body: res.ok ? "" : await res.text() };
}
