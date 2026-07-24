"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import BitefightArena from "./BitefightArena";
import { getBitefightMatchId, setBitefightMatchId } from "@/lib/discord-context";
import { BITEFIGHT_TIMEOUT_MS } from "@/lib/bitefight-constants";
import type { BitefightLeaderboardEntry, BitefightState } from "@/lib/types";

function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function BitefightGame() {
  const initialMatchId = useMemo(() => getBitefightMatchId(), []);
  const [matchId, setMatchId] = useState(initialMatchId);
  const [match, setMatch] = useState<BitefightState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [hitPlayerId, setHitPlayerId] = useState<string | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboard, setLeaderboard] = useState<BitefightLeaderboardEntry[] | null>(null);
  const sequence = useRef(0);
  const [observedAt, setObservedAt] = useState(0);
  const hitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyMatch = useCallback((next: BitefightState) => {
    if (next.status === "finished" && next.rematchMatchId) {
      setBitefightMatchId(next.rematchMatchId);
      setMatchId(next.rematchMatchId);
      setMatch(null);
      sequence.current = 0;
      return;
    }
    const nextMe = next.players.find(
      (player) => player.discordUserId === next.meDiscordUserId,
    );
    if (nextMe) sequence.current = Math.max(sequence.current, nextMe.lastSequence);
    setObservedAt(Date.now());
    setMatch((current) => {
      if (current && next.revision < current.revision) return current;
      if (current) {
        const damaged = next.players.find((player, index) => player.health < current.players[index].health);
        if (damaged) {
          setHitPlayerId(damaged.discordUserId);
          if (hitTimer.current) clearTimeout(hitTimer.current);
          hitTimer.current = setTimeout(() => setHitPlayerId(null), 150);
        }
      }
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!matchId) return;
    try {
      applyMatch(await api.bitefightState(matchId));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load the fight");
    }
  }, [applyMatch, matchId]);

  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const polling = setInterval(() => void refresh(), 350);
    const clock = setInterval(() => setNow(Date.now()), 100);
    return () => {
      clearTimeout(initial);
      clearInterval(polling);
      clearInterval(clock);
      if (hitTimer.current) clearTimeout(hitTimer.current);
    };
  }, [refresh]);

  const sendPunch = useCallback(() => {
    if (!matchId || match?.status !== "fighting" || showLeaderboard) return;
    sequence.current += 1;
    void api
      .bitefightAction(matchId, "punch", { sequence: sequence.current })
      .then(applyMatch)
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : "Punch missed the server"),
      );
  }, [applyMatch, match?.status, matchId, showLeaderboard]);

  useEffect(() => {
    if (!showLeaderboard) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowLeaderboard(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showLeaderboard]);

  const openLeaderboard = async () => {
    setShowLeaderboard(true);
    setLeaderboard(null);
    try {
      setLeaderboard((await api.bitefightLeaderboard()).entries);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load the leaderboard");
      setShowLeaderboard(false);
    }
  };

  if (!matchId) {
    return <FightMessage title="Fight unavailable" text="Launch it again from the Bitefight challenge card." />;
  }
  if (error && !match) return <FightMessage title="Couldn't load Bitefight" text={error} />;
  if (!match) return <FightMessage title="Entering the ring…" text="Connecting both fighters." />;

  const me = match.players.find((player) => player.discordUserId === match.meDiscordUserId)!;
  const estimatedServerNow = match.serverNow + Math.max(0, now - observedAt);
  const countdown =
    match.status === "countdown" && match.startedAt !== null
      ? Math.max(1, Math.ceil((match.startedAt - estimatedServerNow) / 1_000))
      : null;
  const timeRemaining =
    match.status === "fighting" && match.startedAt !== null
      ? Math.max(0, BITEFIGHT_TIMEOUT_MS - (estimatedServerNow - match.startedAt))
      : BITEFIGHT_TIMEOUT_MS;
  const finished = match.status === "finished";
  const winner = match.players.find(
    (player) => player.discordUserId === match.winnerDiscordUserId,
  );

  return (
    <main className="flex min-h-screen w-full justify-center overflow-hidden px-3 py-5 sm:px-5">
      <div className="flex w-full max-w-3xl flex-col gap-4">
        <header className="relative text-center">
          <p className="text-xs font-black tracking-[0.32em] text-amber-400 uppercase">
            Discord 1v1
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-[0.13em] sm:text-4xl">BITEFIGHT</h1>
          <button
            type="button"
            onClick={() => void openLeaderboard()}
            className="border-tileborder hover:border-tilehover absolute top-1/2 right-0 hidden -translate-y-1/2 cursor-pointer rounded border px-3 py-1.5 text-xs font-bold sm:block"
          >
            Leaderboard
          </button>
        </header>

        <BitefightArena
          players={match.players}
          meDiscordUserId={match.meDiscordUserId}
          winnerDiscordUserId={match.winnerDiscordUserId}
          hitPlayerId={hitPlayerId}
          onPunch={match.status === "fighting" && !showLeaderboard ? sendPunch : undefined}
        />

        <section className="min-h-20 text-center">
          {match.status === "accepted" && me.readyAt === null && (
            <button
              type="button"
              onClick={() =>
                void api.bitefightAction(match.id, "ready").then(applyMatch).catch((cause) => {
                  setError(cause instanceof Error ? cause.message : "Couldn't ready up");
                })
              }
              className="bg-correct hover:brightness-110 w-full max-w-sm cursor-pointer rounded-xl py-3 text-lg font-black text-white"
            >
              Ready up
            </button>
          )}
          {match.status === "accepted" && me.readyAt !== null && (
            <p className="text-muted pt-3 text-sm">You&apos;re ready. Waiting for your opponent…</p>
          )}
          {countdown !== null && (
            <div key={countdown} className="animate-pop text-7xl font-black tabular-nums text-amber-400">
              {countdown}
            </div>
          )}
          {match.status === "fighting" && (
            <>
              <div className="mb-3 flex items-center justify-center gap-3 text-sm font-black">
                <span className="border-tileborder bg-raised rounded border px-3 py-1.5 tabular-nums">
                  {formatClock(timeRemaining)}
                </span>
              </div>
              <button
                type="button"
                onClick={sendPunch}
                className="mx-auto block w-full max-w-md cursor-pointer touch-manipulation rounded-xl border border-amber-300 bg-amber-400 py-5 text-3xl font-black text-black shadow-[0_0_20px_rgb(251_191_36/0.28)] transition active:scale-[0.98] motion-reduce:transition-none"
              >
                PUNCH
              </button>
              <p className="text-muted mt-2 text-xs">
                Click the arena or press Punch. Every click or tap lands one hit.
              </p>
            </>
          )}
          {finished && (
            <div className="border-tileborder bg-raised rounded-xl border p-4">
              <h2 className="text-2xl font-black">
                {winner
                  ? winner.discordUserId === match.meDiscordUserId
                    ? "You win! 🥊"
                    : `${winner.name} wins!`
                  : "Draw!"}
              </h2>
              <p className="text-muted mt-1 text-sm capitalize">
                {match.finishReason === "knockout"
                  ? "Knockout"
                  : match.finishReason === "forfeit"
                    ? "Won by forfeit"
                    : match.finishReason === "timeout"
                      ? "Time expired"
                      : "Equal health at the bell"}
              </p>
              <button
                type="button"
                onClick={() =>
                  void api.bitefightAction(match.id, "rematch").then((next) => {
                    setBitefightMatchId(next.id);
                    setMatchId(next.id);
                    sequence.current = 0;
                    applyMatch(next);
                  }).catch((cause) => {
                    setError(cause instanceof Error ? cause.message : "Couldn't start a rematch");
                  })
                }
                className="border-tileborder hover:border-tilehover mt-3 cursor-pointer rounded border px-5 py-2 font-bold"
              >
                Rematch
              </button>
            </div>
          )}
          {["cancelled", "declined", "expired"].includes(match.status) && (
            <div className="border-tileborder bg-raised rounded-xl border p-4">
              <h2 className="text-xl font-black">Fight {match.status}</h2>
              <p className="text-muted mt-1 text-sm">
                Return to Discord and start a new challenge with /bitefight.
              </p>
            </div>
          )}
        </section>

        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => void openLeaderboard()}
            className="border-tileborder hover:border-tilehover cursor-pointer rounded border px-3 py-1.5 text-xs font-bold sm:hidden"
          >
            Leaderboard
          </button>
          {["accepted", "countdown", "fighting"].includes(match.status) && (
            <button
              type="button"
              onClick={() => {
                if (!window.confirm("Forfeit this Bitefight?")) return;
                void api
                  .bitefightAction(match.id, "forfeit")
                  .then(applyMatch)
                  .catch((cause) => {
                    setError(cause instanceof Error ? cause.message : "Couldn't forfeit");
                  });
              }}
              className="text-muted hover:text-danger cursor-pointer text-xs underline"
            >
              Forfeit
            </button>
          )}
        </div>
        {error && <p className="text-danger text-center text-sm">{error}</p>}
      </div>

      {showLeaderboard && (
        <BitefightLeaderboard
          entries={leaderboard}
          onClose={() => setShowLeaderboard(false)}
        />
      )}
    </main>
  );
}

