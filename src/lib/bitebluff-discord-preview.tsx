import { ImageResponse } from "next/og";
import { discordAvatarUrl } from "./discord";
import {
  patchImageWebhookMessage,
  postImageWebhookFollowup,
} from "./discord-summary";
import { getBitebluffRepository } from "./bitebluff-store";
import type {
  BitebluffEntryRecord,
  BitebluffPreviewEntry,
  BitebluffRoundRecord,
} from "./bitebluff-types";
import type { BitebluffCard } from "./bitebluff-constants";

const PREVIEW_MAX_PARTICIPANTS = 24;
const FINAL_PAGE_SIZE = 6;

function abbreviatedName(name: string): string {
  return name.length <= 22 ? name : `${name.slice(0, 21)}…`;
}

function suitGlyph(card: BitebluffCard): string {
  if (card.suit === "clubs") return "♣";
  if (card.suit === "diamonds") return "♦";
  if (card.suit === "hearts") return "♥";
  return "♠";
}

function rankGlyph(card: BitebluffCard): string {
  if (card.rank === 14) return "A";
  if (card.rank === 13) return "K";
  if (card.rank === 12) return "Q";
  if (card.rank === 11) return "J";
  return String(card.rank);
}

function avatar(
  entry: Pick<
    BitebluffEntryRecord,
    "discordUserId" | "avatarHash" | "displayName"
  >,
  size: number,
) {
  const url = discordAvatarUrl(entry.discordUserId, entry.avatarHash);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      style={{ borderRadius: 9999, objectFit: "cover" }}
    />
  ) : (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#234738",
        color: "#f7d56b",
        fontSize: Math.round(size * 0.42),
        fontWeight: 800,
      }}
    >
      {entry.displayName.charAt(0).toUpperCase()}
    </div>
  );
}

export function renderBitebluffPublicPreviewImage(
  round: BitebluffRoundRecord,
  entries: BitebluffPreviewEntry[],
) {
  const shown = entries.slice(0, PREVIEW_MAX_PARTICIPANTS);
  const columns = Math.min(4, Math.max(1, shown.length));
  const rows = Math.max(1, Math.ceil(shown.length / columns));
  const width = 900;
  const height = 210 + rows * 150 + (entries.length > shown.length ? 50 : 0);
  const cardWidth = Math.floor((width - 80 - (columns - 1) * 14) / columns);
  const pot = entries.reduce((total, entry) => total + entry.wager, 0);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: 40,
          color: "#f7f3e5",
          background:
            "linear-gradient(145deg, #061f18 0%, #0b3024 55%, #071c16 100%)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            borderBottom: "1px solid #947d3b",
            paddingBottom: 22,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color: "#f7d56b", fontSize: 18, letterSpacing: 4 }}>
              DAILY BLIND DRAW
            </div>
            <div style={{ fontSize: 52, fontWeight: 900 }}>BITEBLUFF</div>
            <div style={{ color: "#b9c9c0", fontSize: 20 }}>
              Hands sealed until 11:00 PM ET
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
            }}
          >
            <div style={{ color: "#9fb5aa", fontSize: 16 }}>{round.date}</div>
            <div style={{ color: "#f7d56b", fontSize: 34, fontWeight: 800 }}>
              {`${pot.toLocaleString()} Bites`}
            </div>
            <div style={{ color: "#9fb5aa", fontSize: 16 }}>
              {`${entries.length} ${entries.length === 1 ? "player" : "players"}`}
            </div>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 14,
            paddingTop: 24,
          }}
        >
          {shown.map((entry) => (
            <div
              key={entry.id}
              style={{
                width: cardWidth,
                height: 132,
                padding: 18,
                display: "flex",
                alignItems: "center",
                gap: 14,
                border: "1px solid #315846",
                borderRadius: 20,
                backgroundColor: "#0e2a21",
              }}
            >
              {avatar(entry, 66)}
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <div style={{ fontSize: 20, fontWeight: 700 }}>
                  {abbreviatedName(entry.displayName)}
                </div>
                <div style={{ color: "#f7d56b", fontSize: 24, fontWeight: 800 }}>
                  {`${entry.wager.toLocaleString()} Bites`}
                </div>
                <div style={{ color: "#8ea79b", fontSize: 13 }}>HAND SEALED</div>
              </div>
            </div>
          ))}
        </div>
        {entries.length > shown.length ? (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              color: "#b9c9c0",
              paddingTop: 16,
              fontSize: 18,
            }}
          >
            {`+${entries.length - shown.length} more sealed entries`}
          </div>
        ) : null}
      </div>
    ),
    { width, height },
  );
}

function playingCard(card: BitebluffCard) {
  const red = card.suit === "diamonds" || card.suit === "hearts";
  return (
    <div
      style={{
        width: 72,
        height: 100,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 9,
        backgroundColor: "#f7f3e5",
        color: red ? "#a83232" : "#13221c",
        border: "2px solid #d9d1ba",
      }}
    >
      <div style={{ fontSize: 26, fontWeight: 900 }}>{rankGlyph(card)}</div>
      <div style={{ fontSize: 30 }}>{suitGlyph(card)}</div>
    </div>
  );
}

