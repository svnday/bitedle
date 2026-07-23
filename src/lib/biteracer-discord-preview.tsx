import { ImageResponse } from "next/og";
import { patchImageWebhookMessage } from "./discord-summary";
import { getStore } from "./store";
import type { BiteracerRacePlayer, BiteracerRaceRecord } from "./types";

const TOKEN_TTL_MS = 13 * 60_000;
const MIN_UPDATE_INTERVAL_MS = 600;
const lastRenderAt = new Map<string, number>();

function safeName(name: string): string {
  return name.replaceAll("@", "@\u200b");
}

function raceStatus(race: BiteracerRaceRecord): string {
  if (race.status === "pending") return "Waiting for the challenge to be accepted";
  if (race.status === "accepted") return "Waiting for both racers to ready up";
  if (race.status === "countdown") return "Race starts in 3...";
  if (race.status === "racing") return "Live race";
  if (race.status === "finished") {
    const winner = race.players.find(
      (player) => player.discordUserId === race.winnerDiscordUserId,
    );
    return winner ? `${winner.name} wins!` : "Race finished";
  }
  return `Race ${race.status}`;
}

function previewContent(race: BiteracerRaceRecord): string {
  const [first, second] = race.players;
  return `🏁 **${safeName(first.name)}** vs **${safeName(second.name)}** — ${raceStatus(race)}`;
}

function components(race: BiteracerRaceRecord) {
  if (!["pending", "accepted", "countdown", "racing"].includes(race.status)) return [];
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 3,
          label: race.status === "pending" ? "Accept / Join race" : "Join race",
          custom_id: `biteracer-join:${race.id}`,
        },
        ...(race.status === "pending"
          ? [
              {
                type: 2,
                style: 4,
                label: "Decline",
                custom_id: `biteracer-decline:${race.id}`,
              },
            ]
          : []),
      ],
    },
  ];
}

export async function updateBiteracerPreview(raceId: string, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - (lastRenderAt.get(raceId) ?? 0) < MIN_UPDATE_INTERVAL_MS) return;
  lastRenderAt.set(raceId, now);

  const race = await getStore().getBiteracerRace(raceId);
  if (!race?.preview || now - race.preview.tokenCreatedAt >= TOKEN_TTL_MS) return;
  const pngBuffer = await renderBiteracerPreviewImage(race).arrayBuffer();
  const patched = await patchImageWebhookMessage({
    applicationId: race.preview.applicationId,
    webhookToken: race.preview.webhookToken,
    messageId: "@original",
    pngBuffer,
    content: previewContent(race),
    filename: "biteracer-preview.png",
    components: components(race),
  });
  if (!patched.ok && patched.status !== 404) {
    console.error(
      `biteracer-preview: webhook PATCH failed for race ${race.id} (${patched.status}): ${patched.body}`,
    );
  }
}

function playerWpm(player: BiteracerRacePlayer, race: BiteracerRaceRecord, now: number): number {
  if (player.result) return player.result.netWpm;
  if (!race.startedAt || now <= race.startedAt) return 0;
  return Math.round((player.correctChars / 5 / ((now - race.startedAt) / 60_000)) * 10) / 10;
}

export function renderBiteracerPreviewImage(race: BiteracerRaceRecord, now = Date.now()) {
  const width = 900;
  const height = 430;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#131316",
          color: "#f2f3f5",
          padding: 42,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 800, letterSpacing: 4 }}>
              BITERACER
            </div>
            <div style={{ display: "flex", color: "#a8abb3", fontSize: 16, marginTop: 6 }}>
              {raceStatus(race)}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              border: "1px solid #34363c",
              borderRadius: 999,
              padding: "8px 14px",
              color: "#a8abb3",
              fontSize: 14,
            }}
          >
            1v1 speed test
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 26, marginTop: 38 }}>
          {race.players.map((player) => {
            const pct = Math.max(0, Math.min(1, player.progress));
            const winner = race.winnerDiscordUserId === player.discordUserId;
            return (
              <div key={player.discordUserId} style={{ display: "flex", flexDirection: "column" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 9,
                  }}
                >
                  <div style={{ display: "flex", fontSize: 18, fontWeight: 700 }}>
                    {player.name}
                    {winner ? " 🏆" : ""}
                  </div>
                  <div style={{ display: "flex", color: "#a8abb3", fontSize: 15 }}>
                    {player.finishedAt
                      ? `${player.result?.netWpm ?? 0} WPM`
                      : `${playerWpm(player, race, now)} WPM · ${Math.round(pct * 100)}%`}
                  </div>
                </div>
                <div
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    width: "100%",
                    height: 56,
                    border: "1px solid #34363c",
                    borderRadius: 999,
                    backgroundColor: "#202126",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: 24,
                      right: 40,
                      height: 5,
                      borderRadius: 999,
                      backgroundColor: "#36383f",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: 24,
                      width: `${pct * 86}%`,
                      height: 5,
                      borderRadius: 999,
                      backgroundColor: winner ? "#69b36d" : "#4d839c",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: `${3 + pct * 88}%`,
                      width: 42,
                      height: 42,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 999,
                      border: winner ? "3px solid #69b36d" : "3px solid #555861",
                      backgroundColor: "#30323a",
                      overflow: "hidden",
                      fontSize: 18,
                      fontWeight: 800,
                    }}
                  >
                    {player.discordAvatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={player.discordAvatarUrl}
                        alt=""
                        width={42}
                        height={42}
                        style={{ objectFit: "cover" }}
                      />
                    ) : (
                      player.name.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div style={{ position: "absolute", right: 11, display: "flex", fontSize: 25 }}>
                    🏁
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
