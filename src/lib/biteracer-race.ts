import { discordAvatarUrl } from "./discord";
import { BITERACER_PASSAGES } from "./biteracer-passages";
import { getStore } from "./store";
import type {
  BiteracerRacePlayer,
  BiteracerRaceRecord,
  BiteracerRaceState,
  BiteracerResult,
} from "./types";

export const BITERACER_CHALLENGE_TTL_MS = 2 * 60_000;
export const BITERACER_COUNTDOWN_MS = 3_000;
export const BITERACER_RACE_TIMEOUT_MS = 5 * 60_000;

export function racePlayer(input: {
  discordUserId: string;
  name: string;
  avatar: string | null;
}): BiteracerRacePlayer {
  return {
    discordUserId: input.discordUserId,
    userId: null,
    name: input.name,
    discordAvatarUrl: discordAvatarUrl(input.discordUserId, input.avatar),
    readyAt: null,
    progress: 0,
    correctChars: 0,
    errorCount: 0,
    sequence: 0,
    lastUpdateAt: null,
    finishedAt: null,
    result: null,
  };
}

function advanceLifecycle(race: BiteracerRaceRecord, now: number): void {
  if (race.status === "pending" && now - race.createdAt > BITERACER_CHALLENGE_TTL_MS) {
    race.status = "expired";
    race.finishedAt = now;
  }
  if (race.status === "countdown" && race.startedAt !== null && now >= race.startedAt) {
    race.status = "racing";
  }
  if (
    race.status === "racing" &&
    race.startedAt !== null &&
    now - race.startedAt > BITERACER_RACE_TIMEOUT_MS
  ) {
    race.status = "finished";
    race.finishedAt = now;
    const finishers = race.players.filter((player) => player.finishedAt !== null);
    race.winnerDiscordUserId = finishers[0]?.discordUserId ?? null;
  }
}

export async function raceStateFor(
  raceId: string,
  discordUserId: string,
  userId: string,
  now = Date.now(),
): Promise<BiteracerRaceState | null> {
  const store = getStore();
  const race = await store.getBiteracerRace(raceId);
  if (!race || !race.players.some((player) => player.discordUserId === discordUserId)) return null;
  const before = race.status;
  let changed = false;
  advanceLifecycle(race, now);
  if (race.status !== before) changed = true;
  const me = race.players.find((player) => player.discordUserId === discordUserId)!;
  if (me.userId !== userId) {
    me.userId = userId;
    changed = true;
    const user = await store.getUser(userId);
    if (user) {
      me.name = user.name;
      me.discordAvatarUrl = discordAvatarUrl(user.discordUserId, user.discordAvatar);
    }
  }
  if (changed) await store.putBiteracerRace(race);
  return { ...race, meDiscordUserId: discordUserId, serverNow: now };
}

export async function readyRace(
  raceId: string,
  discordUserId: string,
  now = Date.now(),
): Promise<void> {
  const store = getStore();
  const race = await store.getBiteracerRace(raceId);
  if (!race || !["accepted", "countdown"].includes(race.status)) throw new Error("Race is not ready");
  const player = race.players.find((entry) => entry.discordUserId === discordUserId);
  if (!player) throw new Error("You are not in this race");
  player.readyAt ??= now;
  if (race.players.every((entry) => entry.readyAt !== null) && race.status === "accepted") {
    race.status = "countdown";
    race.countdownAt = now;
    race.startedAt = now + BITERACER_COUNTDOWN_MS;
  }
  await store.putBiteracerRace(race);
}

function typingMetrics(typed: string, expected: string): {
  correctPrefix: number;
  correctChars: number;
  errors: number;
} {
  let correctPrefix = 0;
  while (correctPrefix < typed.length && typed[correctPrefix] === expected[correctPrefix]) {
    correctPrefix++;
  }
  let correctChars = 0;
  for (let i = 0; i < typed.length; i++) if (typed[i] === expected[i]) correctChars++;
  return { correctPrefix, correctChars, errors: typed.length - correctChars };
}

