import { discordAvatarUrl } from "./discord";
import { getStore } from "./store";
import {
  BITESHOOTER_CANONICAL_OUTER_RADIUS,
  BITESHOOTER_CHALLENGE_TTL_MS,
  BITESHOOTER_COUNTDOWN_MS,
  BITESHOOTER_LOBBY_TIMEOUT_MS,
  BITESHOOTER_MATCH_TIMEOUT_MS,
  BITESHOOTER_MAX_HEALTH,
} from "./biteshooter-constants";
import {
  clampBiteshooterHealth,
  classifyBiteshooterHit,
  damageForBiteshooterZone,
  targetFor,
} from "./biteshooter-targets";
import type {
  BiteshooterLeaderboardEntry,
  BiteshooterPlayer,
  BiteshooterRecord,
  BiteshooterState,
} from "./types";

export {
  BITESHOOTER_CANONICAL_OUTER_RADIUS,
  BITESHOOTER_CHALLENGE_TTL_MS,
  BITESHOOTER_COUNTDOWN_MS,
  BITESHOOTER_LOBBY_TIMEOUT_MS,
  BITESHOOTER_MATCH_TIMEOUT_MS,
  BITESHOOTER_MAX_HEALTH,
} from "./biteshooter-constants";

const ACTIVE_STATUSES = new Set(["pending", "accepted", "countdown", "fighting"]);
const RELEASED_STATUSES = new Set(["declined", "cancelled", "expired"]);

async function clearReleasedLaunches(match: BiteshooterRecord): Promise<void> {
  if (!RELEASED_STATUSES.has(match.status)) return;
  await Promise.all(
    match.players.map((player) =>
      getStore().clearBiteshooterLaunch(player.discordUserId, match.id),
    ),
  );
}

export function biteshooterPlayer(input: {
  discordUserId: string;
  name: string;
  avatar: string | null;
}): BiteshooterPlayer {
  return {
    discordUserId: input.discordUserId,
    userId: null,
    name: input.name,
    discordAvatarUrl: discordAvatarUrl(input.discordUserId, input.avatar),
    joinedAt: null,
    readyAt: null,
    health: BITESHOOTER_MAX_HEALTH,
    targetIndex: 0,
    attempts: 0,
    hits: 0,
    innerHits: 0,
    middleHits: 0,
    outerHits: 0,
    totalDamage: 0,
    lastSequence: 0,
    lastAttemptAt: null,
  };
}

export async function hasActiveBiteshooter(discordUserId: string): Promise<boolean> {
  const candidates = (await getStore().allBiteshooters()).filter(
    (match) =>
      ACTIVE_STATUSES.has(match.status) &&
      match.players.some((player) => player.discordUserId === discordUserId),
  );
  for (const candidate of candidates) {
    const settled = await settleBiteshooter(candidate.id);
    if (ACTIVE_STATUSES.has(settled.status)) return true;
  }
  return false;
}

function advanceLifecycle(match: BiteshooterRecord, now: number): boolean {
  if (
    match.status === "pending" &&
    now - match.createdAt >= BITESHOOTER_CHALLENGE_TTL_MS
  ) {
    match.status = "expired";
    match.finishedAt = now;
    return true;
  }
  if (
    match.status === "accepted" &&
    match.acceptedAt !== null &&
    match.players.some((player) => player.joinedAt === null) &&
    now - match.acceptedAt >= BITESHOOTER_LOBBY_TIMEOUT_MS
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
    now - match.startedAt >= BITESHOOTER_MATCH_TIMEOUT_MS
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
  update: (match: BiteshooterRecord) => { changed: boolean; result: T },
): Promise<{ match: BiteshooterRecord; result: T }> {
  const store = getStore();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const current = await store.getBiteshooter(matchId);
    if (!current) throw new Error("Match not found");
    const expectedRevision = current.revision;
    const { changed, result } = update(current);
    if (!changed) return { match: current, result };
    current.revision = expectedRevision + 1;
    if (await store.compareAndSwapBiteshooter(current, expectedRevision)) {
      return { match: current, result };
    }
  }
  throw new Error("Match is busy - try again");
}

