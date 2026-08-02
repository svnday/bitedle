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
import {
  bitebluffEntryIsWinner,
  sortBitebluffFinalEntries,
} from "./bitebluff-results";

const PREVIEW_MAX_PARTICIPANTS = 24;
const BITEBLUFF_WEBHOOK_TOKEN_TTL_MS = 13 * 60 * 1000;
export const BITEBLUFF_PREVIEW_WINDOW_MS = 13 * 60 * 1000;

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
  totalCommitted = entries.reduce((total, entry) => total + entry.wager, 0),
) {
  const shown = entries.slice(0, PREVIEW_MAX_PARTICIPANTS);
  const columns =
    shown.length <= 4
      ? Math.max(1, shown.length)
      : shown.length <= 6
        ? 3
        : 4;
  const rows = Math.max(1, Math.ceil(shown.length / columns));
  const width = 900;
  const outerPadding = 44;
  const cardGap = 14;
  const avatarSize = columns === 4 ? 54 : 60;
  const cardPadding = columns === 4 ? 15 : 18;
  const shownWagers = entries.reduce((total, entry) => total + entry.wager, 0);
  const sealedRedrawBites = Math.max(0, totalCommitted - shownWagers);
  const height =
    264 + rows * 128 + (entries.length > shown.length ? 44 : 0);
  const cardWidth = Math.floor(
    (width - outerPadding * 2 - (columns - 1) * cardGap) / columns,
  );
  const pot = totalCommitted;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: outerPadding,
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
            paddingBottom: 18,
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
            justifyContent: "center",
            gap: cardGap,
            paddingTop: 20,
          }}
        >
          {shown.map((entry) => (
            <div
              key={entry.id}
              style={{
                width: cardWidth,
                height: 114,
                padding: cardPadding,
                display: "flex",
                alignItems: "center",
                gap: columns === 4 ? 12 : 16,
                border: "1px solid #315846",
                borderRadius: 18,
                backgroundColor: "#0e2a21",
              }}
            >
              {avatar(entry, avatarSize)}
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <div
                  style={{
                    fontSize: columns === 4 ? 18 : 20,
                    fontWeight: 700,
                  }}
                >
                  {abbreviatedName(entry.displayName)}
                </div>
                <div
                  style={{
                    color: "#f7d56b",
                    fontSize: columns === 4 ? 21 : 23,
                    fontWeight: 800,
                  }}
                >
                  {`${entry.wager.toLocaleString()} Bites`}
                </div>
                <div style={{ color: "#8ea79b", fontSize: 12 }}>HAND SEALED</div>
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
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginTop: "auto",
            paddingTop: 18,
            color: "#78988a",
            fontSize: 14,
          }}
        >
          {sealedRedrawBites > 0
            ? `${sealedRedrawBites.toLocaleString()} sealed redraw Bites are included in the pool`
            : "Only profiles and locked wagers are public before the reveal"}
        </div>
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
        width: 42,
        height: 62,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 7,
        backgroundColor: "#f7f3e5",
        color: red ? "#a83232" : "#13221c",
        border: "1px solid #d9d1ba",
      }}
    >
      <div style={{ fontSize: 17, fontWeight: 900 }}>{rankGlyph(card)}</div>
      <div style={{ fontSize: 20 }}>{suitGlyph(card)}</div>
    </div>
  );
}

