import { discordAvatarUrl } from "./discord";
import { BITERACER_PASSAGES } from "./biteracer-passages";
import { getStore } from "./store";
import type {
  BiteracerRacePlayer,
  BiteracerRaceLeaderboardEntry,
  BiteracerRaceRecord,
  BiteracerRaceState,
  BiteracerResult,
} from "./types";

export const BITERACER_CHALLENGE_TTL_MS = 2 * 60_000;
export const BITERACER_COUNTDOWN_MS = 3_000;
export const BITERACER_INACTIVITY_TIMEOUT_MS = 60_000;
export const BITERACER_RACE_TIMEOUT_MS = 5 * 60_000;

export function randomRacePassage(usedPassageIds: string[] = []) {
  const used = new Set(usedPassageIds);
  let candidates = BITERACER_PASSAGES.filter((passage) => !used.has(passage.id));
  // Once the full corpus has been used, begin a new cycle while still
  // preventing the most recent passage from appearing twice in a row.
  if (candidates.length === 0) {
    const mostRecent = usedPassageIds[usedPassageIds.length - 1];
    candidates = BITERACER_PASSAGES.filter((passage) => passage.id !== mostRecent);
  }
  const draw = new Uint32Array(1);
  crypto.getRandomValues(draw);
  return candidates[draw[0] % candidates.length];
}

export function raceLeaderboardFrom(
  races: BiteracerRaceRecord[],
  meDiscordUserId: string,
): BiteracerRaceLeaderboardEntry[] {
  const players = new Map<
    string,
    Omit<BiteracerRaceLeaderboardEntry, "races" | "winPct" | "me">
  >();
  for (const race of races.sort((a, b) => a.createdAt - b.createdAt)) {
    if (race.status !== "finished" || !race.winnerDiscordUserId) continue;
    for (const player of race.players) {
      const entry = players.get(player.discordUserId) ?? {
        discordUserId: player.discordUserId,
        name: player.name,
        discordAvatarUrl: player.discordAvatarUrl,
        wins: 0,
        losses: 0,
      };
      entry.name = player.name;
      entry.discordAvatarUrl = player.discordAvatarUrl;
      if (player.discordUserId === race.winnerDiscordUserId) entry.wins++;
      else entry.losses++;
      players.set(player.discordUserId, entry);
    }
  }
  return [...players.values()]
    .map((entry) => {
      const races = entry.wins + entry.losses;
      return {
        ...entry,
        races,
        winPct: Math.round((entry.wins / races) * 1000) / 10,
        me: entry.discordUserId === meDiscordUserId,
      };
    })
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.name.localeCompare(b.name));
}

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

function advanceLifecycle(race: BiteracerRaceRecord, now: number): boolean {
  if (race.status === "pending" && now - race.createdAt > BITERACER_CHALLENGE_TTL_MS) {
    race.status = "expired";
    race.finishedAt = now;
    return true;
  }
  let changed = false;
  if (race.status === "countdown" && race.startedAt !== null && now >= race.startedAt) {
    race.status = "racing";
    changed = true;
  }
  if (race.status === "racing" && race.startedAt !== null) {
    const inactivePlayers = race.players.filter(
      (player) =>
        player.finishedAt === null &&
        now - (player.lastUpdateAt ?? race.startedAt!) >=
          BITERACER_INACTIVITY_TIMEOUT_MS,
    );
    if (inactivePlayers.length > 0) {
      race.status = "finished";
      race.finishedAt = now;
      if (!race.winnerDiscordUserId) {
        const firstFinisher = race.players
          .filter((player) => player.finishedAt !== null)
          .sort((a, b) => a.finishedAt! - b.finishedAt!)[0];
        if (firstFinisher) {
          race.winnerDiscordUserId = firstFinisher.discordUserId;
        } else if (inactivePlayers.length === 1) {
          race.winnerDiscordUserId =
            race.players.find(
              (player) =>
                player.discordUserId !== inactivePlayers[0].discordUserId,
            )?.discordUserId ?? null;
        }
      }
      return true;
    }
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
    return true;
  }
  return changed;
}