export async function settleBiteshooter(
  matchId: string,
  now = Date.now(),
): Promise<BiteshooterRecord> {
  const match = (
    await mutate(matchId, (match) => ({
      changed: advanceLifecycle(match, now),
      result: null,
    }))
  ).match;
  await clearReleasedLaunches(match);
  return match;
}

export async function biteshooterStateFor(
  matchId: string,
  discordUserId: string,
  userId: string,
  now = Date.now(),
): Promise<BiteshooterState | null> {
  const existing = await getStore().getBiteshooter(matchId);
  if (!existing?.players.some((player) => player.discordUserId === discordUserId)) return null;
  const { match } = await mutate(matchId, (current) => {
    let changed = advanceLifecycle(current, now);
    const player = current.players.find((entry) => entry.discordUserId === discordUserId)!;
    if (player.userId !== userId) {
      player.userId = userId;
      changed = true;
    }
    if (
      ["accepted", "countdown", "fighting"].includes(current.status) &&
      player.joinedAt === null
    ) {
      player.joinedAt = now;
      changed = true;
    }
    return { changed, result: null };
  });
  await clearReleasedLaunches(match);
  const player = match.players.find((entry) => entry.discordUserId === discordUserId)!;
  if (player.userId === userId) {
    const user = await getStore().getUser(userId);
    const avatar = user ? discordAvatarUrl(user.discordUserId, user.discordAvatar) : null;
    if (user && (player.name !== user.name || player.discordAvatarUrl !== avatar)) {
      const refreshed = await mutate(matchId, (current) => {
        const target = current.players.find(
          (entry) => entry.discordUserId === discordUserId,
        )!;
        target.name = user.name;
        target.discordAvatarUrl = avatar;
        return { changed: true, result: null };
      });
      return publicState(refreshed.match, discordUserId, now);
    }
  }
  return publicState(match, discordUserId, now);
}

function publicState(
  match: BiteshooterRecord,
  meDiscordUserId: string,
  serverNow: number,
): BiteshooterState {
  const { preview, ...publicMatch } = match;
  void preview;
  return { ...publicMatch, meDiscordUserId, serverNow };
}

export async function acceptBiteshooter(
  matchId: string,
  discordUserId: string,
  now = Date.now(),
): Promise<BiteshooterRecord> {
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
    await clearReleasedLaunches(result.match);
    throw new Error("This challenge cannot be accepted");
  }
  return result.match;
}

export async function declineBiteshooter(
  matchId: string,
  discordUserId: string,
  now = Date.now(),
): Promise<BiteshooterRecord> {
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
    await clearReleasedLaunches(result.match);
    throw new Error("This challenge cannot be declined");
  }
  await clearReleasedLaunches(result.match);
  return result.match;
}

export async function expireBiteshooter(
  matchId: string,
  now = Date.now(),
): Promise<BiteshooterRecord> {
  const match = (
    await mutate(matchId, (match) => {
      if (match.status !== "pending") return { changed: false, result: null };
      match.status = "expired";
      match.finishedAt = now;
      return { changed: true, result: null };
    })
  ).match;
  await clearReleasedLaunches(match);
  return match;
}

export async function readyBiteshooter(
  matchId: string,
  discordUserId: string,
  now = Date.now(),
): Promise<BiteshooterRecord> {
  return (
    await mutate(matchId, (match) => {
      const lifecycleChanged = advanceLifecycle(match, now);
      if (!["accepted", "countdown"].includes(match.status)) {
        if (lifecycleChanged) return { changed: true, result: null };
        throw new Error("Match is not ready");
      }
      const player = match.players.find((entry) => entry.discordUserId === discordUserId);
      if (!player) throw new Error("You are not in this match");
      let changed = false;
      if (player.joinedAt === null) {
        player.joinedAt = now;
        changed = true;
      }
      if (player.readyAt === null) {
        player.readyAt = now;
        changed = true;
      }
      if (match.status === "accepted" && match.players.every((entry) => entry.readyAt !== null)) {
        match.status = "countdown";
        match.countdownAt = now;
        match.startedAt = now + BITESHOOTER_COUNTDOWN_MS;
        changed = true;
      }
      return { changed, result: null };
    })
  ).match;
}

