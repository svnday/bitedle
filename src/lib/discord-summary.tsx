import { ImageResponse } from "next/og";
import type { LivePreviewRow, TodayRow } from "./store";
import { puzzleNumber } from "./game";
import { discordAvatarUrl } from "./discord";
import { squareTrail } from "./share-text";

/**
 * Shared Discord image rendering + posting helpers, used by the daily recap,
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

/** Wordle-esque tile palette: misses go yellow, the found check green, the
 *  bomb red; unrevealed cells stay dark. No glyphs — colors carry it all. */
const LIVE_TILE_COLORS = {
  x: "#b59f3b",
  bomb: "#b3392f",
  check: "#538d4e",
} as const;

/** Wordle-launch-style card grid: centered title, one rounded card per
 *  player with their avatar over a 5×5 tile grid showing click order
 *  left-to-right (never real board positions). */
export function renderLivePreviewImage(rows: LivePreviewRow[], date: string) {
  const perRow = Math.max(1, Math.min(rows.length, 5));
  const rowCount = Math.ceil(rows.length / perRow);
  const tile = 24;
  const tileGap = 4;
  const gridSize = 5 * tile + 4 * tileGap;
  const avatarSize = 88;
  const cardPad = 18;
  const cardWidth = gridSize + cardPad * 2;
  const cardHeight = cardPad * 2 + avatarSize + 14 + gridSize;
  const cardGap = 18;
  const margin = 40;
  const titleBlock = 60;
  const cardsWidth = perRow * cardWidth + (perRow - 1) * cardGap;
  const contentWidth = Math.max(cardsWidth, 260);
  const width = margin * 2 + contentWidth;
  const height = margin * 2 + titleBlock + rowCount * cardHeight + (rowCount - 1) * cardGap;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          backgroundColor: "#131316",
          padding: margin,
        }}
      >
        <div
          style={{
            fontSize: 26,
            fontWeight: 600,
            color: "#f2f3f5",
            marginBottom: 30,
            whiteSpace: "nowrap",
          }}
        >
          {`Bitedle No. ${puzzleNumber(date)}`}
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: cardGap,
            width: contentWidth,
          }}
        >
          {rows.map((row) => {
            const avatarUrl = discordAvatarUrl(row.discordUserId, row.discordAvatar);
            const cells = Array.from({ length: 25 }, (_, i) => row.clicks[i]?.result ?? null);

            return (
              <div
                key={row.userId}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  width: cardWidth,
                  height: cardHeight,
                  backgroundColor: "#212226",
                  border: "1px solid #2c2d31",
                  borderRadius: 26,
                  padding: cardPad,
                }}
              >
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt=""
                    width={avatarSize}
                    height={avatarSize}
                    style={{ borderRadius: 9999, objectFit: "cover" }}
                  />
                ) : (
                  <div
                    style={{
                      width: avatarSize,
                      height: avatarSize,
                      borderRadius: 9999,
                      backgroundColor: "#334155",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 36,
                      fontWeight: 700,
                      color: "#f8fafc",
                    }}
                  >
                    {row.name.charAt(0).toUpperCase()}
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    width: gridSize,
                    gap: tileGap,
                    marginTop: 14,
                  }}
                >
                  {cells.map((result, i) => (
                    <div
                      key={i}
                      style={{
                        width: tile,
                        height: tile,
                        borderRadius: 4,
                        backgroundColor: result ? LIVE_TILE_COLORS[result] : "#3a3b3e",
                      }}
                    />
                  ))}
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

/**
 * Posts an image as an interaction-webhook followup message. Works with only
 * the `applications.commands` scope — no bot membership needed — but the
 * interaction token it rides on expires 15 minutes after the interaction.
 */
export async function postImageWebhookFollowup(opts: {
  applicationId: string;
  webhookToken: string;
  pngBuffer: ArrayBuffer;
  content: string;
  filename?: string;
  components?: unknown[];
  /** e.g. { parse: [] } — mentions render as blue tags but notify no one. */
  allowedMentions?: { parse: string[] };
}): Promise<{ ok: boolean; status: number; body: string; messageId?: string }> {
  const form = new FormData();
  const filename = opts.filename ?? "preview.png";
  form.append(
    "payload_json",
    JSON.stringify({
      content: opts.content,
      ...(opts.components ? { components: opts.components } : {}),
      ...(opts.allowedMentions ? { allowed_mentions: opts.allowedMentions } : {}),
    }),
  );
  form.append("files[0]", new Blob([opts.pngBuffer], { type: "image/png" }), filename);

  const res = await fetch(
    `https://discord.com/api/v10/webhooks/${opts.applicationId}/${opts.webhookToken}`,
    { method: "POST", body: form }, // token authenticates via the URL; fetch sets the multipart boundary
  );

  if (!res.ok) return { ok: false, status: res.status, body: await res.text() };

  const body = await res.json().catch(() => null);
  return { ok: true, status: res.status, body: "", messageId: body?.id };
}

/** Edits a followup previously posted with postImageWebhookFollowup. Only
 *  works while that message's interaction token is still valid (15 min). */
export async function patchImageWebhookMessage(opts: {
  applicationId: string;
  webhookToken: string;
  messageId: string;
  pngBuffer: ArrayBuffer;
  content: string;
  components?: unknown[];
}): Promise<{ ok: boolean; status: number; body: string }> {
  const form = new FormData();
  form.append(
    "payload_json",
    JSON.stringify({
      content: opts.content,
      // Replace the previous attachment set with the fresh image.
      attachments: [{ id: 0, filename: "preview.png" }],
      ...(opts.components ? { components: opts.components } : {}),
    }),
  );
  form.append("files[0]", new Blob([opts.pngBuffer], { type: "image/png" }), "preview.png");

  const res = await fetch(
    `https://discord.com/api/v10/webhooks/${opts.applicationId}/${opts.webhookToken}/messages/${opts.messageId}`,
    { method: "PATCH", body: form },
  );

  return { ok: res.ok, status: res.status, body: res.ok ? "" : await res.text() };
}