async function mutate<T>(
  raceId: string,
  update: (race: BiteracerRaceRecord) => { changed: boolean; result: T },
): Promise<{ race: BiteracerRaceRecord; result: T }> {
  const store = getStore();
  for (let attempt = 0; attempt < 12; attempt++) {
    const current = await store.getBiteracerRace(raceId);
    if (!current) throw new Error("Race not found");
    const expectedRevision = current.revision;
    const { changed, result } = update(current);
    if (!changed) return { race: current, result };
    current.revision = expectedRevision + 1;
    if (await store.compareAndSwapBiteracerRace(current, expectedRevision)) {
      return { race: current, result };
    }
  }
  throw new Error("Race is busy - try again");
}

export async function raceStateFor(
  raceId: string,
  discordUserId: string,
  userId: string,
  now = Date.now(),
): Promise<BiteracerRaceState | null> {
  const store = getStore();
  const existing = await store.getBiteracerRace(raceId);
  if (!existing?.players.some((player) => player.discordUserId === discordUserId)) return null;
  const user = await store.getUser(userId);
  const { race } = await mutate(raceId, (current) => {
    let changed = advanceLifecycle(current, now);
    const me = current.players.find((player) => player.discordUserId === discordUserId)!;
    if (me.userId !== userId) {
      me.userId = userId;
      changed = true;
    }
    if (
      user &&
      (me.name !== user.name ||
        me.discordAvatarUrl !== discordAvatarUrl(user.discordUserId, user.discordAvatar))
    ) {
      me.name = user.name;
      me.discordAvatarUrl = discordAvatarUrl(user.discordUserId, user.discordAvatar);
      changed = true;
    }
    return { changed, result: null };
  });
  return { ...race, meDiscordUserId: discordUserId, serverNow: now };
}

export async function acceptRace(
  raceId: string,
  discordUserId: string,
  now = Date.now(),
): Promise<BiteracerRaceRecord> {
  const { race } = await mutate(raceId, (current) => {
    const lifecycleChanged = advanceLifecycle(current, now);
    if (
      current.players[1].discordUserId !== discordUserId ||
      current.status !== "pending"
    ) {
      if (lifecycleChanged) return { changed: true, result: null };
      throw new Error("This challenge cannot be accepted");
    }
    current.status = "accepted";
    current.acceptedAt = now;
    return { changed: true, result: null };
  });
  if (race.status !== "accepted") throw new Error("This challenge cannot be accepted");
  return race;
}

export async function declineRace(
  raceId: string,
  discordUserId: string,
  now = Date.now(),
): Promise<BiteracerRaceRecord> {
  const { race } = await mutate(raceId, (current) => {
    const lifecycleChanged = advanceLifecycle(current, now);
    if (
      current.players[1].discordUserId !== discordUserId ||
      current.status !== "pending"
    ) {
      if (lifecycleChanged) return { changed: true, result: null };
      throw new Error("This challenge cannot be declined");
    }
    current.status = "declined";
    current.finishedAt = now;
    return { changed: true, result: null };
  });
  if (race.status !== "declined") throw new Error("This challenge cannot be declined");
  return race;
}

export async function expireRace(
  raceId: string,
  now = Date.now(),
): Promise<BiteracerRaceRecord> {
  return (
    await mutate(raceId, (race) => {
      if (race.status !== "pending") return { changed: false, result: null };
      race.status = "expired";
      race.finishedAt = now;
      return { changed: true, result: null };
    })
  ).race;
}

