"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BITESHOOTER_BOT_INTERVAL_MS,
  BITESHOOTER_COUNTDOWN_MS,
  BITESHOOTER_MATCH_TIMEOUT_MS,
  BITESHOOTER_MAX_HEALTH,
} from "@/lib/biteshooter-constants";
import {
  clampBiteshooterHealth,
  damageForBiteshooterZone,
  seededUnit,
  type BiteshooterZone,
} from "@/lib/biteshooter-targets";
import type { GameMode } from "@/lib/types";
import BiteshooterArena from "./BiteshooterArena";
import GameNav from "./GameNav";

type DemoStatus = "idle" | "countdown" | "fighting" | "finished";
type Winner = "player" | "bot" | "draw" | null;

interface PracticeStats {
  attempts: number;
  hits: number;
  misses: number;
  innerHits: number;
  middleHits: number;
  outerHits: number;
  totalDamage: number;
  startedAt: number | null;
  finishedAt: number | null;
}

const EMPTY_STATS: PracticeStats = {
  attempts: 0,
  hits: 0,
  misses: 0,
  innerHits: 0,
  middleHits: 0,
  outerHits: 0,
  totalDamage: 0,
  startedAt: null,
  finishedAt: null,
};

function newSeed(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function botZoneFor(seed: string, attempt: number): BiteshooterZone {
  const roll = seededUnit(seed, `bot:${attempt}`);
  if (roll < 0.15) return "inner";
  if (roll < 0.5) return "middle";
  if (roll < 0.9) return "outer";
  return "miss";
}

function formatDuration(ms: number): string {
  return `${(Math.max(0, ms) / 1_000).toFixed(1)}s`;
}

export default function BiteshooterDemo({
  onModeChange,
}: {
  onModeChange: (mode: GameMode) => void;
}) {
  const [status, setStatus] = useState<DemoStatus>("idle");
  const [countdown, setCountdown] = useState(3);
  const [seed, setSeed] = useState("biteshooter-preview");
  const [targetIndex, setTargetIndex] = useState(0);
  const [playerHealth, setPlayerHealth] = useState(BITESHOOTER_MAX_HEALTH);
  const [botHealth, setBotHealth] = useState(BITESHOOTER_MAX_HEALTH);
  const [stats, setStats] = useState<PracticeStats>(EMPTY_STATS);
  const [winner, setWinner] = useState<Winner>(null);
  const [now, setNow] = useState(() => Date.now());
  const botAttempt = useRef(0);

  const finish = useCallback((result: Exclude<Winner, null>, at = Date.now()) => {
    setWinner(result);
    setStatus("finished");
    setStats((current) => ({
      ...current,
      finishedAt: current.finishedAt ?? at,
    }));
  }, []);

  const startMatch = () => {
    setSeed(newSeed());
    setTargetIndex(0);
    setPlayerHealth(BITESHOOTER_MAX_HEALTH);
    setBotHealth(BITESHOOTER_MAX_HEALTH);
    setStats(EMPTY_STATS);
    setWinner(null);
    setCountdown(3);
    setNow(Date.now());
    botAttempt.current = 0;
    setStatus("countdown");
  };

  useEffect(() => {
    if (status !== "countdown") return;
    const startedAt = Date.now() + BITESHOOTER_COUNTDOWN_MS;
    const second = setTimeout(() => setCountdown(2), 1_000);
    const third = setTimeout(() => setCountdown(1), 2_000);
    const start = setTimeout(() => {
      const now = Date.now();
      setStats((current) => ({ ...current, startedAt: now }));
      setNow(now);
      setStatus("fighting");
    }, Math.max(0, startedAt - Date.now()));
    return () => {
      clearTimeout(second);
      clearTimeout(third);
      clearTimeout(start);
    };
  }, [status]);

  useEffect(() => {
    if (status !== "fighting") return;
    const clock = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(clock);
  }, [status]);

  useEffect(() => {
    if (status !== "fighting" || stats.startedAt === null) return;
    const remaining = BITESHOOTER_MATCH_TIMEOUT_MS - (Date.now() - stats.startedAt);
    const timeout = setTimeout(() => {
      if (botHealth < playerHealth) finish("player");
      else if (playerHealth < botHealth) finish("bot");
      else finish("draw");
    }, Math.max(0, remaining));
    return () => clearTimeout(timeout);
  }, [botHealth, finish, playerHealth, stats.startedAt, status]);

  useEffect(() => {
    if (status !== "fighting") return;
    const bot = setInterval(() => {
      const zone = botZoneFor(seed, botAttempt.current);
      botAttempt.current += 1;
      const damage = damageForBiteshooterZone(zone);
      if (damage === 0) return;
      setPlayerHealth((current) => {
        const next = clampBiteshooterHealth(current, damage);
        if (next === 0) finish("bot");
        return next;
      });
    }, BITESHOOTER_BOT_INTERVAL_MS);
    return () => clearInterval(bot);
  }, [finish, seed, status]);

  const handleAttempt = useCallback(
    (zone: BiteshooterZone, damage: number) => {
      if (status !== "fighting") return;
      setStats((current) => ({
        ...current,
        attempts: current.attempts + 1,
        hits: current.hits + (damage > 0 ? 1 : 0),
        misses: current.misses + (damage === 0 ? 1 : 0),
        innerHits: current.innerHits + (zone === "inner" ? 1 : 0),
        middleHits: current.middleHits + (zone === "middle" ? 1 : 0),
        outerHits: current.outerHits + (zone === "outer" ? 1 : 0),
        totalDamage: current.totalDamage + damage,
      }));
      if (damage === 0) return;
      setTargetIndex((current) => current + 1);
      setBotHealth((current) => {
        const next = clampBiteshooterHealth(current, damage);
        if (next === 0) finish("player");
        return next;
      });
    },
    [finish, status],
  );

  const accuracy = stats.attempts === 0 ? 0 : Math.round((stats.hits / stats.attempts) * 100);
  const averageDamage = stats.hits === 0 ? 0 : stats.totalDamage / stats.hits;
  const elapsed =
    stats.startedAt === null
      ? 0
      : (stats.finishedAt ?? now) - stats.startedAt;
  const timeRemaining =
    status === "fighting"
      ? Math.max(0, BITESHOOTER_MATCH_TIMEOUT_MS - elapsed)
      : BITESHOOTER_MATCH_TIMEOUT_MS;
  const resultTitle = useMemo(() => {
    if (winner === "player") return "You win!";
    if (winner === "bot") return "Training bot wins";
    return "Draw";
  }, [winner]);

  return (
    <div className="flex min-h-screen flex-col">
      <GameNav mode="biteshooter" onModeChange={onModeChange} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-3 px-3 py-4 sm:px-5">
        <header className="flex flex-col items-center justify-between gap-2 text-center sm:flex-row sm:text-left">
          <div>
            <p className="text-[10px] font-black tracking-[0.28em] text-amber-400 uppercase">
              Website practice build
            </p>
            <h1 className="text-2xl font-black tracking-[0.12em] sm:text-3xl">
              BITESHOOTER
            </h1>
          </div>
          <p className="text-muted max-w-xl text-xs leading-relaxed sm:text-right">
            Test the aiming loop against a local bot. Discord challenges come
            after the target sizes, pace, and feedback feel right.
          </p>
        </header>

        <div className="grid grid-cols-2 gap-2">
          <HealthCard label="You" health={playerHealth} color="bg-correct" />
          <HealthCard label="Training bot" health={botHealth} color="bg-danger" />
        </div>

        <div className="relative flex min-h-[340px] flex-1 sm:min-h-[440px]">
          <BiteshooterArena
            active={status === "fighting"}
            seed={seed}
            targetIndex={targetIndex}
            onAttempt={handleAttempt}
          />

          {status !== "fighting" && (
            <div className="absolute inset-0 grid place-items-center p-4">
              {status === "idle" && (
                <section className="border-tileborder bg-raised/95 w-full max-w-md rounded-2xl border p-5 text-center shadow-2xl backdrop-blur">
                  <h2 className="text-xl font-black">Hit small. Hit hard.</h2>
                  <p className="text-muted mt-2 text-sm leading-relaxed">
                    Each hit moves the target. Bullseyes deal 3 HP, the middle
                    deals 2 HP, and the outer ring deals 1 HP. Misses deal zero
                    and leave the target in place.
                  </p>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-xs font-black">
                    <span className="rounded-lg bg-[#f7f3e8] px-2 py-2 text-black">3 HP</span>
                    <span className="rounded-lg bg-[#f0c94f] px-2 py-2 text-black">2 HP</span>
                    <span className="rounded-lg bg-[#d84b45] px-2 py-2 text-white">1 HP</span>
                  </div>
                  <button
                    type="button"
                    onClick={startMatch}
                    className="bg-correct mt-5 w-full cursor-pointer rounded-xl py-3 text-base font-black text-white hover:brightness-110"
                  >
                    Start practice match
                  </button>
                </section>
              )}
              {status === "countdown" && (
                <div
                  key={countdown}
                  className="animate-pop motion-reduce:animate-none text-8xl font-black text-amber-400 drop-shadow-2xl"
                >
                  {countdown}
                </div>
              )}
              {status === "finished" && (
                <section className="border-tileborder bg-raised/95 w-full max-w-lg rounded-2xl border p-5 text-center shadow-2xl backdrop-blur">
                  <p className="text-xs font-black tracking-[0.2em] text-amber-400 uppercase">
                    Practice complete
                  </p>
                  <h2 className="mt-1 text-3xl font-black">{resultTitle}</h2>
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <ResultStat label="Accuracy" value={`${accuracy}%`} />
                    <ResultStat label="Damage / hit" value={averageDamage.toFixed(2)} />
                    <ResultStat label="Bullseyes" value={String(stats.innerHits)} />
                    <ResultStat label="Time" value={formatDuration(elapsed)} />
                  </div>
                  <p className="text-muted mt-3 text-xs">
                    {stats.innerHits} inner · {stats.middleHits} middle · {stats.outerHits} outer ·{" "}
                    {stats.misses} misses
                  </p>
                  <button
                    type="button"
                    onClick={startMatch}
                    className="border-tileborder hover:border-tilehover mt-4 cursor-pointer rounded-lg border px-6 py-2.5 font-black"
                  >
                    Play again
                  </button>
                </section>
              )}
            </div>
          )}
        </div>

        <div className="border-tileborder bg-raised grid grid-cols-5 gap-1 rounded-xl border p-2 text-center">
          <LiveStat label="Time" value={`${Math.ceil(timeRemaining / 1_000)}s`} />
          <LiveStat label="Accuracy" value={`${accuracy}%`} />
          <LiveStat label="Bullseyes" value={String(stats.innerHits)} />
          <LiveStat label="Hits" value={String(stats.hits)} />
          <LiveStat label="Misses" value={String(stats.misses)} />
        </div>
      </main>
    </div>
  );
}

function HealthCard({
  label,
  health,
  color,
}: {
  label: string;
  health: number;
  color: string;
}) {
  return (
    <section className="border-tileborder bg-raised rounded-xl border p-2.5">
      <div className="mb-1.5 flex items-center justify-between text-xs font-black">
        <span>{label}</span>
        <span className="tabular-nums">{health} HP</span>
      </div>
      <div className="bg-tile h-2 overflow-hidden rounded-full">
        <div
          className={`h-full rounded-full transition-[width] duration-150 motion-reduce:transition-none ${color}`}
          style={{ width: `${health}%` }}
        />
      </div>
    </section>
  );
}

function LiveStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-xs font-black tabular-nums">{value}</div>
      <div className="text-muted truncate text-[9px] uppercase">{label}</div>
    </div>
  );
}

function ResultStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface rounded-lg p-2">
      <div className="text-lg font-black tabular-nums">{value}</div>
      <div className="text-muted text-[9px] font-bold uppercase">{label}</div>
    </div>
  );
}
