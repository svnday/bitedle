import { discordAvatarUrl } from "./discord";
import { getStore } from "./store";
import type {
  BitefightLeaderboardEntry,
  BitefightPlayer,
  BitefightRecord,
  BitefightState,
} from "./types";
import {
  BITEFIGHT_CHALLENGE_TTL_MS,
  BITEFIGHT_COUNTDOWN_MS,
  BITEFIGHT_LOBBY_TIMEOUT_MS,
  BITEFIGHT_MAX_HEALTH,
  BITEFIGHT_PUNCH_DAMAGE,
  BITEFIGHT_TIMEOUT_MS,
} from "./bitefight-constants";

export {
  BITEFIGHT_CHALLENGE_TTL_MS,
  BITEFIGHT_COUNTDOWN_MS,
  BITEFIGHT_LOBBY_TIMEOUT_MS,
  BITEFIGHT_MAX_HEALTH,
  BITEFIGHT_PUNCH_DAMAGE,
  BITEFIGHT_TIMEOUT_MS,
} from "./bitefight-constants";

const ACTIVE_STATUSES = new Set(["pending", "accepted", "countdown", "fighting"]);

export function bitefightPlayer(input: {
  discordUserId: string;
  name: string;
  avatar: string | null;
}): BitefightPlayer {
  return {
    discordUserId: input.discordUserId,
    userId: null,
    name: input.name,
    discordAvatarUrl: discordAvatarUrl(input.discordUserId, input.avatar),
    readyAt: null,
    health: BITEFIGHT_MAX_HEALTH,
    punches: 0,
    lastSequence: 0,
    lastAcceptedAt: null,
  };
}

export async function hasActiveBitefight(discordUserId: string): Promise<boolean> {
  const candidates = (await getStore().allBitefights()).filter(
    (match) =>
      ACTIVE_STATUSES.has(match.status) &&
      match.players.some((player) => player.discordUserId === discordUserId),
  );
  for (const candidate of candidates) {
    const settled = await settleBitefight(candidate.id);
    if (ACTIVE_STATUSES.has(settled.status)) return true;
  }
  return false;
}

function advanceLifecycle(match: BitefightRecord, now: number): boolean {
  if (
    match.status === "pending" &&
    now - match.createdAt > BITEFIGHT_CHALLENGE_TTL_MS
  ) {
    match.status = "expired";
    match.finishedAt = now;
    return true;
  }
  if (
    match.status === "accepted" &&
    match.acceptedAt !== null &&
    now - match.acceptedAt >= BITEFIGHT_LOBBY_TIMEOUT_MS
  ) {
    match.status = "cancelled";
    match.finishedAt = now;
    return true;
  }
  let changed = false;
  if (match.status === "countdown" && match.startedAt !== null && now >= match.startedAt) {
    match.status = "fighting";
    changed = true;
  }
  if (
    match.status === "fighting" &&
    match.startedAt !== null &&
    now - match.startedAt >= BITEFIGHT_TIMEOUT_MS
  ) {
    match.status = "finished";
    match.finishedAt = now;
    const [first, second] = match.players;
    if (first.health === second.health) {
      match.winnerDiscordUserId = null;
      match.finishReason = "draw";
    } else {
      match.winnerDiscordUserId =
        first.health > second.health ? first.discordUserId : second.discordUserId;
      match.finishReason = "timeout";
    }
    return true;
  }
  return changed;
}

async function mutate<T>(
  matchId: string,
  update: (match: BitefightRecord) => { changed: boolean; result: T },
): Promise<{ match: BitefightRecord; result: T }> {
  const store = getStore();
  for (let attempt = 0; attempt < 12; attempt++) {
    const current = await store.getBitefight(matchId);
    if (!current) throw new Error("Fight not found");
    const expectedRevision = current.revision;
    const { changed, result } = update(current);
    if (!changed) return { match: current, result };
    current.revision = expectedRevision + 1;
    if (await store.compareAndSwapBitefight(current, expectedRevision)) {
      return { match: current, result };
    }
  }
  throw new Error("Fight is busy - try again");
}

export async function settleBitefight(
  matchId: string,
  now = Date.now(),
): Promise<BitefightRecord> {
  return (
    await mutate(matchId, (match) => ({
      changed: advanceLifecycle(match, now),
      result: null,
    }))
  ).match;
}