export async function aimBiteshooter(input: {
  matchId: string;
  discordUserId: string;
  sequence: number;
  targetIndex: number;
  point: { x: number; y: number };
  now?: number;
}): Promise<{ match: BiteshooterRecord; accepted: boolean; damage: number }> {
  const now = input.now ?? Date.now();
  const result = await mutate(input.matchId, (match) => {
    const lifecycleChanged = advanceLifecycle(match, now);
    if (match.status !== "fighting" || match.startedAt === null || now < match.startedAt) {
      if (lifecycleChanged) return { changed: true, result: { accepted: false, damage: 0 } };
      throw new Error("The match has not started");
    }
    const attackerIndex = match.players.findIndex(
      (entry) => entry.discordUserId === input.discordUserId,
    );
    if (attackerIndex < 0) throw new Error("You are not in this match");
    const attacker = match.players[attackerIndex];
    const opponent = match.players[attackerIndex === 0 ? 1 : 0];
    if (!Number.isSafeInteger(input.sequence) || input.sequence <= attacker.lastSequence) {
      return {
        changed: lifecycleChanged,
        result: { accepted: false, damage: 0 },
      };
    }
    if (!Number.isSafeInteger(input.targetIndex) || input.targetIndex !== attacker.targetIndex) {
      throw new Error("That target has moved");
    }
    if (
      !Number.isFinite(input.point.x) ||
      !Number.isFinite(input.point.y) ||
      input.point.x < -1 ||
      input.point.x > 2 ||
      input.point.y < -1 ||
      input.point.y > 2
    ) {
      throw new Error("Invalid aim point");
    }
    const target = targetFor(match.seed, attacker.targetIndex);
    const zone = classifyBiteshooterHit(
      Math.hypot(input.point.x - target.x, input.point.y - target.y),
      BITESHOOTER_CANONICAL_OUTER_RADIUS,
    );
    const damage = damageForBiteshooterZone(zone);
    attacker.lastSequence = input.sequence;
    attacker.lastAttemptAt = now;
    attacker.attempts += 1;
    if (damage > 0) {
      attacker.hits += 1;
      attacker.targetIndex += 1;
      attacker.totalDamage += damage;
      if (zone === "inner") attacker.innerHits += 1;
      else if (zone === "middle") attacker.middleHits += 1;
      else attacker.outerHits += 1;
      opponent.health = clampBiteshooterHealth(opponent.health, damage);
      if (opponent.health === 0) {
        match.status = "finished";
        match.finishedAt = now;
        match.winnerDiscordUserId = attacker.discordUserId;
        match.finishReason = "knockout";
      }
    }
    return { changed: true, result: { accepted: true, damage } };
  });
  return { match: result.match, ...result.result };
}

export async function cancelBiteshooter(
  matchId: string,
  discordUserId: string,
  now = Date.now(),
): Promise<BiteshooterRecord> {
  const match = (
    await mutate(matchId, (match) => {
      const lifecycleChanged = advanceLifecycle(match, now);
      if (match.status !== "accepted") {
        if (lifecycleChanged) return { changed: true, result: null };
        throw new Error("Match cannot be cancelled");
      }
      if (!match.players.some((player) => player.discordUserId === discordUserId)) {
        throw new Error("You are not in this match");
      }
      match.status = "cancelled";
      match.finishedAt = now;
      match.winnerDiscordUserId = null;
      match.finishReason = null;
      return { changed: true, result: null };
    })
  ).match;
  await clearReleasedLaunches(match);
  return match;
}

export async function forfeitBiteshooter(
  matchId: string,
  discordUserId: string,
  now = Date.now(),
): Promise<BiteshooterRecord> {
  return (
    await mutate(matchId, (match) => {
      const lifecycleChanged = advanceLifecycle(match, now);
      if (!["countdown", "fighting"].includes(match.status)) {
        if (lifecycleChanged) return { changed: true, result: null };
        throw new Error("Match cannot be forfeited");
      }
      const loserIndex = match.players.findIndex(
        (entry) => entry.discordUserId === discordUserId,
      );
      if (loserIndex < 0) throw new Error("You are not in this match");
      match.status = "finished";
      match.finishedAt = now;
      match.winnerDiscordUserId = match.players[loserIndex === 0 ? 1 : 0].discordUserId;
      match.finishReason = "forfeit";
      return { changed: true, result: null };
    })
  ).match;
}

