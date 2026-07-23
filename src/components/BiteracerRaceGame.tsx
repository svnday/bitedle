"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { getBiteracerRaceId, setBiteracerRaceId } from "@/lib/discord-context";
import type {
  BiteracerRaceLeaderboardEntry,
  BiteracerRacePlayer,
  BiteracerRaceState,
} from "@/lib/types";

function wordChunks(text: string): { text: string; offset: number }[] {
  let offset = 0;
  return text.split(/(?<= )/).map((text) => {
    const chunk = { text, offset };
    offset += text.length;
    return chunk;
  });
}

function formatElapsed(ms: number): string {
  const tenths = Math.max(0, Math.floor(ms / 100));
  return `${Math.floor(tenths / 600)}:${String(Math.floor((tenths % 600) / 10)).padStart(2, "0")}.${tenths % 10}`;
}

function RacerLane({
  player,
  winner,
}: {
  player: BiteracerRacePlayer;
  winner: boolean;
}) {
  const pct = Math.max(0, Math.min(100, player.progress * 100));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate font-bold">{player.name}</span>
        <span className="text-muted tabular-nums">
          {player.result ? `${player.result.netWpm} WPM` : `${Math.round(pct)}%`}
        </span>
      </div>
      <div className="border-tileborder bg-surface relative h-12 overflow-hidden rounded-full border">
        <div className="bg-correct/20 absolute top-1/2 left-5 right-5 h-1 -translate-y-1/2 rounded" />
        <span className="absolute top-1/2 right-2 -translate-y-1/2 text-xl" aria-hidden>
          🏁
        </span>
        <div
          className="absolute top-1/2 size-9 -translate-y-1/2 transition-[left] duration-200 ease-out"
          style={{ left: `calc(0.35rem + ${pct} * (100% - 3.4rem) / 100)` }}
        >
          {player.discordAvatarUrl ? (
            // Discord CDN is intentionally rendered directly; Next image
            // optimization is unnecessary for these tiny, rapidly loaded avatars.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={player.discordAvatarUrl}
              alt=""
              className={`size-9 rounded-full border-2 object-cover shadow ${winner ? "border-correct" : "border-tileborder"}`}
            />
          ) : (
            <div className="border-tileborder bg-raised grid size-9 place-items-center rounded-full border-2">
              {player.name.slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BiteracerRaceGame() {
  const initialRaceId = useMemo(() => getBiteracerRaceId(), []);
  const [raceId, setRaceId] = useState(initialRaceId);
  const [race, setRace] = useState<BiteracerRaceState | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<BiteracerRaceLeaderboardEntry[] | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [now, setNow] = useState(0);
  const sequence = useRef(0);
  const lastSentAt = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!raceId) return;
    try {
      setRace(await api.biteracerRaceState(raceId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the race");
    }
  }, [raceId]);

  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const polling = setInterval(() => void refresh(), 400);
    const clock = setInterval(() => setNow(Date.now()), 100);
    return () => {
      clearTimeout(initial);
      clearInterval(polling);
      clearInterval(clock);
    };
  }, [refresh]);

  useEffect(() => {
    if (race?.status === "racing") inputRef.current?.focus();
  }, [race?.status]);

  if (!raceId) return <RaceMessage title="Race unavailable" text="Launch it again from the challenge card." />;
  if (error && !race) return <RaceMessage title="Couldn't load Biteracer" text={error} />;
  if (!race) return <RaceMessage title="Loading race…" text="Connecting both racers." />;

  const me = race.players.find((player) => player.discordUserId === race.meDiscordUserId)!;
  const bothReady = race.players.every((player) => player.readyAt !== null);
  const countdown =
    race.startedAt !== null && race.status === "countdown"
      ? Math.max(1, Math.ceil((race.startedAt - now) / 1000))
      : null;
  const running = race.status === "racing";
  const finished = race.status === "finished";
  const elapsedMs = running && race.startedAt ? Math.max(0, now - race.startedAt) : 0;
  const correctTyped = typed.split("").filter((char, index) => char === race.passage.text[index]).length;
  const liveWpm =
    elapsedMs >= 500 ? Math.round((correctTyped / 5 / (elapsedMs / 60_000)) * 10) / 10 : 0;

  const sendProgress = (value: string) => {
    const sentAt = Date.now();
    if (sentAt - lastSentAt.current < 250 && value !== race.passage.text) return;
    lastSentAt.current = sentAt;
    sequence.current++;
    void api
      .biteracerRaceAction(race.id, "progress", { typed: value, sequence: sequence.current })
      .then(setRace)
      .catch(() => {});
  };

  const changeTyped = (value: string) => {
    if (!running || me.finishedAt !== null || value.length > race.passage.text.length) return;
    setTyped(value);
    sendProgress(value);
    if (value === race.passage.text) {
      void api
        .biteracerRaceAction(race.id, "finish", { typed: value })
        .then(setRace)
        .catch((e) => setError(e instanceof Error ? e.message : "Couldn't finish"));
    }
  };

  const openLeaderboard = async () => {
    setShowLeaderboard(true);
    setLeaderboard(null);
    try {
      const result = await api.biteracerRaceLeaderboard();
      setLeaderboard(result.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the leaderboard");
      setShowLeaderboard(false);
    }
  };

  return (
    <main className="flex min-h-screen w-full justify-center px-4 py-6">
      <div className="flex w-full max-w-2xl flex-col gap-5">
        <header className="relative text-center">
          <p className="text-correct text-xs font-bold tracking-[0.3em] uppercase">Discord 1v1</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-[0.14em]">BITERACER</h1>
          <button
            type="button"
            onClick={() => void openLeaderboard()}
            className="border-tileborder hover:border-tilehover absolute top-1/2 right-0 -translate-y-1/2 cursor-pointer rounded border px-3 py-1.5 text-xs font-bold"
          >
            Leaderboard
          </button>
        </header>

        <section className="border-tileborder bg-raised space-y-4 rounded-xl border p-4">
          {race.players.map((player) => (
            <RacerLane
              key={player.discordUserId}
              player={player}
              winner={race.winnerDiscordUserId === player.discordUserId}
            />
          ))}
        </section>

        {!me.readyAt && race.status === "accepted" && (
          <button
            type="button"
            onClick={() => void api.biteracerRaceAction(race.id, "ready").then(setRace)}
            className="bg-correct cursor-pointer rounded-lg py-3 text-lg font-extrabold text-white hover:brightness-110"
          >
            Ready up
          </button>
        )}
        {me.readyAt && !bothReady && (
          <p className="text-muted text-center text-sm">You&apos;re ready. Waiting for your rival…</p>
        )}
        {countdown !== null && (
          <div className="animate-pop text-center text-7xl font-black tabular-nums">{countdown}</div>
        )}

        {(running || finished) && (
          <section>
            {running && (
              <div className="mb-3 flex justify-center gap-3 text-sm font-bold tabular-nums">
                <span className="border-tileborder bg-raised rounded border px-3 py-1.5">
                  {formatElapsed(elapsedMs)}
                </span>
                <span className="border-tileborder bg-raised rounded border px-3 py-1.5">
                  {liveWpm} WPM
                </span>
              </div>
            )}
            <p className="text-muted mb-2 text-xs">
              {race.passage.book} — {race.passage.author}
            </p>
            <div
              onClick={() => inputRef.current?.focus()}
              className="border-tileborder bg-raised rounded-xl border p-4 font-mono text-base leading-relaxed"
            >
              {wordChunks(race.passage.text).map((chunk) => (
                <span key={chunk.offset} className="inline-block whitespace-pre">
                  {chunk.text.split("").map((char, index) => {
                    const at = chunk.offset + index;
                    const actual = typed[at];
                    return (
                      <span
                        key={at}
                        className={
                          actual === undefined
                            ? at === typed.length && running
                              ? "border-foreground text-muted border-b-2"
                              : "text-muted"
                            : actual === char
                              ? "text-foreground"
                              : "bg-danger/60 rounded-[2px] text-white"
                        }
                      >
                        {char}
                      </span>
                    );
                  })}
                </span>
              ))}
            </div>
            <input
              ref={inputRef}
              value={typed}
              onChange={(event) => changeTyped(event.target.value)}
              onPaste={(event) => event.preventDefault()}
              onDrop={(event) => event.preventDefault()}
              disabled={!running || me.finishedAt !== null}
              aria-label="Type the race passage"
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              className="sr-only"
            />
          </section>
        )}

        {me.finishedAt !== null && !finished && (
          <p className="text-muted text-center text-sm">Finished! Waiting for your rival…</p>
        )}
        {finished && (
          <section className="border-tileborder bg-raised rounded-xl border p-5 text-center">
            <div className="text-3xl font-extrabold">
              {race.winnerDiscordUserId
                ? race.winnerDiscordUserId === race.meDiscordUserId
                  ? "You win! 🏁"
                  : `${race.players.find((player) => player.discordUserId === race.winnerDiscordUserId)?.name} wins!`
                : "Race over"}
            </div>
            <div className="text-muted mt-3 flex justify-center gap-5 text-sm">
              {race.players.map((player) => (
                <span key={player.discordUserId}>
                  {player.name}: {player.result?.netWpm ?? "DNF"} WPM
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                void api.biteracerRaceAction(race.id, "rematch").then((next) => {
                  setBiteracerRaceId(next.id);
                  setRaceId(next.id);
                  setRace(next);
                  setTyped("");
                  sequence.current = 0;
                })
              }
              className="border-tileborder hover:border-tilehover mt-4 cursor-pointer rounded border px-5 py-2 font-bold"
            >
              Rematch
            </button>
          </section>
        )}
        {error && <p className="text-danger text-center text-sm">{error}</p>}
      </div>
      {showLeaderboard && (
        <RaceLeaderboard
          entries={leaderboard}
          onClose={() => setShowLeaderboard(false)}
        />
      )}
    </main>
  );
}

function RaceLeaderboard({
  entries,
  onClose,
}: {
  entries: BiteracerRaceLeaderboardEntry[] | null;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="race-leaderboard-title"
      className="bg-surface/90 fixed inset-0 z-50 grid place-items-center p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="border-tileborder bg-raised flex max-h-[80vh] w-full max-w-md flex-col rounded-xl border shadow-2xl">
        <header className="border-tileborder flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 id="race-leaderboard-title" className="text-lg font-extrabold">
              1v1 Leaderboard
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
            <p className="text-muted py-8 text-center text-sm">No finished races yet.</p>
          ) : (
            <ol className="space-y-2">
              {entries.map((entry, index) => (
                <li
                  key={entry.discordUserId}
                  className={`border-tileborder flex items-center gap-3 rounded-lg border p-3 ${entry.me ? "bg-correct/10" : "bg-surface"}`}
                >
                  <span className="text-muted w-6 text-center text-sm font-black tabular-nums">
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
                    <div className="text-muted text-xs">{entry.winPct}% win rate</div>
                  </div>
                  <div className="text-right tabular-nums">
                    <div className="font-extrabold">
                      {entry.wins}W – {entry.losses}L
                    </div>
                    <div className="text-muted text-[10px]">{entry.races} races</div>
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

function RaceMessage({ title, text }: { title: string; text: string }) {
  return (
    <main className="grid min-h-screen place-items-center px-5 text-center">
      <div>
        <h1 className="text-2xl font-extrabold">{title}</h1>
        <p className="text-muted mt-2">{text}</p>
      </div>
    </main>
  );
}
