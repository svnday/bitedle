import { ImageResponse } from "next/og";
import type { LivePreviewRow, TodayRow } from "./store";
import { puzzleNumber } from "./game";
import { discordAvatarUrl } from "./discord";

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
  // A summary is the completed version of the launch preview, so render it
  // through the exact same card/board path. The incoming order (winners by
  // score, then losses) is preserved while each card shows the player's real
  // click sequence in the same non-spoiling left-to-right 5x5 grid.
  return renderLivePreviewImage(rows.map((row) => ({ ...row, date })));
}

/** Wordle-esque tile palette: misses go yellow, the found check green, the
 *  bomb red; unrevealed cells stay dark. No glyphs — colors carry it all. */
const LIVE_TILE_COLORS = {
  x: "#b59f3b",
  bomb: "#b3392f",
  check: "#538d4e",
} as const;

/**
 * Splits a launch window's rows into per-puzzle groups, preserving first-seen
 * order — rows arrive launcher-first (store guarantee), so the launcher's
 * puzzle is always the first group and launch order holds within each group.
 * Usually one group; more when players' local days straddle a midnight.
 */
export function groupLivePreviewRows(
  rows: LivePreviewRow[],
): { date: string; rows: LivePreviewRow[] }[] {
  const groups: { date: string; rows: LivePreviewRow[] }[] = [];
  for (const row of rows) {
    const group = groups.find((g) => g.date === row.date);
    if (group) group.rows.push(row);
    else groups.push({ date: row.date, rows: [row] });
  }
  return groups;
}

/** Wordle-launch-style card grid: one titled section per puzzle in the window
 *  (players on different local days are on different boards), each a centered
 *  title over rounded per-player cards — avatar above a 5×5 tile grid showing
 *  click order left-to-right (never real board positions). */
export function renderLivePreviewImage(rows: LivePreviewRow[]) {
  const groups = groupLivePreviewRows(rows);
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
  const sectionGap = 40;

  const sections = groups.map((group) => {
    const perRow = Math.max(1, Math.min(group.rows.length, 5));
    const rowCount = Math.ceil(group.rows.length / perRow);
    return {
      ...group,
      cardsWidth: perRow * cardWidth + (perRow - 1) * cardGap,
      height: titleBlock + rowCount * cardHeight + (rowCount - 1) * cardGap,
    };
  });
  const contentWidth = Math.max(260, ...sections.map((s) => s.cardsWidth));
  const width = margin * 2 + contentWidth;
  const height =
    margin * 2 +
    sections.reduce((sum, s) => sum + s.height, 0) +
    sectionGap * (sections.length - 1);

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
        {sections.map((section, sectionIndex) => (
          <div
            key={section.date}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              marginTop: sectionIndex > 0 ? sectionGap : 0,
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
              {`Bitedle No. ${puzzleNumber(section.date)}`}
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
              {section.rows.map((row) => {
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
        ))}
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
}): Promise<{ ok: boolean; status: number; body: string; messageId?: string }> {
  const form = new FormData();
  const filename = opts.filename ?? "preview.png";
  form.append(
    "payload_json",
    JSON.stringify({
      content: opts.content,
      ...(opts.components ? { components: opts.components } : {}),
      // User-supplied display names can contain @ text. Never let a generated
      // Bitedle message turn that text into a notification.
      allowed_mentions: { parse: [] },
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
      allowed_mentions: { parse: [] },
    }),
  );
  form.append("files[0]", new Blob([opts.pngBuffer], { type: "image/png" }), "preview.png");

  const res = await fetch(
    `https://discord.com/api/v10/webhooks/${opts.applicationId}/${opts.webhookToken}/messages/${opts.messageId}`,
    { method: "PATCH", body: form },
  );

  return { ok: res.ok, status: res.status, body: res.ok ? "" : await res.text() };
}