export async function rematchBiteshooter(
  matchId: string,
  discordUserId: string,
  now = Date.now(),
): Promise<BiteshooterRecord> {
  const claimed = await mutate(matchId, (previous) => {
    if (
      previous.status !== "finished" ||
      !previous.players.some((player) => player.discordUserId === discordUserId)
    ) {
      throw new Error("Finish this match before a rematch");
    }
    if (previous.rematchMatchId) {
      return { changed: false, result: previous.rematchMatchId };
    }
    previous.rematchMatchId = crypto.randomUUID();
    return { changed: true, result: previous.rematchMatchId };
  });
  const previous = claimed.match;
  const existing = await getStore().getBiteshooter(claimed.result);
  const match: BiteshooterRecord = existing ?? {
    id: claimed.result,
    revision: 0,
    guildId: previous.guildId,
    channelId: previous.channelId,
    status: "accepted",
    seed: crypto.randomUUID(),
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
      const fresh = biteshooterPlayer({
        discordUserId: player.discordUserId,
        name: player.name,
        avatar: null,
      });
      fresh.userId = player.userId;
      fresh.discordAvatarUrl = player.discordAvatarUrl;
      return fresh;
    }) as [BiteshooterPlayer, BiteshooterPlayer],
  };
  if (!existing) {
    const created = await getStore().createBiteshooterIfPlayersAvailable(match);
    const concurrent = await getStore().getBiteshooter(match.id);
    if (!created && !concurrent) {
      await mutate(previous.id, (current) => {
        if (current.rematchMatchId !== match.id) {
          return { changed: false, result: null };
        }
        current.rematchMatchId = null;
        return { changed: true, result: null };
      });
      throw new Error("One of you is already in another Biteshooter match");
    }
  }
  const persisted = (await getStore().getBiteshooter(match.id)) ?? match;
  for (const player of persisted.players) {
    await getStore().clearBitefightLaunch(player.discordUserId);
    await getStore().clearBiteracerRaceLaunch(player.discordUserId);
    await getStore().setBiteshooterLaunch(player.discordUserId, persisted.id, now);
  }
  return persisted;
}

export function biteshooterLeaderboardFrom(
  matches: BiteshooterRecord[],
  meDiscordUserId: string,
): BiteshooterLeaderboardEntry[] {
  const entries = new Map<
    string,
    Omit<
      BiteshooterLeaderboardEntry,
      "matches" | "accuracy" | "averageDamagePerHit" | "me"
    > & { attempts: number; hits: number; totalDamage: number }
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
        bullseyes: 0,
        attempts: 0,
        hits: 0,
        totalDamage: 0,
      };
      entry.name = player.name;
      entry.discordAvatarUrl = player.discordAvatarUrl;
      entry.bullseyes += player.innerHits;
      entry.attempts += player.attempts;
      entry.hits += player.hits;
      entry.totalDamage += player.totalDamage;
      if (!match.winnerDiscordUserId) entry.draws += 1;
      else if (match.winnerDiscordUserId === player.discordUserId) entry.wins += 1;
      else entry.losses += 1;
      entries.set(player.discordUserId, entry);
    }
  }
  return [...entries.values()]
    .map(({ attempts, hits, totalDamage, ...entry }) => ({
      ...entry,
      matches: entry.wins + entry.losses + entry.draws,
      accuracy: attempts === 0 ? 0 : Math.round((hits / attempts) * 1000) / 10,
      averageDamagePerHit:
        hits === 0 ? 0 : Math.round((totalDamage / hits) * 100) / 100,
      me: entry.discordUserId === meDiscordUserId,
    }))
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        a.losses - b.losses ||
        b.accuracy - a.accuracy ||
        a.name.localeCompare(b.name),
    );
}
