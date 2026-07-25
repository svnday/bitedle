"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BITESHOOTER_LOBBY_TIMEOUT_MS,
  BITESHOOTER_MATCH_TIMEOUT_MS,
} from "@/lib/biteshooter-constants";
import type { BiteshooterZone } from "@/lib/biteshooter-targets";
import { api } from "@/lib/client-api";
import {
  getBiteshooterMatchId,
  setBiteshooterMatchId,
} from "@/lib/discord-context";
import type {
  BiteshooterLeaderboardEntry,
  BiteshooterState,
} from "@/lib/types";
import BiteshooterArena from "./BiteshooterArena";

function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function BiteshooterGame() {
  const initialMatchId = useMemo(() => getBiteshooterMatchId(), []);
  const [matchId, setMatchId] = useState(initialMatchId);
  const [match, setMatch] = useState<BiteshooterState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [observedAt, setObservedAt] = useState(0);
  const [shotPending, setShotPending] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"cancel" | "forfeit" | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboard, setLeaderboard] =
    useState<BiteshooterLeaderboardEntry[] | null>(null);
  const sequence = useRef(0);

  const applyMatch = useCallback((next: BiteshooterState) => {
    if (next.status === "finished" && next.rematchMatchId) {
      setBiteshooterMatchId(next.rematchMatchId);
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
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!matchId) return;
    try {
      applyMatch(await api.biteshooterState(matchId));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load the match");
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
    };
  }, [refresh]);

  useEffect(() => {
    if (!showLeaderboard) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowLeaderboard(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showLeaderboard]);

  const sendAim = useCallback(
    (
      _zone: BiteshooterZone,
      _damage: number,
      point: { x: number; y: number },
    ) => {
      if (
        !matchId ||
        !match ||
        match.status !== "fighting" ||
        shotPending ||
        showLeaderboard
      ) {
        return;
      }
      sequence.current += 1;
      setShotPending(true);
      void api
        .biteshooterAction(matchId, "aim", {
          sequence: sequence.current,
          targetIndex:
            match.players.find(
              (player) => player.discordUserId === match.meDiscordUserId,
            )?.targetIndex ?? 0,
          point,
        })
        .then((next) => {
          applyMatch(next);
          setError(null);
        })
        .catch((cause) => {
          setError(cause instanceof Error ? cause.message : "Shot missed the server");
        })
        .finally(() => setShotPending(false));
    },
    [applyMatch, match, matchId, shotPending, showLeaderboard],
  );

  const endMatch = (action: "cancel" | "forfeit") => {
    if (!match) return;
    setConfirmAction(null);
    void api
      .biteshooterAction(match.id, action)
      .then(applyMatch)
      .catch((cause) => {
        setError(
          cause instanceof Error
            ? cause.message
            : action === "cancel"
              ? "Couldn't cancel the match"
              : "Couldn't forfeit",
        );
      });
  };

  const openLeaderboard = async () => {
    setShowLeaderboard(true);
    setLeaderboard(null);
    try {
      setLeaderboard((await api.biteshooterLeaderboard()).entries);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load the leaderboard");
      setShowLeaderboard(false);
    }
  };

  if (!matchId) {
    return (
      <MatchMessage
        title="Match unavailable"
        text="Launch it again from the Biteshooter challenge card."
      />
    );
  }
  if (error && !match) return <MatchMessage title="Couldn't load Biteshooter" text={error} />;
  if (!match) return <MatchMessage title="Entering the range..." text="Connecting both players." />;

  const me = match.players.find(
    (player) => player.discordUserId === match.meDiscordUserId,
  )!;
  const opponent = match.players.find(
    (player) => player.discordUserId !== match.meDiscordUserId,
  )!;
  const estimatedServerNow = match.serverNow + Math.max(0, now - observedAt);
  const countdown =
    match.status === "countdown" && match.startedAt !== null
      ? Math.max(1, Math.ceil((match.startedAt - estimatedServerNow) / 1_000))
      : null;
  const timeRemaining =
    match.startedAt === null
      ? BITESHOOTER_MATCH_TIMEOUT_MS
      : Math.min(
          BITESHOOTER_MATCH_TIMEOUT_MS,
          Math.max(
            0,
            BITESHOOTER_MATCH_TIMEOUT_MS -
              ((match.finishedAt ?? estimatedServerNow) - match.startedAt),
          ),
        );
  const joinRemaining =
    match.status === "accepted" &&
    match.acceptedAt !== null &&
    match.players.some((player) => player.joinedAt === null)
      ? Math.max(
          0,
          BITESHOOTER_LOBBY_TIMEOUT_MS - (estimatedServerNow - match.acceptedAt),
        )
      : null;
  const winner = match.players.find(
    (player) => player.discordUserId === match.winnerDiscordUserId,
  );
  const accuracy = me.attempts === 0 ? 0 : Math.round((me.hits / me.attempts) * 100);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-3 px-3 py-4 sm:px-5">
      <header className="relative text-center">
        <p className="text-[10px] font-black tracking-[0.28em] text-amber-400 uppercase">
          Discord accuracy 1v1
        </p>
        <h1 className="text-2xl font-black tracking-[0.12em] sm:text-3xl">
          BITESHOOTER
        </h1>
        <button
          type="button"
          onClick={() => void openLeaderboard()}
          className="border-tileborder hover:border-tilehover absolute top-1/2 right-0 hidden -translate-y-1/2 cursor-pointer rounded border px-3 py-1.5 text-xs font-bold sm:block"
        >
          Leaderboard
        </button>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <PlayerHealth label={`${me.name} (you)`} health={me.health} color="bg-correct" />
        <PlayerHealth label={opponent.name} health={opponent.health} color="bg-danger" />
      </div>

      <div className="relative flex min-h-[340px] flex-1 sm:min-h-[440px]">
        <BiteshooterArena
          active={match.status === "fighting" && !shotPending && !showLeaderboard}
          showTarget={match.status === "fighting"}
          seed={match.seed}
          targetIndex={me.targetIndex}
          onAttempt={sendAim}
        />

        {match.status !== "fighting" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center p-4">
            {match.status === "accepted" && (
              <section className="border-tileborder bg-raised/95 pointer-events-auto w-full max-w-md rounded-2xl border p-5 text-center shadow-2xl backdrop-blur">
                {joinRemaining !== null ? (
                  <>
                    <h2 className="text-xl font-black">
                      Waiting for {opponent.joinedAt === null ? opponent.name : "the other player"}
                    </h2>
                    <p className="text-muted mt-2 text-sm">
                      This lobby cancels automatically if they do not join within one minute.
                    </p>
                    <div className="mt-3 text-3xl font-black tabular-nums text-amber-400">
                      {formatClock(joinRemaining)}
                    </div>
                  </>
                ) : me.readyAt === null ? (
                  <>
                    <h2 className="text-xl font-black">Both players joined</h2>
                    <p className="text-muted mt-2 text-sm">
                      Ready up. The match begins when both players are ready.
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        void api
                          .biteshooterAction(match.id, "ready")
                          .then(applyMatch)
                          .catch((cause) =>
                            setError(
                              cause instanceof Error
                                ? cause.message
                                : "Couldn't ready up",
                            ),
                          )
                      }
                      className="bg-correct mt-4 w-full cursor-pointer rounded-xl py-3 text-base font-black text-white"
                    >
                      Ready up
                    </button>
                  </>
                ) : (
                  <>
                    <h2 className="text-xl font-black">You&apos;re ready</h2>
                    <p className="text-muted mt-2 text-sm">
                      Waiting for {opponent.name} to ready up...
                    </p>
                  </>
                )}
              </section>
            )}
            {countdown !== null && (
              <div
                key={countdown}
                className="animate-pop motion-reduce:animate-none text-8xl font-black text-amber-400 drop-shadow-2xl"
              >
                {countdown}
              </div>
            )}
            {match.status === "finished" && (
              <section className="border-tileborder bg-raised/95 pointer-events-auto w-full max-w-lg rounded-2xl border p-5 text-center shadow-2xl backdrop-blur">
                <p className="text-xs font-black tracking-[0.2em] text-amber-400 uppercase">
                  Match complete
                </p>
                <h2 className="mt-1 text-3xl font-black">
                  {winner
                    ? winner.discordUserId === match.meDiscordUserId
                      ? "You win!"
                      : `${winner.name} wins`
                    : "Draw"}
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
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <ResultStat label="Accuracy" value={`${accuracy}%`} />
                  <ResultStat label="Bullseyes" value={String(me.innerHits)} />
                  <ResultStat label="Damage" value={String(me.totalDamage)} />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void api
                      .biteshooterAction(match.id, "rematch")
                      .then((next) => {
                        setBiteshooterMatchId(next.id);
                        setMatchId(next.id);
                        sequence.current = 0;
                        applyMatch(next);
                      })
                      .catch((cause) =>
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : "Couldn't start a rematch",
                        ),
                      )
                  }
                  className="border-tileborder hover:border-tilehover mt-4 cursor-pointer rounded-lg border px-6 py-2.5 font-black"
                >
                  Rematch
                </button>
              </section>
            )}
            {["cancelled", "declined", "expired"].includes(match.status) && (
              <section className="border-tileborder bg-raised/95 w-full max-w-md rounded-2xl border p-5 text-center shadow-2xl">
                <h2 className="text-xl font-black">Match {match.status}</h2>
                <p className="text-muted mt-2 text-sm">
                  Return to Discord and start a new challenge with /biteshooter.
                </p>
              </section>
            )}
          </div>
        )}
      </div>

      <div className="border-tileborder bg-raised grid grid-cols-6 gap-1 rounded-xl border p-2 text-center">
        <LiveStat label="Time" value={formatClock(timeRemaining)} />
        <LiveStat label="Accuracy" value={`${accuracy}%`} />
        <LiveStat label="Bullseyes" value={String(me.innerHits)} />
        <LiveStat label="Hits" value={String(me.hits)} />
        <LiveStat label="Misses" value={String(me.attempts - me.hits)} />
        <LiveStat label="Damage" value={String(me.totalDamage)} />
      </div>

      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => void openLeaderboard()}
          className="border-tileborder hover:border-tilehover cursor-pointer rounded border px-3 py-1.5 text-xs font-bold sm:hidden"
        >
          Leaderboard
        </button>
        {match.status === "accepted" && (
          <button
            type="button"
            onClick={() => setConfirmAction("cancel")}
            className="text-muted hover:text-danger cursor-pointer text-xs underline"
          >
            Cancel match
          </button>
        )}
        {["countdown", "fighting"].includes(match.status) && (
          <button
            type="button"
            onClick={() => setConfirmAction("forfeit")}
            className="text-muted hover:text-danger cursor-pointer text-xs underline"
          >
            Forfeit
          </button>
        )}
      </div>

      {confirmAction && (
        <div
          role="alert"
          className="border-tileborder bg-raised mx-auto flex w-full max-w-md items-center justify-between gap-3 rounded-lg border p-3"
        >
          <p className="text-sm font-bold">
            {confirmAction === "cancel"
              ? "Cancel this waiting match?"
              : "Forfeit and give your opponent the win?"}
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setConfirmAction(null)}
              className="border-tileborder cursor-pointer rounded border px-3 py-1.5 text-xs font-bold"
            >
              Go back
            </button>
            <button
              type="button"
              onClick={() => endMatch(confirmAction)}
              className="bg-danger cursor-pointer rounded px-3 py-1.5 text-xs font-black text-white"
            >
              {confirmAction === "cancel" ? "Cancel" : "Forfeit"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-danger text-center text-sm">{error}</p>}

      {showLeaderboard && (
        <BiteshooterLeaderboard
          entries={leaderboard}
          onClose={() => setShowLeaderboard(false)}
        />
      )}
    </main>
  );
}