export async function bitefightStateFor(
  matchId: string,
  discordUserId: string,
  userId: string,
  now = Date.now(),
): Promise<BitefightState | null> {
  const existing = await getStore().getBitefight(matchId);
  if (!existing?.players.some((player) => player.discordUserId === discordUserId)) return null;
  const { match } = await mutate(matchId, (current) => {
    let changed = advanceLifecycle(current, now);
    const player = current.players.find((entry) => entry.discordUserId === discordUserId)!;
    if (player.userId !== userId) {
      player.userId = userId;
      changed = true;
    }
    return { changed, result: null };
  });
  const player = match.players.find((entry) => entry.discordUserId === discordUserId)!;
  if (player.userId === userId) {
    const user = await getStore().getUser(userId);
    if (
      user &&
      (player.name !== user.name ||
        player.discordAvatarUrl !== discordAvatarUrl(user.discordUserId, user.discordAvatar))
    ) {
      const refreshed = await mutate(matchId, (current) => {
        const target = current.players.find(
          (entry) => entry.discordUserId === discordUserId,
        )!;
        target.name = user.name;
        target.discordAvatarUrl = discordAvatarUrl(user.discordUserId, user.discordAvatar);
        return { changed: true, result: null };
      });
      return { ...refreshed.match, meDiscordUserId: discordUserId, serverNow: now };
    }
  }
  return { ...match, meDiscordUserId: discordUserId, serverNow: now };
}

export async function acceptBitefight(
  matchId: string,
  discordUserId: string,
  now = Date.now(),
): Promise<BitefightRecord> {
  const result = await mutate(matchId, (match) => {
      const lifecycleChanged = advanceLifecycle(match, now);
      if (match.players[1].discordUserId !== discordUserId || match.status !== "pending") {
        if (lifecycleChanged) return { changed: true, result: null };
        throw new Error("This challenge cannot be accepted");
      }
      match.status = "accepted";
      match.acceptedAt = now;
      return { changed: true, result: null };
    });
  if (result.match.status !== "accepted") {
    throw new Error("This challenge cannot be accepted");
  }
  return result.match;
}

export async function declineBitefight(
  matchId: string,
  discordUserId: string,
  now = Date.now(),
): Promise<BitefightRecord> {
  const result = await mutate(matchId, (match) => {
      const lifecycleChanged = advanceLifecycle(match, now);
      if (match.players[1].discordUserId !== discordUserId || match.status !== "pending") {
        if (lifecycleChanged) return { changed: true, result: null };
        throw new Error("This challenge cannot be declined");
      }
      match.status = "declined";
      match.finishedAt = now;
      return { changed: true, result: null };
    });
  if (result.match.status !== "declined") {
    throw new Error("This challenge cannot be declined");
  }
  return result.match;
}

export async function expireBitefight(
  matchId: string,
  now = Date.now(),
): Promise<BitefightRecord> {
  return (
    await mutate(matchId, (match) => {
      if (match.status !== "pending") return { changed: false, result: null };
      match.status = "expired";
      match.finishedAt = now;
      return { changed: true, result: null };
    })
  ).match;
}

export async function readyBitefight(
  matchId: string,
  discordUserId: string,
  now = Date.now(),
): Promise<BitefightRecord> {
  return (
    await mutate(matchId, (match) => {
      const lifecycleChanged = advanceLifecycle(match, now);
      if (!["accepted", "countdown"].includes(match.status)) {
        if (lifecycleChanged) return { changed: true, result: null };
        throw new Error("Fight is not ready");
      }
      const player = match.players.find((entry) => entry.discordUserId === discordUserId);
      if (!player) throw new Error("You are not in this fight");
      let changed = false;
      if (player.readyAt === null) {
        player.readyAt = now;
        changed = true;
      }
      if (match.status === "accepted" && match.players.every((entry) => entry.readyAt !== null)) {
        match.status = "countdown";
        match.countdownAt = now;
        match.startedAt = now + BITEFIGHT_COUNTDOWN_MS;
        changed = true;
      }
      return { changed, result: null };
    })
  ).match;
}

export async function punchBitefight(input: {
  matchId: string;
  discordUserId: string;
  sequence: number;
  now?: number;
}): Promise<{ match: BitefightRecord; accepted: boolean }> {
  const now = input.now ?? Date.now();
  const result = await mutate(input.matchId, (match) => {
    const lifecycleChanged = advanceLifecycle(match, now);
    if (match.status !== "fighting" || match.startedAt === null || now < match.startedAt) {
      if (lifecycleChanged) return { changed: true, result: false };
      throw new Error("The fight has not started");
    }
    const attackerIndex = match.players.findIndex(
      (entry) => entry.discordUserId === input.discordUserId,
    );
    if (attackerIndex < 0) throw new Error("You are not in this fight");
    const attacker = match.players[attackerIndex];
    const opponent = match.players[attackerIndex === 0 ? 1 : 0];
    if (!Number.isSafeInteger(input.sequence) || input.sequence <= attacker.lastSequence) {
      return { changed: lifecycleChanged, result: false };
    }
    attacker.lastSequence = input.sequence;
    attacker.punches += 1;
    attacker.lastAcceptedAt = now;
    opponent.health = Math.max(0, opponent.health - BITEFIGHT_PUNCH_DAMAGE);
    if (opponent.health === 0) {
      match.status = "finished";
      match.finishedAt = now;
      match.winnerDiscordUserId = attacker.discordUserId;
      match.finishReason = "knockout";
    }
    return { changed: true, result: true };
  });
  return { match: result.match, accepted: result.result };
}