export async function updateRaceProgress(input: {
  raceId: string;
  discordUserId: string;
  typed: string;
  sequence: number;
  now?: number;
}): Promise<void> {
  const now = input.now ?? Date.now();
  const store = getStore();
  const race = await store.getBiteracerRace(input.raceId);
  if (!race) throw new Error("Race not found");
  advanceLifecycle(race, now);
  if (race.status !== "racing" || race.startedAt === null || now < race.startedAt) {
    throw new Error("The race has not started");
  }
  const player = race.players.find((entry) => entry.discordUserId === input.discordUserId);
  if (!player || player.finishedAt !== null) throw new Error("Player cannot update this race");
  if (!Number.isSafeInteger(input.sequence) || input.sequence <= player.sequence) return;
  const typed = input.typed.slice(0, race.passage.text.length);
  const metrics = typingMetrics(typed, race.passage.text);
  player.sequence = input.sequence;
  player.correctChars = metrics.correctChars;
  // Keep the peak observed error count even after corrections so accuracy
  // and net WPM still reflect mistakes instead of every exact finish being 100%.
  player.errorCount = Math.max(player.errorCount, metrics.errors);
  player.progress = metrics.correctPrefix / race.passage.text.length;
  player.lastUpdateAt = now;
  await store.putBiteracerRace(race);
}

function resultFor(
  expected: string,
  startedAt: number,
  finishedAt: number,
  errorCount: number,
): BiteracerResult {
  const elapsedMs = Math.max(1_000, finishedAt - startedAt);
  const rawWpm = (expected.length / 5) / (elapsedMs / 60_000);
  const accuracy = (expected.length / (expected.length + errorCount)) * 100;
  return {
    netWpm: Math.round(rawWpm * (accuracy / 100) * 10) / 10,
    rawWpm: Math.round(rawWpm * 10) / 10,
    accuracy: Math.round(accuracy * 10) / 10,
    elapsedMs,
    correctChars: expected.length,
    errorCount,
  };
}

export async function finishRace(
  raceId: string,
  discordUserId: string,
  typed: string,
  now = Date.now(),
): Promise<void> {
  const store = getStore();
  const race = await store.getBiteracerRace(raceId);
  if (!race) throw new Error("Race not found");
  advanceLifecycle(race, now);
  if (race.status !== "racing" || race.startedAt === null) throw new Error("Race is not running");
  if (typed !== race.passage.text) throw new Error("Correct the passage before finishing");
  const player = race.players.find((entry) => entry.discordUserId === discordUserId);
  if (!player) throw new Error("You are not in this race");
  if (player.finishedAt !== null) return;
  player.progress = 1;
  player.correctChars = race.passage.text.length;
  player.finishedAt = now;
  player.lastUpdateAt = now;
  player.result = resultFor(race.passage.text, race.startedAt, now, player.errorCount);
  race.winnerDiscordUserId ??= discordUserId;
  if (race.players.every((entry) => entry.finishedAt !== null)) {
    race.status = "finished";
    race.finishedAt = now;
  }
  await store.putBiteracerRace(race);
}

export async function rematchRace(
  raceId: string,
  discordUserId: string,
  now = Date.now(),
): Promise<BiteracerRaceRecord> {
  const store = getStore();
  const previous = await store.getBiteracerRace(raceId);
  if (!previous || !previous.players.some((player) => player.discordUserId === discordUserId)) {
    throw new Error("Race not found");
  }
  if (previous.status !== "finished") throw new Error("Finish this race before a rematch");
  const previousIndex = BITERACER_PASSAGES.findIndex(
    (passage) => passage.id === previous.passage.id,
  );
  const passage = BITERACER_PASSAGES[(previousIndex + 1) % BITERACER_PASSAGES.length];
  const race: BiteracerRaceRecord = {
    id: crypto.randomUUID(),
    guildId: previous.guildId,
    channelId: previous.channelId,
    passage,
    status: "accepted",
    createdAt: now,
    acceptedAt: now,
    countdownAt: null,
    startedAt: null,
    finishedAt: null,
    winnerDiscordUserId: null,
    rematchOf: previous.id,
    preview: previous.preview,
    players: previous.players.map((player) =>
      racePlayer({
        discordUserId: player.discordUserId,
        name: player.name,
        avatar: null,
      }),
    ) as [BiteracerRacePlayer, BiteracerRacePlayer],
  };
  race.players.forEach((player, index) => {
    player.userId = previous.players[index].userId;
    player.discordAvatarUrl = previous.players[index].discordAvatarUrl;
  });
  await store.createBiteracerRace(race);
  for (const player of race.players) {
    await store.setBiteracerRaceLaunch(player.discordUserId, race.id, now);
  }
  return race;
}