function PlayerHealth({
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
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs font-black">
        <span className="truncate">{label}</span>
        <span className="shrink-0 tabular-nums">{health} HP</span>
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

function BiteshooterLeaderboard({
  entries,
  onClose,
}: {
  entries: BiteshooterLeaderboardEntry[] | null;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="biteshooter-leaderboard-title"
      className="bg-surface/90 fixed inset-0 z-50 grid place-items-center p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="border-tileborder bg-raised flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border shadow-2xl">
        <header className="border-tileborder flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 id="biteshooter-leaderboard-title" className="text-lg font-black">
              Biteshooter Leaderboard
            </h2>
            <p className="text-muted text-xs">Ranked by match wins</p>
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
            <p className="text-muted py-8 text-center text-sm">Loading...</p>
          ) : entries.length === 0 ? (
            <p className="text-muted py-8 text-center text-sm">No finished matches yet.</p>
          ) : (
            <ol className="space-y-2">
              {entries.map((entry, index) => (
                <li
                  key={entry.discordUserId}
                  className={`border-tileborder flex items-center gap-3 rounded-lg border p-3 ${
                    entry.me ? "bg-correct/10" : "bg-surface"
                  }`}
                >
                  <span className="text-muted w-6 text-center text-sm font-black">
                    {index + 1}
                  </span>
                  {entry.discordAvatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={entry.discordAvatarUrl}
                      alt=""
                      className="size-9 rounded-full object-cover"
                    />
                  ) : (
                    <span className="border-tileborder grid size-9 place-items-center rounded-full border font-bold">
                      {entry.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">
                      {entry.name}
                      {entry.me ? " (you)" : ""}
                    </div>
                    <div className="text-muted text-xs">
                      {entry.accuracy}% accuracy · {entry.bullseyes} bullseyes
                    </div>
                  </div>
                  <div className="text-right text-sm tabular-nums">
                    <div className="font-extrabold">
                      {entry.wins}W - {entry.losses}L
                    </div>
                    <div className="text-muted text-[10px]">
                      {entry.draws}D · {entry.matches} matches
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

function MatchMessage({ title, text }: { title: string; text: string }) {
  return (
    <main className="grid min-h-screen place-items-center px-5 text-center">
      <div>
        <h1 className="text-2xl font-black">{title}</h1>
        <p className="text-muted mt-2">{text}</p>
      </div>
    </main>
  );
}