export async function forfeitBitefight(
  matchId: string,
  discordUserId: string,
  now = Date.now(),
): Promise<BitefightRecord> {
  return (
    await mutate(matchId, (match) => {
      const lifecycleChanged = advanceLifecycle(match, now);
      if (!["accepted", "countdown", "fighting"].includes(match.status)) {
        if (lifecycleChanged) return { changed: true, result: null };
        throw new Error("Fight cannot be forfeited");
      }
      const loserIndex = match.players.findIndex(
        (entry) => entry.discordUserId === discordUserId,
      );
      if (loserIndex < 0) throw new Error("You are not in this fight");
      match.finishedAt = now;
      if (match.status === "fighting") {
        match.status = "finished";
        match.winnerDiscordUserId = match.players[loserIndex === 0 ? 1 : 0].discordUserId;
        match.finishReason = "forfeit";
      } else {
        match.status = "cancelled";
        match.winnerDiscordUserId = null;
        match.finishReason = null;
      }
      return { changed: true, result: null };
    })
  ).match;
}

export async function rematchBitefight(
  matchId: string,
  discordUserId: string,
  now = Date.now(),
): Promise<BitefightRecord> {
  const claimed = await mutate(matchId, (previous) => {
    if (
      previous.status !== "finished" ||
      !previous.players.some((player) => player.discordUserId === discordUserId)
    ) {
      throw new Error("Finish this fight before a rematch");
    }
    if (previous.rematchMatchId) {
      return { changed: false, result: previous.rematchMatchId };
    }
    previous.rematchMatchId = crypto.randomUUID();
    return { changed: true, result: previous.rematchMatchId };
  });
  const previous = claimed.match;
  const existing = await getStore().getBitefight(claimed.result);
  const match: BitefightRecord = existing ?? {
    id: claimed.result,
    revision: 0,
    guildId: previous.guildId,
    channelId: previous.channelId,
    status: "accepted",
    createdAt: now,
    acceptedAt: now,
    countdownAt: null,
    startedAt: null,
    finishedAt: null,
    winnerDiscordUserId: null,
    finishReason: null,
    rematchOf: previous.id,
    rematchMatchId: null,
    preview: previous.preview,
    players: previous.players.map((player) => {
      const fresh = bitefightPlayer({
        discordUserId: player.discordUserId,
        name: player.name,
        avatar: null,
      });
      fresh.userId = player.userId;
      fresh.discordAvatarUrl = player.discordAvatarUrl;
      return fresh;
    }) as [BitefightPlayer, BitefightPlayer],
  };
  if (!existing) await getStore().createBitefight(match);
  const persisted = (await getStore().getBitefight(match.id)) ?? match;
  for (const player of persisted.players) {
    await getStore().setBitefightLaunch(player.discordUserId, persisted.id, now);
  }
  return persisted;
}

export function bitefightLeaderboardFrom(
  matches: BitefightRecord[],
  meDiscordUserId: string,
): BitefightLeaderboardEntry[] {
  const entries = new Map<
    string,
    Omit<BitefightLeaderboardEntry, "matches" | "winPct" | "me">
  >();
  for (const match of matches.sort((a, b) => a.createdAt - b.createdAt)) {
    if (match.status !== "finished") continue;
    for (const player of match.players) {
      const entry = entries.get(player.discordUserId) ?? {
        discordUserId: player.discordUserId,
        name: player.name,
        discordAvatarUrl: player.discordAvatarUrl,
        wins: 0,
        losses: 0,
        draws: 0,
      };
      entry.name = player.name;
      entry.discordAvatarUrl = player.discordAvatarUrl;
      if (!match.winnerDiscordUserId) entry.draws++;
      else if (match.winnerDiscordUserId === player.discordUserId) entry.wins++;
      else entry.losses++;
      entries.set(player.discordUserId, entry);
    }
  }
  return [...entries.values()]
    .map((entry) => {
      const matches = entry.wins + entry.losses + entry.draws;
      return {
        ...entry,
        matches,
        winPct: matches === 0 ? 0 : Math.round((entry.wins / matches) * 1000) / 10,
        me: entry.discordUserId === meDiscordUserId,
      };
    })
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        a.losses - b.losses ||
        b.winPct - a.winPct ||
        a.name.localeCompare(b.name),
    );
}
