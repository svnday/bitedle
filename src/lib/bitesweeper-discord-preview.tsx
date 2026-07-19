import { ImageResponse } from "next/og";
import { discordAvatarUrl } from "./discord";
import {
  patchImageWebhookMessage,
  postImageWebhookFollowup,
} from "./discord-summary";
import {
  getStore,
  LIVE_PREVIEW_POSTING,
  type BitesweeperPreviewMessage,
} from "./store";
import type { MegaCellResult, MegaClickRecord } from "./types";

export const BITESWEEPER_WEBHOOK_TOKEN_TTL_MS = 13 * 60 * 1000;
export const BITESWEEPER_LAUNCH_BUTTON_ID = "bitesweeper-launch";

const BITESWEEPER_LAUNCH_COMPONENTS = [
  {
    type: 1,
    components: [
      { type: 2, style: 1, label: "Play now!", custom_id: BITESWEEPER_LAUNCH_BUTTON_ID },
    ],
  },
];

export interface BitesweeperPreviewPlayer {
  userId: string;
  date: string;
  name: string;
  discordUserId: string | null;
  discordAvatar: string | null;
  clicks: MegaClickRecord[];
  flags: number[];
}

export async function beginBitesweeperPreview(opts: {
  guildId: string;
  interaction: { applicationId: string; token: string };
}): Promise<BitesweeperPreviewMessage> {
  const now = Date.now();
  const record: BitesweeperPreviewMessage = {
    guildId: opts.guildId,
    instanceId: null,
    applicationId: opts.interaction.applicationId,
    webhookToken: opts.interaction.token,
    tokenCreatedAt: now,
    messageId: null,
    updatedAt: now,
  };
  await getStore().setBitesweeperPreview(record);
  return record;
}

export async function updateBitesweeperPreview(opts: {
  guildId: string;
  instanceId?: string;
  fallbackPlayers?: BitesweeperPreviewPlayer[];
}): Promise<void> {
  const store = getStore();
  const now = Date.now();
  let record = await store.getBitesweeperPreview(opts.guildId);
  if (!record || now - record.tokenCreatedAt >= BITESWEEPER_WEBHOOK_TOKEN_TTL_MS) return;
  if (record.messageId === LIVE_PREVIEW_POSTING) return;

  if (opts.instanceId) {
    if (record.instanceId && record.instanceId !== opts.instanceId) return;
    if (!record.instanceId) {
      if (!(await store.bindBitesweeperPreviewInstance(
        opts.guildId,
        record.tokenCreatedAt,
        opts.instanceId,
      ))) return;
      const boundRecord = await store.getBitesweeperPreview(opts.guildId);
      if (!boundRecord) return;
      record = boundRecord;
    }
  }

  const rows: BitesweeperPreviewPlayer[] = record.instanceId
    ? await store.bitesweeperPlayers(record.instanceId, record.tokenCreatedAt)
    : (opts.fallbackPlayers ?? []);
  if (rows.length === 0) return;

  const pngBuffer = await renderBitesweeperPreviewImage(rows).arrayBuffer();
  const content = bitesweeperPreviewContent(rows);

  if (record.messageId) {
    const patched = await patchImageWebhookMessage({
      applicationId: record.applicationId,
      webhookToken: record.webhookToken,
      messageId: record.messageId,
      pngBuffer,
      content,
      filename: "bitesweeper-preview.png",
      components: BITESWEEPER_LAUNCH_COMPONENTS,
    });
    if (patched.ok) return;
    if (patched.status !== 404) {
      console.error(
        `bitesweeper-preview: webhook PATCH failed for guild ${opts.guildId} (${patched.status}): ${patched.body}`,
      );
      return;
    }
    await store.clearBitesweeperPreviewMessageId(
      opts.guildId,
      record.tokenCreatedAt,
      record.messageId,
    );
  }

  if (!(await store.claimBitesweeperPreviewPost(opts.guildId, record.tokenCreatedAt))) return;
  const posted = await postImageWebhookFollowup({
    applicationId: record.applicationId,
    webhookToken: record.webhookToken,
    pngBuffer,
    content,
    filename: "bitesweeper-preview.png",
    components: BITESWEEPER_LAUNCH_COMPONENTS,
  });
  if (!posted.ok || !posted.messageId) {
    console.error(
      `bitesweeper-preview: webhook POST failed for guild ${opts.guildId} (${posted.status}): ${posted.body}`,
    );
    await store.releaseBitesweeperPreviewPost(opts.guildId, record.tokenCreatedAt);
    return;
  }
  await store.completeBitesweeperPreviewPost(
    opts.guildId,
    record.tokenCreatedAt,
    posted.messageId,
    now,
  );
}

