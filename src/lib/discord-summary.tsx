import { ImageResponse } from "next/og";
import type { LivePreviewRow, TodayRow } from "./store";
import { puzzleNumber } from "./game";
import { discordAvatarUrl } from "./discord";
import { squareTrail } from "./share-text";

/**
 * Shared Discord image rendering + posting helpers, used by the daily summary,
 * /results, and the editable live Activity preview.
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

function liveProgressLabel(row: LivePreviewRow): string {
  if (row.status === "won") return `found it in ${row.score ?? row.clicks.length}`;
  if (row.status === "lost") return `boom after ${Math.max(0, row.clicks.length - 1)} misses`;
  if (row.clicks.length === 0) return "just started";
  return `${row.clicks.length} ${row.clicks.length === 1 ? "click" : "clicks"} in`;
}

function liveCell(result: LivePreviewRow["clicks"][number]["result"] | null, index: number) {
  const styles = {
    x: { backgroundColor: "#475569", color: "#fca5a5", glyph: "x" },
    bomb: { backgroundColor: "#b3392f", color: "#ffffff", glyph: "!" },
    check: { backgroundColor: "#538d4e", color: "#ffffff", glyph: "✓" },
    empty: { backgroundColor: "#111827", color: "#111827", glyph: "" },
  }[result ?? "empty"];

  return (
    <div
      key={index}
      style={{
        width: 24,
        height: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 3,
        border: "1px solid #334155",
        backgroundColor: styles.backgroundColor,
        color: styles.color,
        fontSize: 16,
        fontWeight: 800,
        lineHeight: 1,
      }}
    >
      {styles.glyph}
    </div>
  );
}

export function renderLivePreviewImage(rows: LivePreviewRow[], date: string) {
  const width = 900;
  const rowHeight = 118;
  const height = Math.max(360, 128 + rows.length * rowHeight + 48);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          backgroundColor: "#101114",
          color: "#f8fafc",
          padding: "34px 44px",
        }}
      >
        <div style={{ fontSize: 24, color: "#cbd5e1", marginBottom: 6 }}>
          {`Bitedle No. ${puzzleNumber(date)}`}
        </div>
        <div style={{ fontSize: 14, color: "#64748b", marginBottom: 26 }}>
          Live server progress
        </div>

        <div
          style={{
            width: 720,
            display: "flex",
            flexDirection: "column",
            border: "1px solid #2f333c",
            borderRadius: 20,
            overflow: "hidden",
          }}
        >
          {rows.map((row, rowIndex) => {
            const avatarUrl = discordAvatarUrl(row.discordUserId, row.discordAvatar);
            const cells = Array.from({ length: 25 }, (_, i) => row.clicks[i]?.result ?? null);

            return (
              <div
                key={row.userId}
                style={{
                  height: rowHeight,
                  display: "flex",
                  alignItems: "center",
                  padding: "18px 24px",
                  backgroundColor: rowIndex % 2 === 0 ? "#171923" : "#141720",
                  borderTop: rowIndex === 0 ? "0" : "1px solid #252936",
                }}
              >
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt=""
                    width={72}
                    height={72}
                    style={{ borderRadius: 9999, objectFit: "cover" }}
                  />
                ) : (
                  <div
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: 9999,
                      backgroundColor: "#334155",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 30,
                      fontWeight: 800,
                    }}
                  >
                    {row.name.charAt(0).toUpperCase()}
                  </div>
                )}

                <div
                  style={{
                    marginLeft: 18,
                    width: 220,
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: 800,
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {row.name}
                  </div>
                  <div style={{ fontSize: 16, color: "#94a3b8", marginTop: 5 }}>
                    {liveProgressLabel(row)}
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    width: 140,
                    gap: 4,
                    marginLeft: "auto",
                  }}
                >
                  {cells.map((result, i) => liveCell(result, i))}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ fontSize: 13, color: "#64748b", marginTop: 18 }}>
          Click order is shown left-to-right. Board positions stay hidden.
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
  filename?: string;
}): Promise<{ ok: boolean; status: number; body: string; messageId?: string }> {
  const form = new FormData();
  const filename = opts.filename ?? "results.png";
  form.append("payload_json", JSON.stringify({ content: opts.content }));
  form.append("files[0]", new Blob([opts.pngBuffer], { type: "image/png" }), filename);

  const res = await fetch(`https://discord.com/api/v10/channels/${opts.channelId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${opts.botToken}` }, // no Content-Type — fetch sets the multipart boundary itself
    body: form,
  });

  if (!res.ok) return { ok: false, status: res.status, body: await res.text() };

  const body = await res.json().catch(() => null);
  return { ok: true, status: res.status, body: "", messageId: body?.id };
}

export async function patchImageMessage(opts: {
  channelId: string;
  messageId: string;
  botToken: string;
  pngBuffer: ArrayBuffer;
  content: string;
}): Promise<{ ok: boolean; status: number; body: string }> {
  const form = new FormData();
  form.append(
    "payload_json",
    JSON.stringify({
      content: opts.content,
      attachments: [{ id: 0, filename: "preview.png" }],
    }),
  );
  form.append("files[0]", new Blob([opts.pngBuffer], { type: "image/png" }), "preview.png");

  const res = await fetch(
    `https://discord.com/api/v10/channels/${opts.channelId}/messages/${opts.messageId}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bot ${opts.botToken}` },
      body: form,
    },
  );

  return { ok: res.ok, status: res.status, body: res.ok ? "" : await res.text() };
}
