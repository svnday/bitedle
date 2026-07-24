import { ImageResponse } from "next/og";
import { patchImageWebhookMessage } from "./discord-summary";
import { getStore } from "./store";
import { BITEFIGHT_MAX_HEALTH } from "./bitefight-constants";
import type { BitefightPlayer, BitefightRecord } from "./types";

const TOKEN_TTL_MS = 13 * 60_000;
const MIN_UPDATE_INTERVAL_MS = 650;
const lastRenderAt = new Map<string, number>();
const pendingRenders = new Map<string, ReturnType<typeof setTimeout>>();
const activeRenders = new Map<string, Promise<void>>();
const renderAgain = new Set<string>();

function statusText(match: BitefightRecord): string {
  if (match.status === "pending") return "Waiting for the challenge";
  if (match.status === "accepted") return "Waiting for both fighters to ready up";
  if (match.status === "countdown") {
    const seconds =
      match.startedAt === null ? 3 : Math.max(1, Math.ceil((match.startedAt - Date.now()) / 1_000));
    return `Fight starts in ${seconds}...`;
  }
  if (match.status === "fighting") return "Fight!";
  if (match.status === "finished") {
    const winner = match.players.find(
      (player) => player.discordUserId === match.winnerDiscordUserId,
    );
    return winner ? `${winner.name} wins by ${match.finishReason}!` : "Draw!";
  }
  return `Fight ${match.status}`;
}

function safeName(name: string): string {
  return name.replaceAll("@", "@\u200b");
}

function components(match: BitefightRecord) {
  if (!["pending", "accepted", "countdown", "fighting"].includes(match.status)) return [];
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 3,
          label: match.status === "pending" ? "Accept / Join fight" : "Join fight",
          custom_id: `bitefight-join:${match.id}`,
        },
        ...(match.status === "pending"
          ? [
              {
                type: 2,
                style: 4,
                label: "Decline",
                custom_id: `bitefight-decline:${match.id}`,
              },
            ]
          : []),
      ],
    },
  ];
}

export async function updateBitefightPreview(matchId: string, force = false): Promise<void> {
  const now = Date.now();
  const elapsed = now - (lastRenderAt.get(matchId) ?? 0);
  if (!force && elapsed < MIN_UPDATE_INTERVAL_MS) {
    if (!pendingRenders.has(matchId)) {
      pendingRenders.set(
        matchId,
        setTimeout(() => {
          pendingRenders.delete(matchId);
          void updateBitefightPreview(matchId, true).catch((error) => {
            console.error(`bitefight-preview: delayed render failed for ${matchId}`, error);
          });
        }, MIN_UPDATE_INTERVAL_MS - elapsed),
      );
    }
    return;
  }
  const pending = pendingRenders.get(matchId);
  if (pending) clearTimeout(pending);
  pendingRenders.delete(matchId);
  const active = activeRenders.get(matchId);
  if (active) {
    renderAgain.add(matchId);
    await active;
    return;
  }
  lastRenderAt.set(matchId, now);
  const rendering = (async () => {
    const match = await getStore().getBitefight(matchId);
    if (
      !match?.preview ||
      match.rematchMatchId ||
      now - match.preview.tokenCreatedAt >= TOKEN_TTL_MS
    ) {
      return;
    }
    const pngBuffer = await renderBitefightPreviewImage(match).arrayBuffer();
    const [first, second] = match.players;
    const result = await patchImageWebhookMessage({
      applicationId: match.preview.applicationId,
      webhookToken: match.preview.webhookToken,
      messageId: "@original",
      pngBuffer,
      content: `🥊 **${safeName(first.name)}** vs **${safeName(second.name)}** — ${statusText(match)}`,
      filename: "bitefight-preview.png",
      components: components(match),
    });
    if (!result.ok && result.status !== 404) {
      console.error(
        `bitefight-preview: PATCH failed for ${match.id} (${result.status}): ${result.body}`,
      );
    }
  })();
  activeRenders.set(matchId, rendering);
  try {
    await rendering;
  } finally {
    activeRenders.delete(matchId);
    if (renderAgain.delete(matchId)) {
      void updateBitefightPreview(matchId, true).catch((error) => {
        console.error(`bitefight-preview: follow-up render failed for ${matchId}`, error);
      });
    }
  }
}

function FighterCard({
  player,
  side,
  winner,
}: {
  player: BitefightPlayer;
  side: "left" | "right";
  winner: boolean;
}) {
  const healthPct = Math.max(0, Math.min(100, (player.health / BITEFIGHT_MAX_HEALTH) * 100));
  const accent = side === "left" ? "#4d839c" : "#ad5863";
  return (
    <div style={{ width: 365, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          {player.discordAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={player.discordAvatarUrl}
              alt=""
              width={34}
              height={34}
              style={{
                width: 34,
                height: 34,
                borderRadius: 99,
                objectFit: "cover",
                marginRight: 10,
              }}
            />
          ) : (
            <div
              style={{
                width: 34,
                height: 34,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 99,
                marginRight: 10,
                backgroundColor: accent,
                fontSize: 17,
                fontWeight: 900,
              }}
            >
              {player.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div style={{ display: "flex", fontSize: 20, fontWeight: 800 }}>
            {player.name}
            {winner ? " 🏆" : ""}
          </div>
        </div>
        <div style={{ display: "flex", color: "#c7c9cf", fontSize: 16 }}>
          {player.health} HP
        </div>
      </div>
      <div
        style={{
          display: "flex",
          width: "100%",
          height: 18,
          borderRadius: 999,
          backgroundColor: "#33353c",
          marginTop: 10,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", width: `${healthPct}%`, backgroundColor: accent }} />
      </div>
      <div
        style={{
          height: 155,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 10,
          borderRadius: 24,
          backgroundColor: "#202127",
          border: `2px solid ${accent}`,
        }}
      >
        <div
          style={{
            width: 108,
            height: 118,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: 74,
              height: 55,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-around",
              borderRadius: 12,
              backgroundColor: accent,
              border: "5px solid #111217",
            }}
          >
            <div style={{ width: 10, height: 10, display: "flex", borderRadius: 99, background: "#fff" }} />
            <div style={{ width: 10, height: 10, display: "flex", borderRadius: 99, background: "#fff" }} />
          </div>
          <div
            style={{
              width: 102,
              height: 58,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginTop: 5,
              borderRadius: 12,
              backgroundColor: accent,
              border: "5px solid #111217",
            }}
          >
            <div
              style={{
                width: 58,
                height: 10,
                display: "flex",
                borderRadius: 99,
                backgroundColor: "#111217",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function renderBitefightPreviewImage(match: BitefightRecord) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#121318",
          color: "#f5f5f6",
          padding: 34,
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", fontSize: 31, fontWeight: 900, letterSpacing: 5 }}>
            BITEFIGHT
          </div>
          <div style={{ display: "flex", color: "#a8abb3", fontSize: 17 }}>
            {statusText(match)}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 22,
          }}
        >
          <FighterCard
            player={match.players[0]}
            side="left"
            winner={match.winnerDiscordUserId === match.players[0].discordUserId}
          />
          <div style={{ display: "flex", fontSize: 32, fontWeight: 900, color: "#7f828c" }}>
            VS
          </div>
          <FighterCard
            player={match.players[1]}
            side="right"
            winner={match.winnerDiscordUserId === match.players[1].discordUserId}
          />
        </div>
      </div>
    ),
    { width: 920, height: 430 },
  );
}