function nonMentioningName(name: string): string {
  return name.replaceAll("@", "@\u200b");
}

export function bitesweeperPreviewContent(rows: BitesweeperPreviewPlayer[]): string {
  const first = rows[0];
  const others = rows.length - 1;
  const who = others === 0
    ? `**${nonMentioningName(first.name)}** is playing`
    : `**${nonMentioningName(first.name)}** and ${others} other${others === 1 ? "" : "s"} are playing`;
  return `🎮 ${who} Bitesweeper`;
}

const TILE_COLORS: Record<string, string> = {
  0: "#48494d",
  1: "#22627a",
  2: "#538d4e",
  3: "#806719",
  4: "#7a2f2b",
  bomb: "#b3392f",
  check: "#538d4e",
};

const TILE_TEXT: Record<string, string> = {
  0: "0",
  1: "1",
  2: "2",
  3: "3",
  4: "4",
  bomb: "●",
  check: "✓",
};

export function renderBitesweeperPreviewImage(rows: BitesweeperPreviewPlayer[]) {
  const tile = 14;
  const gap = 3;
  const boardSize = 10 * tile + 9 * gap;
  const cardWidth = boardSize + 32;
  const cardHeight = 266;
  const cardGap = 18;
  const margin = 38;
  const titleBlock = 64;
  const perRow = Math.max(1, Math.min(rows.length, 4));
  const rowCount = Math.ceil(rows.length / perRow);
  const contentWidth = Math.max(320, perRow * cardWidth + (perRow - 1) * cardGap);
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
            display: "flex",
            fontSize: 27,
            fontWeight: 600,
            color: "#f2f3f5",
            whiteSpace: "nowrap",
          }}
        >
          Bitesweeper
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: cardGap,
            width: contentWidth,
            marginTop: 28,
          }}
        >
          {rows.map((row) => {
            const avatarUrl = discordAvatarUrl(row.discordUserId, row.discordAvatar);
            const clicked = new Map(row.clicks.map((click) => [click.index, click.result]));
            const flagged = new Set(row.flags);
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
                  borderRadius: 22,
                  padding: 16,
                }}
              >
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt=""
                    width={58}
                    height={58}
                    style={{ borderRadius: 9999, objectFit: "cover" }}
                  />
                ) : (
                  <div
                    style={{
                      width: 58,
                      height: 58,
                      borderRadius: 9999,
                      backgroundColor: "#334155",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 25,
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
                    maxWidth: boardSize,
                    marginTop: 8,
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#f2f3f5",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                  }}
                >
                  {row.name}
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    width: boardSize,
                    gap,
                    marginTop: 10,
                  }}
                >
                  {Array.from({ length: 100 }, (_, index) => {
                    const result: MegaCellResult | undefined = clicked.get(index);
                    const isFlagged = result === undefined && flagged.has(index);
                    return (
                      <div
                        key={index}
                        style={{
                          width: tile,
                          height: tile,
                          borderRadius: 3,
                          backgroundColor: result === undefined ? "#3a3b3e" : TILE_COLORS[String(result)],
                          color: "#ffffff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: isFlagged ? 10 : 8,
                          fontWeight: 700,
                        }}
                      >
                        {isFlagged ? "🚩" : result === undefined ? "" : TILE_TEXT[String(result)]}
                      </div>
                    );
                  })}
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
