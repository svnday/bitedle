import { ImageResponse } from "next/og";
import { settleBiteshooter } from "./biteshooter";
import {
  BITESHOOTER_CHALLENGE_TTL_MS,
  BITESHOOTER_LOBBY_TIMEOUT_MS,
  BITESHOOTER_MAX_HEALTH,
} from "./biteshooter-constants";
import { patchImageWebhookMessage } from "./discord-summary";
import { getStore } from "./store";
import type { BiteshooterPlayer, BiteshooterRecord } from "./types";

const TOKEN_TTL_MS = 13 * 60_000;
const MIN_UPDATE_INTERVAL_MS = 650;
const TERMINAL_STATUSES = new Set<BiteshooterRecord["status"]>([
  "finished",
  "declined",
  "cancelled",
  "expired",
]);

interface RenderQueue {
  requested: boolean;
  force: boolean;
  running: Promise<void> | null;
  wake: (() => void) | null;
}

const renderQueues = new Map<string, RenderQueue>();
const lastRenderAt = new Map<string, number>();
const lastRenderedRevision = new Map<string, number>();

function safeName(name: string): string {
  return name.replaceAll("@", "@\u200b");
}

function imageName(name: string): string {
  return name.length <= 25 ? name : `${name.slice(0, 24)}…`;
}

function accuracyFor(player: BiteshooterPlayer): number {
  return player.attempts === 0 ? 0 : Math.round((player.hits / player.attempts) * 100);
}

function finishReasonText(match: BiteshooterRecord): string {
  if (match.finishReason === "knockout") return "knockout";
  if (match.finishReason === "forfeit") return "forfeit";
  if (match.finishReason === "timeout") return "time";
  return "a draw";
}

