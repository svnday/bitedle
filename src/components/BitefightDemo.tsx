"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BITEFIGHT_MAX_HEALTH, BITEFIGHT_PUNCH_DAMAGE } from "@/lib/bitefight-constants";
import type { BitefightPlayer, GameMode } from "@/lib/types";
import BitefightArena from "./BitefightArena";
import GameNav from "./GameNav";

type DemoStatus = "idle" | "countdown" | "fighting" | "finished";

function demoPlayer(id: string, name: string): BitefightPlayer {
  return {
    discordUserId: id,
    userId: null,
    name,
    discordAvatarUrl: null,
    readyAt: null,
    health: BITEFIGHT_MAX_HEALTH,
    punches: 0,
    lastSequence: 0,
    lastAcceptedAt: null,
  };
}

function freshPlayers(): [BitefightPlayer, BitefightPlayer] {
  return [
    demoPlayer("bitefight-demo-player", "You"),
    demoPlayer("bitefight-demo-bot", "Sparring Bot"),
  ];
}

export default function BitefightDemo({
  onModeChange,
}: {
  onModeChange: (mode: GameMode) => void;
}) {
  const [players, setPlayers] = useState<[BitefightPlayer, BitefightPlayer]>(freshPlayers);
  const [status, setStatus] = useState<DemoStatus>("idle");
  const [countdown, setCountdown] = useState(3);
  const [hitPlayerId, setHitPlayerId] = useState<string | null>(null);
  const hitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const animateHit = useCallback((targetId: string) => {
    setHitPlayerId(targetId);
    if (hitTimer.current) clearTimeout(hitTimer.current);
    hitTimer.current = setTimeout(() => setHitPlayerId(null), 150);
  }, []);

  useEffect(() => {
    return () => {
      if (hitTimer.current) clearTimeout(hitTimer.current);
    };
  }, []);

  useEffect(() => {
    if (status !== "countdown") return;
    const second = setTimeout(() => setCountdown(2), 1_000);
    const third = setTimeout(() => setCountdown(1), 2_000);
    const start = setTimeout(() => setStatus("fighting"), 3_000);
    return () => {
      clearTimeout(second);
      clearTimeout(third);
      clearTimeout(start);
    };
  }, [status]);

  useEffect(() => {
    if (status !== "fighting") return;
    if (players[0].health === 0 || players[1].health === 0) {
      const finish = setTimeout(() => setStatus("finished"), 0);
      return () => clearTimeout(finish);
    }
  }, [players, status]);

  useEffect(() => {
    if (status !== "fighting") return;
    const bot = setInterval(() => {
      animateHit("bitefight-demo-player");
      setPlayers((current) => {
        if (current[0].health === 0 || current[1].health === 0) return current;
        const next: [BitefightPlayer, BitefightPlayer] = [
          { ...current[0] },
          {
            ...current[1],
            punches: current[1].punches + 1,
            lastSequence: current[1].lastSequence + 1,
          },
        ];
        next[0].health = Math.max(0, next[0].health - BITEFIGHT_PUNCH_DAMAGE);
        return next;
      });
    }, 850);
    return () => clearInterval(bot);
  }, [animateHit, status]);

  const startDemo = () => {
    setPlayers(freshPlayers());
    setCountdown(3);
    setHitPlayerId(null);
    setStatus("countdown");
  };

  const punch = useCallback(() => {
    if (status !== "fighting" || players[0].health === 0 || players[1].health === 0) {
      return;
    }
    animateHit(players[1].discordUserId);
    setPlayers((current) => {
      if (current[0].health === 0 || current[1].health === 0) return current;
      const next: [BitefightPlayer, BitefightPlayer] = [
        {
          ...current[0],
          punches: current[0].punches + 1,
          lastSequence: current[0].lastSequence + 1,
        },
        { ...current[1] },
      ];
      next[1].health = Math.max(0, next[1].health - BITEFIGHT_PUNCH_DAMAGE);
      return next;
    });
  }, [animateHit, players, status]);

  const winnerId =
    status === "finished"
      ? players[0].health === players[1].health
        ? null
        : players[0].health > players[1].health
          ? players[0].discordUserId
          : players[1].discordUserId
      : null;

  return (
    <div className="flex min-h-screen flex-col">
      <GameNav mode="bitefight" onModeChange={onModeChange} />
      <main className="flex w-full flex-1 justify-center overflow-hidden px-3 py-5 sm:px-5">
        <div className="flex w-full max-w-3xl flex-col gap-4">
          <header className="text-center">
            <p className="text-xs font-black tracking-[0.32em] text-amber-400 uppercase">
              Website sparring demo
            </p>
            <h1 className="mt-1 text-3xl font-black tracking-[0.13em] sm:text-4xl">
              BITEFIGHT
            </h1>
            <p className="text-muted mx-auto mt-2 max-w-lg text-sm">
              Try the arena against a local bot. Discord 1v1s add challenges,
              ready-up, live previews, rematches, and the leaderboard.
            </p>
          </header>

          <BitefightArena
            players={players}
            meDiscordUserId={players[0].discordUserId}
            winnerDiscordUserId={winnerId}
            hitPlayerId={hitPlayerId}
            onPunch={status === "fighting" ? punch : undefined}
          />

          <section className="min-h-28 text-center">
            {status === "idle" && (
              <button
                type="button"
                onClick={startDemo}
                className="bg-correct hover:brightness-110 w-full max-w-sm cursor-pointer rounded-xl py-3 text-lg font-black text-white"
              >
                Start sparring
              </button>
            )}
            {status === "countdown" && (
              <div
                key={countdown}
                className="animate-pop motion-reduce:animate-none text-7xl font-black tabular-nums text-amber-400"
              >
                {countdown}
              </div>
            )}
            {status === "fighting" && (
              <>
                <button
                  type="button"
                  onClick={punch}
                  className="mx-auto block w-full max-w-md cursor-pointer touch-manipulation rounded-xl border border-amber-300 bg-amber-400 py-5 text-3xl font-black text-black shadow-[0_0_20px_rgb(251_191_36/0.28)] transition active:scale-[0.98] motion-reduce:transition-none"
                >
                  PUNCH
                </button>
                <p className="text-muted mt-2 text-xs">
                  Click the arena or press Punch. Every click or tap lands one hit.
                </p>
              </>
            )}
            {status === "finished" && (
              <div className="border-tileborder bg-raised rounded-xl border p-4">
                <h2 className="text-2xl font-black">
                  {winnerId === players[0].discordUserId
                    ? "You win! 🥊"
                    : winnerId === players[1].discordUserId
                      ? "Sparring Bot wins"
                      : "Draw!"}
                </h2>
                <p className="text-muted mt-1 text-sm">Demo knockout</p>
                <button
                  type="button"
                  onClick={startDemo}
                  className="border-tileborder hover:border-tilehover mt-3 cursor-pointer rounded border px-5 py-2 font-bold"
                >
                  Fight again
                </button>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