export function renderBitebluffFinalImage(
  round: BitebluffRoundRecord,
  entries: BitebluffEntryRecord[],
  page: number,
  pageCount: number,
  totalPool = entries.reduce((total, entry) => total + entry.wager, 0),
) {
  const winners = new Set(
    entries.filter((entry) => entry.contestedPayout > 0).map((entry) => entry.id),
  );
  const width = 1100;
  const height = 190 + entries.length * 185;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          padding: 38,
          display: "flex",
          flexDirection: "column",
          color: "#f7f3e5",
          background:
            "linear-gradient(145deg, #071f18 0%, #0c2d23 58%, #071812 100%)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            borderBottom: "1px solid #947d3b",
            paddingBottom: 20,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color: "#f7d56b", fontSize: 17, letterSpacing: 4 }}>
              {`FINAL RESULTS · ${round.date}`}
            </div>
            <div style={{ fontSize: 48, fontWeight: 900 }}>BITEBLUFF</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ color: "#f7d56b", fontSize: 31, fontWeight: 800 }}>
              {`${totalPool.toLocaleString()} Bite pool`}
            </div>
            <div style={{ color: "#9fb5aa", fontSize: 15 }}>
              {`Page ${page + 1} of ${pageCount}`}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 20 }}>
          {entries.map((entry) => {
            const winner = winners.has(entry.id);
            const net = entry.payout - entry.wager;
            const wonLayers = entry.wonLayers ?? [];
            const winnerLabel =
              wonLayers.length === 0
                ? "FINAL HAND"
                : wonLayers.includes(0)
                  ? wonLayers.length === 1
                    ? "MAIN POT WINNER"
                    : `MAIN + ${wonLayers.length - 1} LAYER`
                  : `LAYER ${wonLayers.map((layer) => layer + 1).join(", ")} WINNER`;
            return (
              <div
                key={entry.id}
                style={{
                  height: 170,
                  display: "flex",
                  alignItems: "center",
                  padding: 18,
                  gap: 17,
                  borderRadius: 20,
                  border: winner ? "2px solid #d9b94f" : "1px solid #315246",
                  backgroundColor: winner ? "#263c27" : "#0d281f",
                }}
              >
                {avatar(entry, 72)}
                <div style={{ width: 180, display: "flex", flexDirection: "column" }}>
                  <div style={{ fontSize: 21, fontWeight: 800 }}>
                    {abbreviatedName(entry.displayName)}
                  </div>
                  <div style={{ color: winner ? "#f7d56b" : "#9fb5aa", fontSize: 15 }}>
                    {winnerLabel}
                  </div>
                  <div style={{ color: "#c7d3cc", fontSize: 16 }}>{entry.handLabel}</div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {(entry.revealedHand ?? []).map((card, cardIndex) => (
                    <div key={`${entry.id}:${cardIndex}`} style={{ display: "flex" }}>
                      {playingCard(card)}
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    marginLeft: "auto",
                    width: 170,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                  }}
                >
                  <div style={{ color: "#9fb5aa", fontSize: 14 }}>
                    {`Wagered ${entry.wager.toLocaleString()}`}
                  </div>
                  <div
                    style={{
                      color: net > 0 ? "#70d697" : net < 0 ? "#e88b82" : "#d8d2be",
                      fontSize: 25,
                      fontWeight: 900,
                    }}
                  >
                    {`${net > 0 ? "+" : ""}${net.toLocaleString()} Bites`}
                  </div>
                  <div style={{ color: "#c7d3cc", fontSize: 14 }}>
                    {`${entry.payout.toLocaleString()} returned`}
                  </div>
                  {entry.unmatchedReturn > 0 ? (
                    <div style={{ color: "#9fb5aa", fontSize: 12 }}>
                      {`includes ${entry.unmatchedReturn.toLocaleString()} unmatched`}
                    </div>
                  ) : null}
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

function discordApiBaseUrl(): string {
  if (process.env.NODE_ENV !== "production" && process.env.BITEDLE_DISCORD_API_BASE_URL) {
    return process.env.BITEDLE_DISCORD_API_BASE_URL.replace(/\/$/, "");
  }
  return "https://discord.com/api/v10";
}

async function botImageRequest(input: {
  channelId: string;
  messageId?: string;
  pngBuffer: ArrayBuffer;
  content: string;
  filename: string;
}): Promise<{ ok: boolean; status: number; body: string; messageId?: string }> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return { ok: false, status: 503, body: "DISCORD_BOT_TOKEN is unset" };
  const form = new FormData();
  form.append(
    "payload_json",
    JSON.stringify({
      content: input.content,
      allowed_mentions: { parse: [] },
      ...(input.messageId
        ? { attachments: [{ id: 0, filename: input.filename }] }
        : {}),
    }),
  );
  form.append(
    "files[0]",
    new Blob([input.pngBuffer], { type: "image/png" }),
    input.filename,
  );
  const url = input.messageId
    ? `${discordApiBaseUrl()}/channels/${input.channelId}/messages/${input.messageId}`
    : `${discordApiBaseUrl()}/channels/${input.channelId}/messages`;
  const response = await fetch(url, {
    method: input.messageId ? "PATCH" : "POST",
    headers: { Authorization: `Bot ${token}` },
    body: form,
  });
  if (!response.ok) {
    return { ok: false, status: response.status, body: await response.text() };
  }
  const body = await response.json().catch(() => null);
  return { ok: true, status: response.status, body: "", messageId: body?.id };
}

export async function updateBitebluffPublicPreview(
  destinationId: string,
  retry = true,
): Promise<void> {
  const repository = getBitebluffRepository();
  if (!(await repository.claimPreview(destinationId))) {
    if (retry) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      await updateBitebluffPublicPreview(destinationId, false);
    }
    return;
  }
  try {
    const destination = await repository.getDestination(destinationId);
    if (!destination) throw new Error("Bitebluff destination not found.");
    const [round, entries] = await Promise.all([
      repository.getRound(destination.roundId),
      repository.previewEntriesForRound(destination.roundId),
    ]);
    if (!round) throw new Error("Bitebluff round not found for preview.");
    const pngBuffer = await renderBitebluffPublicPreviewImage(round, entries).arrayBuffer();
    const content = `🃏 **Bitebluff** — ${entries.length} sealed ${
      entries.length === 1 ? "hand" : "hands"
    }, ${entries.reduce((total, entry) => total + entry.wager, 0).toLocaleString()} Bites in the pool.`;
    let result = await botImageRequest({
      channelId: destination.channelId,
      messageId: destination.previewMessageId ?? undefined,
      pngBuffer,
      content,
      filename: "bitebluff-preview.png",
    });
    if (!result.ok && result.status === 404 && destination.previewMessageId) {
      result = await botImageRequest({
        channelId: destination.channelId,
        pngBuffer,
        content,
        filename: "bitebluff-preview.png",
      });
    }
    if (!result.ok && !process.env.DISCORD_BOT_TOKEN) {
      result = destination.previewMessageId
        ? {
            ...(await patchImageWebhookMessage({
              applicationId: destination.applicationId,
              webhookToken: destination.webhookToken,
              messageId: destination.previewMessageId,
              pngBuffer,
              content,
              filename: "bitebluff-preview.png",
            })),
            messageId: destination.previewMessageId,
          }
        : await postImageWebhookFollowup({
            applicationId: destination.applicationId,
            webhookToken: destination.webhookToken,
            pngBuffer,
            content,
            filename: "bitebluff-preview.png",
          });
    }
    if (!result.ok || !result.messageId) {
      throw new Error(`Discord preview failed (${result.status}): ${result.body}`);
    }
    await repository.completePreview(destination.id, result.messageId, Date.now());
  } catch (error) {
    await repository.releasePreview(destinationId);
    throw error;
  }
}

export async function deliverBitebluffFinalResults(roundId: string): Promise<void> {
  const repository = getBitebluffRepository();
  const [round, entries, destinations] = await Promise.all([
    repository.getRound(roundId),
    repository.entriesForRound(roundId),
    repository.destinationsForRound(roundId),
  ]);
  if (!round || round.status !== "settled") return;
  const pageCount = Math.max(1, Math.ceil(entries.length / FINAL_PAGE_SIZE));
  const totalPool = entries.reduce((total, entry) => total + entry.wager, 0);
  for (const destination of destinations) {
    if (!(await repository.claimFinalDelivery(destination.id))) continue;
    const claimedDestination =
      (await repository.getDestination(destination.id)) ?? destination;
    const messageIds = [...claimedDestination.finalMessageIds];
    try {
      for (let page = messageIds.length; page < pageCount; page += 1) {
        const pageEntries = entries.slice(
          page * FINAL_PAGE_SIZE,
          (page + 1) * FINAL_PAGE_SIZE,
        );
        const pngBuffer = await renderBitebluffFinalImage(
          round,
          pageEntries,
          page,
          pageCount,
          totalPool,
        ).arrayBuffer();
        const result = await botImageRequest({
          channelId: destination.channelId,
          pngBuffer,
          content:
            page === 0
              ? `🏆 **Bitebluff ${round.date} — final results**`
              : `Bitebluff ${round.date} — results ${page + 1}/${pageCount}`,
          filename: `bitebluff-final-${page + 1}.png`,
        });
        if (!result.ok || !result.messageId) {
          throw new Error(`Discord final post failed (${result.status}): ${result.body}`);
        }
        messageIds.push(result.messageId);
        await repository.recordFinalPage(destination.id, result.messageId, Date.now());
      }
      await repository.completeFinalDelivery(destination.id, messageIds, Date.now());
    } catch (error) {
      await repository.releaseFinalDelivery(destination.id);
      throw error;
    }
  }
}

export async function retryPendingBitebluffFinalResults(): Promise<void> {
  const repository = getBitebluffRepository();
  for (const roundId of await repository.roundsNeedingFinalDelivery()) {
    await deliverBitebluffFinalResults(roundId);
  }
}