function remainingText(deadline: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} left`;
}

function statusText(match: BiteshooterRecord, now = Date.now()): string {
  if (match.status === "pending") {
    return `Waiting for acceptance - ${remainingText(
      match.createdAt + BITESHOOTER_CHALLENGE_TTL_MS,
      now,
    )}`;
  }
  if (match.status === "accepted") {
    const missingPlayers = match.players.filter((player) => player.joinedAt === null);
    const joinTime =
      match.acceptedAt === null
        ? ""
        : ` - ${remainingText(
            match.acceptedAt + BITESHOOTER_LOBBY_TIMEOUT_MS,
            now,
          )}`;
    if (missingPlayers.length === 2) return `Waiting for both players to join${joinTime}`;
    if (missingPlayers.length === 1) {
      return `Waiting for ${missingPlayers[0].name} to join${joinTime}`;
    }
    const unreadyPlayers = match.players.filter((player) => player.readyAt === null);
    if (unreadyPlayers.length === 2) return "Both players joined - ready up";
    if (unreadyPlayers.length === 1) return `Waiting for ${unreadyPlayers[0].name} to ready up`;
    return "Both players are ready";
  }
  if (match.status === "countdown") {
    const seconds =
      match.startedAt === null
        ? 3
        : Math.max(1, Math.ceil((match.startedAt - now) / 1_000));
    return `Match starts in ${seconds}...`;
  }
  if (match.status === "fighting") return "Live match";
  if (match.status === "finished") {
    const winner = match.players.find(
      (player) => player.discordUserId === match.winnerDiscordUserId,
    );
    return winner
      ? `${winner.name} wins by ${finishReasonText(match)}`
      : "Match ends in a draw";
  }
  if (match.status === "declined") return "Challenge declined";
  if (match.status === "expired") return "Challenge expired";
  if (match.players.some((player) => player.joinedAt === null)) {
    return "Match cancelled - a player did not join";
  }
  return "Match cancelled";
}

function joinState(match: BiteshooterRecord, player: BiteshooterPlayer, index: number): string {
  if (match.status === "pending") {
    return index === 0 ? "Challenge sent" : "Waiting to accept";
  }
  if (player.joinedAt === null) return "Not joined";
  if (match.status === "accepted") return player.readyAt === null ? "Joined" : "Ready";
  if (match.status === "countdown") return "Ready";
  if (match.status === "fighting") return "In range";
  if (match.status === "finished") return "Finished";
  return "Joined";
}

function components(match: BiteshooterRecord) {
  if (!["pending", "accepted", "countdown", "fighting"].includes(match.status)) return [];
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 3,
          label: match.status === "pending" ? "Accept / Join match" : "Join match",
          custom_id: `biteshooter-join:${match.id}`,
        },
        ...(match.status === "pending"
          ? [
              {
                type: 2,
                style: 4,
                label: "Decline",
                custom_id: `biteshooter-decline:${match.id}`,
              },
            ]
          : []),
      ],
    },
  ];
}

async function settledMatch(matchId: string): Promise<BiteshooterRecord | null> {
  const existing = await getStore().getBiteshooter(matchId);
  if (!existing) return null;
  return settleBiteshooter(matchId);
}

function waitForQueue(queue: RenderQueue, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      queue.wake = null;
      resolve();
    }, ms);
    queue.wake = () => {
      clearTimeout(timer);
      queue.wake = null;
      resolve();
    };
  });
}

function pruneRenderHistory(now: number): void {
  if (lastRenderAt.size <= 2_000) return;
  for (const [matchId, renderedAt] of lastRenderAt) {
    if (now - renderedAt < TOKEN_TTL_MS) continue;
    lastRenderAt.delete(matchId);
    lastRenderedRevision.delete(matchId);
  }
}

async function renderLatest(matchId: string): Promise<void> {
  const match = await settledMatch(matchId);
  const now = Date.now();
  if (
    !match?.preview ||
    match.rematchMatchId ||
    now - match.preview.tokenCreatedAt >= TOKEN_TTL_MS
  ) {
    lastRenderAt.delete(matchId);
    lastRenderedRevision.delete(matchId);
    return;
  }

  lastRenderAt.set(matchId, now);
  pruneRenderHistory(now);

  const pngBuffer = await renderBiteshooterPreviewImage(match).arrayBuffer();
  const [first, second] = match.players;
  const result = await patchImageWebhookMessage({
    applicationId: match.preview.applicationId,
    webhookToken: match.preview.webhookToken,
    messageId: "@original",
    pngBuffer,
    content: `🎯 **${safeName(first.name)}** vs **${safeName(second.name)}** - ${safeName(
      statusText(match, now),
    )}`,
    filename: "biteshooter-preview.png",
    components: components(match),
  });

  if (result.ok || result.status === 404) {
    lastRenderedRevision.set(matchId, match.revision);
  }
  if (!result.ok && result.status !== 404) {
    console.error(
      `biteshooter-preview: PATCH failed for ${match.id} (${result.status}): ${result.body}`,
    );
  }
}

async function drainQueue(matchId: string, queue: RenderQueue): Promise<void> {
  while (queue.requested) {
    let force = queue.force;
    queue.requested = false;
    queue.force = false;

    const elapsed = Date.now() - (lastRenderAt.get(matchId) ?? 0);
    if (!force && elapsed < MIN_UPDATE_INTERVAL_MS) {
      await waitForQueue(queue, MIN_UPDATE_INTERVAL_MS - elapsed);
      force ||= queue.force;
      // The imminent render reads the newest persisted revision, so it also
      // satisfies every request that arrived while this queue was waiting.
      queue.requested = false;
      queue.force = false;
    }

    try {
      await renderLatest(matchId);
    } catch (error) {
      console.error(`biteshooter-preview: render failed for ${matchId}`, error);
    }
  }
}

/**
 * Settles time-based lifecycle transitions, then coalesces preview edits for
 * one match. The returned promise includes any throttle wait so Next's
 * `after()` keeps the serverless invocation alive through the final render.
 */
export async function updateBiteshooterPreview(
  matchId: string,
  force = false,
): Promise<void> {
  let match: BiteshooterRecord | null;
  try {
    match = await settledMatch(matchId);
  } catch (error) {
    console.error(`biteshooter-preview: lifecycle settlement failed for ${matchId}`, error);
    return;
  }
  if (
    !match?.preview ||
    match.rematchMatchId ||
    Date.now() - match.preview.tokenCreatedAt >= TOKEN_TTL_MS
  ) {
    return;
  }

  const terminalRevisionPending =
    TERMINAL_STATUSES.has(match.status) &&
    lastRenderedRevision.get(matchId) !== match.revision;
  if (
    !force &&
    !terminalRevisionPending &&
    lastRenderedRevision.get(matchId) === match.revision
  ) {
    return;
  }

  let queue = renderQueues.get(matchId);
  if (!queue) {
    queue = { requested: false, force: false, running: null, wake: null };
    renderQueues.set(matchId, queue);
  }
  queue.requested = true;
  const mustForce = force || terminalRevisionPending;
  queue.force ||= mustForce;
  if (mustForce) queue.wake?.();

  if (!queue.running) {
    const activeQueue = queue;
    activeQueue.running = drainQueue(matchId, activeQueue).finally(() => {
      activeQueue.running = null;
      activeQueue.wake = null;
      renderQueues.delete(matchId);
    });
  }
  await queue.running;
}

function TargetMark() {
  return (
    <div
      style={{
        width: 92,
        height: 92,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 999,
        backgroundColor: "#d84b45",
        border: "3px solid #3a2224",
      }}
    >
      <div
        style={{
          width: 57,
          height: 57,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 999,
          backgroundColor: "#f0c94f",
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 999,
            backgroundColor: "#f7f3e8",
            color: "#171717",
            fontSize: 12,
            fontWeight: 900,
          }}
        >
          3
        </div>
      </div>
    </div>
  );
}

function PlayerCard({
  match,
  player,
  index,
}: {
  match: BiteshooterRecord;
  player: BiteshooterPlayer;
  index: number;
}) {
  const accent = index === 0 ? "#4d839c" : "#ad5863";
  const healthPct = Math.max(
    0,
    Math.min(100, (player.health / BITESHOOTER_MAX_HEALTH) * 100),
  );
  const winner = match.winnerDiscordUserId === player.discordUserId;
  return (
    <div
      style={{
        width: 350,
        height: 242,
        display: "flex",
        flexDirection: "column",
        borderRadius: 22,
        border: `2px solid ${winner ? "#f0c94f" : accent}`,
        backgroundColor: "#202127",
        padding: 18,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", width: 230 }}>
          {player.discordAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={player.discordAvatarUrl}
              alt=""
              width={38}
              height={38}
              style={{
                width: 38,
                height: 38,
                borderRadius: 99,
                objectFit: "cover",
                marginRight: 10,
              }}
            />
          ) : (
            <div
              style={{
                width: 38,
                height: 38,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 99,
                marginRight: 10,
                backgroundColor: accent,
                fontSize: 18,
                fontWeight: 900,
              }}
            >
              {player.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div style={{ display: "flex", fontSize: 19, fontWeight: 800 }}>
            {imageName(player.name)}
          </div>
        </div>
        <div style={{ display: "flex", color: "#f5f5f6", fontSize: 16, fontWeight: 800 }}>
          {player.health} HP
        </div>
      </div>

      <div
        style={{
          width: "100%",
          height: 15,
          display: "flex",
          marginTop: 13,
          overflow: "hidden",
          borderRadius: 999,
          backgroundColor: "#36383f",
        }}
      >
        <div
          style={{
            width: `${healthPct}%`,
            height: "100%",
            display: "flex",
            backgroundColor: healthPct <= 25 ? "#d84b45" : accent,
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            borderRadius: 999,
            backgroundColor: player.joinedAt === null ? "#34363c" : `${accent}44`,
            color: player.joinedAt === null ? "#a8abb3" : "#f5f5f6",
            padding: "6px 10px",
            fontSize: 13,
            fontWeight: 800,
          }}
        >
          {joinState(match, player, index)}
        </div>
        {winner && (
          <div style={{ display: "flex", color: "#f0c94f", fontSize: 13, fontWeight: 900 }}>
            WINNER
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
        <Stat value={`${accuracyFor(player)}%`} label="Accuracy" />
        <Stat value={`${player.hits}/${player.attempts}`} label="Hits" />
        <Stat value={String(player.innerHits)} label="Bullseyes" />
        <Stat value={String(player.totalDamage)} label="Damage" />
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div
      style={{
        width: 72,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        borderRadius: 10,
        backgroundColor: "#15161a",
        padding: "8px 4px",
      }}
    >
      <div style={{ display: "flex", color: "#f5f5f6", fontSize: 16, fontWeight: 900 }}>
        {value}
      </div>
      <div
        style={{
          display: "flex",
          color: "#8f929b",
          fontSize: 9,
          fontWeight: 700,
          marginTop: 2,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
    </div>
  );
}

export function renderBiteshooterPreviewImage(match: BiteshooterRecord) {
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
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 31, fontWeight: 900, letterSpacing: 5 }}>
              BITESHOOTER
            </div>
            <div style={{ display: "flex", color: "#8f929b", fontSize: 13, marginTop: 4 }}>
              3 HP bullseye · 2 HP middle · 1 HP outer
            </div>
          </div>
          <div
            style={{
              width: 500,
              display: "flex",
              justifyContent: "flex-end",
              color: "#c7c9cf",
              fontSize: 16,
              fontWeight: 700,
              textAlign: "right",
            }}
          >
            {statusText(match)}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 25,
          }}
        >
          <PlayerCard match={match} player={match.players[0]} index={0} />
          <div
            style={{
              width: 118,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <TargetMark />
            <div
              style={{
                display: "flex",
                color: "#7f828c",
                fontSize: 18,
                fontWeight: 900,
                marginTop: 10,
                letterSpacing: 3,
              }}
            >
              VS
            </div>
          </div>
          <PlayerCard match={match} player={match.players[1]} index={1} />
        </div>
      </div>
    ),
    { width: 920, height: 430 },
  );
}
