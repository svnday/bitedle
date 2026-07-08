import { ImageResponse } from "next/og";
import type { TodayRow } from "./store";
import { puzzleNumber } from "./game";
import { discordAvatarUrl } from "./discord";
import { squareTrail } from "./share-text";

/**
 * Shared channel-stats summary rendering + posting, used by both the daily
 * summary cron (src/app/api/cron/daily-summary) and the on-demand throttled
 * preview posted when someone launches the Activity
 * (src/app/api/discord/interactions).
 */

/** Leaderboard-style ordering: winners first (by score), then losers (by most
 *  clicks survived), ties broken by who finished first. Matches the today-sort
 *  in computeLeaderboard (src/lib/game.ts). */
export function sortTodayRows(rows: TodayRow[]): TodayRow[] {
  return [...rows].sort((a, b) => {
    if (a.status !== b.status) return a.status === "won" ? -1 : 1;
    if (a.status === "won" && a.score !== b.score) return (a.score ?? 0) - (b.score ?? 0);
    if (a.status === "lost" && a.clickCount !== b.clickCount) return b.clickCount - a.clickCount;
    return a.finishedAt - b.finishedAt;
  });
}

export function renderSummaryImage(rows: TodayRow[], date: string) {
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

export async function postImageToChannel(opts: {
  channelId: string;
  botToken: string;
  pngBuffer: ArrayBuffer;
  content: string;
}): Promise<{ ok: boolean; status: number; body: string }> {
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content: opts.content }));
  form.append("files[0]", new Blob([opts.pngBuffer], { type: "image/png" }), "results.png");

  const res = await fetch(`https://discord.com/api/v10/channels/${opts.channelId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${opts.botToken}` }, // no Content-Type — fetch sets the multipart boundary itself
    body: form,
  });

  return { ok: res.ok, status: res.status, body: res.ok ? "" : await res.text() };
}