export async function readyRace(
  raceId: string,
  discordUserId: string,
  now = Date.now(),
): Promise<void> {
  await mutate(raceId, (race) => {
    const lifecycleChanged = advanceLifecycle(race, now);
    if (!["accepted", "countdown"].includes(race.status)) {
      if (lifecycleChanged) return { changed: true, result: null };
      throw new Error("Race is not ready");
    }
    const player = race.players.find((entry) => entry.discordUserId === discordUserId);
    if (!player) throw new Error("You are not in this race");
    let changed = false;
    if (player.readyAt === null) {
      player.readyAt = now;
      changed = true;
    }
    if (race.players.every((entry) => entry.readyAt !== null) && race.status === "accepted") {
      race.status = "countdown";
      race.countdownAt = now;
      race.startedAt = now + BITERACER_COUNTDOWN_MS;
      changed = true;
    }
    return { changed: lifecycleChanged || changed, result: null };
  });
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
  await mutate(input.raceId, (race) => {
    const lifecycleChanged = advanceLifecycle(race, now);
    if (race.status !== "racing" || race.startedAt === null || now < race.startedAt) {
      if (lifecycleChanged) return { changed: true, result: null };
      throw new Error("The race has not started");
    }
    const player = race.players.find((entry) => entry.discordUserId === input.discordUserId);
    if (!player) throw new Error("You are not in this race");
    // A delayed progress request must never overwrite or reopen a completed
    // player's immutable result.
    if (player.finishedAt !== null) {
      return { changed: lifecycleChanged, result: null };
    }
    if (!Number.isSafeInteger(input.sequence) || input.sequence <= player.sequence) {
      return { changed: lifecycleChanged, result: null };
    }
    const typed = input.typed.slice(0, race.passage.text.length);
    const metrics = typingMetrics(typed, race.passage.text);
    player.sequence = input.sequence;
    player.correctChars = metrics.correctChars;
    // Keep the peak observed error count even after corrections so accuracy
    // and net WPM still reflect mistakes instead of every exact finish being 100%.
    player.errorCount = Math.max(player.errorCount, metrics.errors);
    player.progress = metrics.correctPrefix / race.passage.text.length;
    player.lastUpdateAt = now;
    if (typed === race.passage.text) finishPlayer(race, player, now);
    return { changed: true, result: null };
  });
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

function finishPlayer(
  race: BiteracerRaceRecord,
  player: BiteracerRacePlayer,
  now: number,
): void {
  if (race.startedAt === null || player.finishedAt !== null) return;
  player.progress = 1;
  player.correctChars = race.passage.text.length;
  player.finishedAt = now;
  player.lastUpdateAt = now;
  player.result = resultFor(race.passage.text, race.startedAt, now, player.errorCount);
  race.winnerDiscordUserId ??= player.discordUserId;
  if (race.players.every((entry) => entry.finishedAt !== null)) {
    race.status = "finished";
    race.finishedAt = now;
  }
}

export async function finishRace(
  raceId: string,
  discordUserId: string,
  typed: string,
  now = Date.now(),
): Promise<void> {
  await mutate(raceId, (race) => {
    const lifecycleChanged = advanceLifecycle(race, now);
    if (race.status !== "racing" || race.startedAt === null) {
      if (lifecycleChanged) return { changed: true, result: null };
      throw new Error("Race is not running");
    }
    if (typed !== race.passage.text) throw new Error("Correct the passage before finishing");
    const player = race.players.find((entry) => entry.discordUserId === discordUserId);
    if (!player) throw new Error("You are not in this race");
    if (player.finishedAt !== null) {
      return { changed: lifecycleChanged, result: null };
    }
    finishPlayer(race, player, now);
    return { changed: true, result: null };
  });
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
  const history = await store.allBiteracerRaces();
  const passage = randomRacePassage([
    ...history.sort((a, b) => a.createdAt - b.createdAt).map((race) => race.passage.id),
    previous.passage.id,
  ]);
  const race: BiteracerRaceRecord = {
    id: crypto.randomUUID(),
    revision: 0,
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