export function renderBitebluffFinalImage(
  round: BitebluffRoundRecord,
  entries: BitebluffEntryRecord[],
  totalPool = entries.reduce(
    (total, entry) => total + entry.wager + entry.redrawSurcharge,
    0,
  ),
) {
  const rankedEntries = sortBitebluffFinalEntries(entries);
  const columns = rankedEntries.length > 6 ? 2 : 1;
  const rows = Math.max(1, Math.ceil(rankedEntries.length / columns));
  const width = columns === 2 ? 1500 : 1100;
  const outerPadding = 42;
  const tileGap = 14;
  const tileHeight = 142;
  const tileWidth = Math.floor(
    (width - outerPadding * 2 - (columns - 1) * tileGap) / columns,
  );
  const height = 190 + rows * tileHeight + (rows - 1) * tileGap;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          padding: outerPadding,
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
              {`${rankedEntries.length} ${
                rankedEntries.length === 1 ? "player" : "players"
              } · ranked by final hand`}
            </div>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: tileGap,
            paddingTop: 20,
          }}
        >
          {rankedEntries.map((entry, index) => {
            const winner = bitebluffEntryIsWinner(entry);
            const committed = entry.wager + entry.redrawSurcharge;
            const net = entry.payout - committed;
            const wonLayers = entry.wonLayers ?? [];
            const winnerLabel =
              wonLayers.length === 0
                ? "FINAL HAND"
                : wonLayers.includes(0)
                  ? wonLayers.length === 1
                    ? "MAIN POT WINNER"
                    : `MAIN + ${wonLayers.length - 1} ${
                        wonLayers.length === 2 ? "LAYER" : "LAYERS"
                      }`
                  : `LAYER ${wonLayers.map((layer) => layer + 1).join(", ")} WINNER`;
            const outcome =
              net > 0
                ? `Won ${net.toLocaleString()} Bites`
                : net < 0
                  ? `Lost ${Math.abs(net).toLocaleString()} Bites`
                  : "Broke even";
            return (
              <div
                key={entry.id}
                style={{
                  width: tileWidth,
                  height: tileHeight,
                  display: "flex",
                  alignItems: "center",
                  padding: 14,
                  gap: 11,
                  borderRadius: 18,
                  border: winner ? "2px solid #d9b94f" : "1px solid #315246",
                  background: winner
                    ? "linear-gradient(120deg, #263c27 0%, #183226 100%)"
                    : "#0d281f",
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    borderRadius: 9999,
                    border: winner ? "1px solid #d9b94f" : "1px solid #456555",
                    color: winner ? "#f7d56b" : "#a9bbb1",
                    fontSize: 15,
                    fontWeight: 900,
                  }}
                >
                  {index + 1}
                </div>
                {avatar(entry, 52)}
                <div style={{ width: 118, display: "flex", flexDirection: "column" }}>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>
                    {abbreviatedName(entry.displayName)}
                  </div>
                  <div
                    style={{
                      color: winner ? "#f7d56b" : "#8fa69a",
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: 0.5,
                    }}
                  >
                    {winnerLabel}
                  </div>
                  <div style={{ color: "#c7d3cc", fontSize: 14 }}>
                    {entry.handLabel ?? "Final hand"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {(entry.revealedHand ?? []).map((card, cardIndex) => (
                    <div key={`${entry.id}:${cardIndex}`} style={{ display: "flex" }}>
                      {playingCard(card)}
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    marginLeft: "auto",
                    width: 148,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                  }}
                >
                  <div
                    style={{
                      color: net > 0 ? "#70d697" : net < 0 ? "#e88b82" : "#d8d2be",
                      fontSize: 20,
                      fontWeight: 900,
                      textAlign: "right",
                    }}
                  >
                    {outcome}
                  </div>
                  <div style={{ color: "#a5b7ad", fontSize: 12 }}>
                    {`${committed.toLocaleString()} wagered`}
                  </div>
                  <div style={{ color: "#a5b7ad", fontSize: 12 }}>
                    {`${entry.payout.toLocaleString()} returned`}
                  </div>
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
  components?: unknown[];
}): Promise<{ ok: boolean; status: number; body: string; messageId?: string }> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return { ok: false, status: 503, body: "DISCORD_BOT_TOKEN is unset" };
  const form = new FormData();
  form.append(
    "payload_json",
    JSON.stringify({
      content: input.content,
      allowed_mentions: { parse: [] },
      ...(input.components ? { components: input.components } : {}),
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
    const [round, entries, totalCommitted] = await Promise.all([
      repository.getRound(destination.roundId),
      repository.previewEntriesForRound(destination.roundId),
      repository.totalCommittedForRound(destination.roundId),
    ]);
    if (!round) throw new Error("Bitebluff round not found for preview.");
    const pngBuffer = await renderBitebluffPublicPreviewImage(
      round,
      entries,
      totalCommitted,
    ).arrayBuffer();
    const content = `🃏 **Bitebluff** — ${entries.length} sealed ${
      entries.length === 1 ? "hand" : "hands"
    }, ${totalCommitted.toLocaleString()} Bites in the pool.`;
    const webhookIsFresh =
      Boolean(destination.applicationId && destination.webhookToken) &&
      Date.now() - destination.tokenCreatedAt < BITEBLUFF_WEBHOOK_TOKEN_TTL_MS;
    const previewMessageIsFresh =
      Boolean(destination.previewMessageId) &&
      destination.previewMessageCreatedAt !== null &&
      Date.now() - destination.previewMessageCreatedAt <
        BITEBLUFF_PREVIEW_WINDOW_MS;
    const editablePreviewMessageId = previewMessageIsFresh
      ? destination.previewMessageId ?? undefined
      : undefined;
    let result = await botImageRequest({
      channelId: destination.channelId,
      messageId: editablePreviewMessageId,
      pngBuffer,
      content,
      filename: "bitebluff-preview.png",
    });
    if (!result.ok && result.status === 404 && editablePreviewMessageId) {
      result = await botImageRequest({
        channelId: destination.channelId,
        pngBuffer,
        content,
        filename: "bitebluff-preview.png",
      });
    }
    if ((!result.ok || !result.messageId) && webhookIsFresh) {
      if (editablePreviewMessageId) {
        const patched = await patchImageWebhookMessage({
          applicationId: destination.applicationId,
          webhookToken: destination.webhookToken,
          messageId: editablePreviewMessageId,
          pngBuffer,
          content,
          filename: "bitebluff-preview.png",
        });
        result = { ...patched, messageId: editablePreviewMessageId };
        if (!patched.ok && patched.status === 404) {
          result = await postImageWebhookFollowup({
            applicationId: destination.applicationId,
            webhookToken: destination.webhookToken,
            pngBuffer,
            content,
            filename: "bitebluff-preview.png",
          });
        }
      } else {
        result = await postImageWebhookFollowup({
          applicationId: destination.applicationId,
          webhookToken: destination.webhookToken,
          pngBuffer,
          content,
          filename: "bitebluff-preview.png",
        });
      }
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
  const totalPool = entries.reduce(
    (total, entry) => total + entry.wager + entry.redrawSurcharge,
    0,
  );
  const deliveryErrors: Error[] = [];
  for (const destination of destinations) {
    if (!(await repository.claimFinalDelivery(destination.id))) continue;
    const claimedDestination =
      (await repository.getDestination(destination.id)) ?? destination;
    try {
      const pngBuffer = await renderBitebluffFinalImage(
        round,
        entries,
        totalPool,
      ).arrayBuffer();
      const existingFinalMessageId =
        claimedDestination.finalMessageIds[0] ?? null;
      const targetMessageId =
        existingFinalMessageId ?? claimedDestination.previewMessageId;
      const content = `🏆 **Bitebluff ${round.date} — final results**`;
      const filename = "bitebluff-final.png";
      let result = await botImageRequest({
        channelId: destination.channelId,
        messageId: targetMessageId ?? undefined,
        pngBuffer,
        content,
        filename,
      });
      if (
        !result.ok &&
        targetMessageId &&
        (result.status === 403 || result.status === 404)
      ) {
        result = await botImageRequest({
          channelId: destination.channelId,
          pngBuffer,
          content,
          filename,
        });
      }
      const webhookIsFresh =
        Boolean(
          claimedDestination.applicationId &&
            claimedDestination.webhookToken,
        ) &&
        Date.now() - claimedDestination.tokenCreatedAt <
          BITEBLUFF_WEBHOOK_TOKEN_TTL_MS;
      if ((!result.ok || !result.messageId) && webhookIsFresh) {
        if (targetMessageId) {
          const patched = await patchImageWebhookMessage({
            applicationId: claimedDestination.applicationId,
            webhookToken: claimedDestination.webhookToken,
            messageId: targetMessageId,
            pngBuffer,
            content,
            filename,
          });
          result = { ...patched, messageId: targetMessageId };
        }
        if (!result.ok || !result.messageId) {
          result = await postImageWebhookFollowup({
            applicationId: claimedDestination.applicationId,
            webhookToken: claimedDestination.webhookToken,
            pngBuffer,
            content,
            filename,
          });
        }
      }
      if (!result.ok || !result.messageId) {
        throw new Error(`Discord final post failed (${result.status}): ${result.body}`);
      }
      await repository.recordFinalPage(destination.id, result.messageId, Date.now());
      await repository.completeFinalDelivery(
        destination.id,
        [result.messageId],
        Date.now(),
      );
    } catch (error) {
      await repository.releaseFinalDelivery(destination.id);
      deliveryErrors.push(
        error instanceof Error ? error : new Error("Discord final delivery failed."),
      );
    }
  }
  if (deliveryErrors.length > 0) {
    throw new AggregateError(
      deliveryErrors,
      `Bitebluff final delivery failed for ${deliveryErrors.length} destination(s).`,
    );
  }
}

export async function deliverPendingBitebluffFinalResultsFromInteraction(input: {
  guildId: string;
  channelId: string;
  applicationId: string;
  webhookToken: string;
  now?: number;
}): Promise<string[]> {
  const repository = getBitebluffRepository();
  const deliveredRoundIds: string[] = [];
  const now = input.now ?? Date.now();

  while (true) {
    const claimedDestinations =
      await repository.claimPendingFinalDeliveryForGuild(input.guildId, now);
    if (claimedDestinations.length === 0) return deliveredRoundIds;
    const roundId = claimedDestinations[0].roundId;
    try {
      const [round, entries] = await Promise.all([
        repository.getRound(roundId),
        repository.entriesForRound(roundId),
      ]);
      if (!round || round.status !== "settled") {
        throw new Error("Pending Bitebluff round is not settled.");
      }
      const totalPool = entries.reduce(
        (total, entry) => total + entry.wager + entry.redrawSurcharge,
        0,
      );
      const pngBuffer = await renderBitebluffFinalImage(
        round,
        entries,
        totalPool,
      ).arrayBuffer();
      const result = await postImageWebhookFollowup({
        applicationId: input.applicationId,
        webhookToken: input.webhookToken,
        pngBuffer,
        content: `ðŸ† **Bitebluff ${round.date} â€” final results**`,
        filename: "bitebluff-final.png",
      });
      if (!result.ok || !result.messageId) {
        throw new Error(
          `Discord interaction final post failed (${result.status}): ${result.body}`,
        );
      }
      for (const destination of claimedDestinations) {
        await repository.recordFinalPage(destination.id, result.messageId, now);
        await repository.completeFinalDelivery(
          destination.id,
          [result.messageId],
          now,
        );
      }
      deliveredRoundIds.push(roundId);
    } catch (error) {
      await Promise.all(
        claimedDestinations.map((destination) =>
          repository.releaseFinalDelivery(destination.id),
        ),
      );
      throw error;
    }
  }
}

export async function retryPendingBitebluffFinalResults(): Promise<void> {
  const repository = getBitebluffRepository();
  const errors: Error[] = [];
  for (const roundId of await repository.roundsNeedingFinalDelivery()) {
    await deliverBitebluffFinalResults(roundId).catch((error) => {
      errors.push(
        error instanceof Error ? error : new Error("Bitebluff final retry failed."),
      );
    });
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "One or more Bitebluff final retries failed.");
  }
}