function BitefightLeaderboard({
  entries,
  onClose,
}: {
  entries: BitefightLeaderboardEntry[] | null;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bitefight-leaderboard-title"
      className="bg-surface/90 fixed inset-0 z-50 grid place-items-center p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="border-tileborder bg-raised flex max-h-[80vh] w-full max-w-md flex-col rounded-xl border shadow-2xl">
        <header className="border-tileborder flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 id="bitefight-leaderboard-title" className="text-lg font-black">
              Bitefight Leaderboard
            </h2>
            <p className="text-muted text-xs">Ranked by total wins</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close leaderboard"
            className="text-muted hover:text-foreground cursor-pointer p-2 text-xl"
          >
            ×
          </button>
        </header>
        <div className="overflow-y-auto p-3">
          {entries === null ? (
            <p className="text-muted py-8 text-center text-sm">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="text-muted py-8 text-center text-sm">No finished fights yet.</p>
          ) : (
            <ol className="space-y-2">
              {entries.map((entry, index) => (
                <li
                  key={entry.discordUserId}
                  className={`border-tileborder flex items-center gap-3 rounded-lg border p-3 ${
                    entry.me ? "bg-correct/10" : "bg-surface"
                  }`}
                >
                  <span className="text-muted w-6 text-center text-sm font-black tabular-nums">
                    {index + 1}
                  </span>
                  {entry.discordAvatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={entry.discordAvatarUrl} alt="" className="size-9 rounded-full object-cover" />
                  ) : (
                    <span className="border-tileborder grid size-9 place-items-center rounded-full border font-bold">
                      {entry.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">
                      {entry.name}{entry.me ? " (you)" : ""}
                    </div>
                    <div className="text-muted text-xs">{entry.winPct}% win rate</div>
                  </div>
                  <div className="text-right tabular-nums">
                    <div className="font-extrabold">{entry.wins}W – {entry.losses}L</div>
                    <div className="text-muted text-[10px]">
                      {entry.draws}D · {entry.matches} fights
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}

function FightMessage({ title, text }: { title: string; text: string }) {
  return (
    <main className="grid min-h-screen place-items-center px-5 text-center">
      <div>
        <h1 className="text-2xl font-black">{title}</h1>
        <p className="text-muted mt-2">{text}</p>
      </div>
    </main>
  );
}
