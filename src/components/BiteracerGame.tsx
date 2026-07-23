"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client-api";
import { copyToClipboard } from "@/lib/clipboard";
import { biteracerShareText } from "@/lib/share-text";
import type { BiteracerGameState, BiteracerUserStats, GameMode } from "@/lib/types";
import {
  BiteracerHelpModal,
  BiteracerLeaderboardModal,
  BiteracerStatsModal,
} from "./biteracer-modals";
import Countdown from "./Countdown";
import GameNav from "./GameNav";
import { MadeByFooter, NameModal } from "./modals";

type ModalKind = null | "help" | "stats" | "leaderboard" | "name";

interface Toast {
  id: number;
  text: string;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** The passage split into word chunks (each keeping its trailing space) so
 *  lines never break mid-word despite the per-character spans inside. */
function wordChunks(text: string): { chars: string[]; offset: number }[] {
  const chunks: { chars: string[]; offset: number }[] = [];
  let offset = 0;
  for (const word of text.split(/(?<= )/)) {
    chunks.push({ chars: word.split(""), offset });
    offset += word.length;
  }
  return chunks;
}

export default function BiteracerGame({
  onModeChange,
}: {
  onModeChange: (mode: GameMode) => void;
}) {
  const [state, setState] = useState<BiteracerGameState | null>(null);
  const [typed, setTyped] = useState("");
  const [modal, setModal] = useState<ModalKind>(null);
  const [nameMode, setNameMode] = useState<"post" | "edit">("edit");
  const [nameError, setNameError] = useState<string | null>(null);
  const [stats, setStats] = useState<BiteracerUserStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const introChecked = useRef(false);
  const startedRef = useRef(false);
  const startPromiseRef = useRef<Promise<BiteracerGameState> | null>(null);
  // Cosmetic local clock for the live WPM/timer readout — the server's own
  // started_at is what actually scores the run. Plain state (not a ref +
  // Date.now() in render) so the readout renders purely.
  const [clockStart, setClockStart] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const finished = state?.status === "finished";
  const passageText = state?.passage.text ?? "";

  const toast = useCallback((text: string) => {
    const id = ++toastId.current;
    setToasts((current) => [...current, { id, text }]);
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 2400);
  }, []);

  const refresh = useCallback(() => {
    return api.biteracerState().then(
      (next) => {
        setState(next);
        if (next.startedAt !== null && next.status === "playing") {
          startedRef.current = true;
          setClockStart(next.startedAt);
          setNowMs(Date.now());
        }
        if (!introChecked.current) {
          introChecked.current = true;
          if (!localStorage.getItem("biteracer:seenHelp")) {
            localStorage.setItem("biteracer:seenHelp", "1");
            setModal("help");
          }
        }
      },
      () => toast("Couldn't reach the server"),
    );
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Once/second re-render while a run is in progress, for the live readout.
  useEffect(() => {
    if (finished || clockStart === null) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [finished, clockStart]);

  // Keep keystrokes flowing to the hidden input while a run is active.
  useEffect(() => {
    if (state && !finished && modal === null) inputRef.current?.focus();
  }, [state, finished, modal]);

  const handleNewDay = useCallback(() => {
    startedRef.current = false;
    setClockStart(null);
    setNowMs(0);
    setTyped("");
    setModal(null);
    void refresh();
  }, [refresh]);

  const handleChange = async (value: string) => {
    if (!state || finished || busy || value.length > passageText.length) return;
    setTyped(value);
    if (!startedRef.current && value.length > 0) {
      startedRef.current = true;
      const now = Date.now();
      setClockStart(now);
      setNowMs(now);
      startPromiseRef.current = api.biteracerStart();
    }
    if (value.length === passageText.length) {
      setBusy(true);
      try {
        if (startPromiseRef.current) await startPromiseRef.current;
        const next = await api.biteracerFinish(value);
        setState(next);
        if (!next.named) {
          setNameError(null);
          setNameMode("post");
          setModal("name");
        }
      } catch (e) {
        if (e instanceof ApiError && e.state) setState(e.state as BiteracerGameState);
        toast(e instanceof Error ? e.message : "Couldn't submit your run");
      } finally {
        setBusy(false);
      }
    }
  };

  const handleShare = async () => {
    if (!state?.result) return;
    const ok = await copyToClipboard(
      biteracerShareText({
        passageNumber: state.passageNumber,
        netWpm: state.result.netWpm,
        accuracy: state.result.accuracy,
      }),
    );
    toast(ok ? "Results copied to clipboard" : "Couldn't copy to clipboard");
  };

  const openStats = useCallback(async () => {
    setModal("stats");
    setStats(null);
    try {
      setStats(await api.biteracerStats());
    } catch {
      toast("Couldn't load statistics");
    }
  }, [toast]);

  const handleName = async (name: string) => {
    try {
      const { username } = await api.setName(name);
      setState((s) => (s ? { ...s, username, named: true } : s));
      setNameError(null);
      // "post" flow: naming was the leaderboard invite — show it.
      setModal(nameMode === "post" ? "leaderboard" : null);
    } catch (e) {
      setNameError(e instanceof Error ? e.message : "Couldn't save that name");
    }
  };

  const liveElapsedMs = clockStart !== null ? nowMs - clockStart : 0;
  const liveWpm =
    liveElapsedMs > 800 ? Math.round((typed.length / 5 / (liveElapsedMs / 60_000)) * 10) / 10 : 0;

  return (
    <div className="flex min-h-screen w-full flex-col items-center">
      <header className="border-tileborder w-full border-b">
        <div className="mx-auto flex h-14 w-full max-w-lg items-center justify-between gap-2 px-4">
          <button
            type="button"
            onClick={() => setModal("help")}
            aria-label="How to play"
            className="text-muted hover:text-foreground cursor-pointer p-1.5"
          >
            <IconHelp />
          </button>
          <h1 className="text-2xl font-extrabold tracking-[0.2em] select-none">BITERACER</h1>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setModal("leaderboard")}
              aria-label="Leaderboard"
              className="text-muted hover:text-foreground cursor-pointer p-1.5"
            >
              <IconTrophy />
            </button>
            <button
              type="button"
              onClick={() => void openStats()}
              aria-label="Statistics"
              className="text-muted hover:text-foreground cursor-pointer p-1.5"
            >
              <IconChart />
            </button>
          </div>
        </div>
      </header>

      <GameNav mode="biteracer" onModeChange={onModeChange} />

      <main className="flex w-full max-w-lg flex-1 flex-col items-center gap-5 px-4 py-6">
        {state && (
          <>
            <div className="flex w-full items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="border-tileborder text-muted rounded border px-2 py-1">
                  Passage #{state.passageNumber}
                </span>
                <span
                  className="border-tileborder text-muted rounded border px-2 py-1 tabular-nums"
                  title="Live words per minute (unofficial — the server does the real timing)"
                >
                  {finished ? `${state.result?.netWpm ?? 0} wpm` : `${liveWpm} wpm`}
                </span>
                {!finished && (
                  <span className="border-tileborder text-muted rounded border px-2 py-1 tabular-nums">
                    {formatElapsed(liveElapsedMs)}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setNameError(null);
                  setNameMode("edit");
                  setModal("name");
                }}
                title="Change your display name"
                className="border-tileborder hover:border-tilehover flex max-w-28 cursor-pointer items-center gap-1 rounded border px-2 py-1 font-semibold"
              >
                <IconUser />
                <span className="truncate">{state.username}</span>
              </button>
            </div>

            <div className="w-full">
              <p className="text-muted mb-2 text-xs">
                {state.passage.book} — {state.passage.author}
              </p>
              {!finished ? (
                <>
                  {/* Clicking the passage refocuses the hidden input (needed on mobile). */}
                  <div
                    onClick={() => inputRef.current?.focus()}
                    className="border-tileborder bg-raised w-full cursor-text rounded-lg border p-4 font-mono text-base leading-relaxed select-none"
                  >
                    {wordChunks(passageText).map((chunk, w) => (
                      <span key={w} className="inline-block whitespace-pre">
                        {chunk.chars.map((ch, i) => {
                          const idx = chunk.offset + i;
                          const typedCh = typed[idx];
                          const cls =
                            typedCh === undefined
                              ? idx === typed.length
                                ? "border-foreground text-muted border-b-2"
                                : "text-muted"
                              : typedCh === ch
                                ? "text-foreground"
                                : "bg-danger/60 rounded-[2px] text-white";
                          return (
                            <span key={i} className={cls}>
                              {ch}
                            </span>
                          );
                        })}
                      </span>
                    ))}
                  </div>
                  <input
                    ref={inputRef}
                    value={typed}
                    onChange={(e) => void handleChange(e.target.value)}
                    onPaste={(e) => e.preventDefault()}
                    onDrop={(e) => e.preventDefault()}
                    spellCheck={false}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    maxLength={passageText.length}
                    disabled={busy}
                    aria-label="Type the passage shown above"
                    className="sr-only"
                  />
                  <p className="text-muted mt-2 text-center text-xs">
                    {typed.length === 0
                      ? "Start typing — the clock starts on your first keystroke."
                      : `${typed.length}/${passageText.length} characters`}
                  </p>
                </>
              ) : (
                <div className="animate-rise border-tileborder bg-raised flex w-full flex-col items-center gap-4 rounded-lg border p-4">
                  <div className="text-center">
                    <div className="text-4xl font-extrabold tabular-nums">
                      {state.result?.netWpm ?? 0}
                      <span className="text-muted ml-1 text-base font-semibold">WPM</span>
                    </div>
                    <p className="text-muted mt-1 text-sm tabular-nums">
                      {state.result?.accuracy ?? 0}% accuracy · raw {state.result?.rawWpm ?? 0} ·{" "}
                      {formatElapsed(state.result?.elapsedMs ?? 0)}
                    </p>
                  </div>
                  <div className="flex w-full items-center">
                    <div className="border-tileborder flex-1 border-r pr-3 text-center">
                      <div className="text-muted text-[10px] font-semibold tracking-widest uppercase">
                        Next Biteracer
                      </div>
                      <Countdown target={state.nextResetAt} onExpire={handleNewDay} />
                    </div>
                    <div className="flex flex-1 flex-col items-center gap-2 pl-3">
                      <button
                        type="button"
                        onClick={() => void handleShare()}
                        className="bg-correct w-full max-w-36 cursor-pointer rounded py-2 font-bold text-white hover:brightness-110"
                      >
                        Share 📋
                      </button>
                      <button
                        type="button"
                        onClick={() => setModal("leaderboard")}
                        className="border-tileborder hover:border-tilehover w-full max-w-36 cursor-pointer rounded border py-2 text-sm font-semibold"
                      >
                        Leaderboard
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
        <div className="w-full">
          <MadeByFooter />
        </div>
      </main>

      {toasts.length > 0 && (
        <div className="pointer-events-none fixed top-16 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="animate-pop bg-foreground text-surface rounded px-4 py-2 text-sm font-bold"
            >
              {t.text}
            </div>
          ))}
        </div>
      )}

      {modal === "help" && <BiteracerHelpModal onClose={() => setModal(null)} />}
      {modal === "leaderboard" && (
        <BiteracerLeaderboardModal
          onClose={() => setModal(null)}
          nameHint={finished && state !== null && !state.named}
        />
      )}
      {modal === "stats" && (
        <BiteracerStatsModal
          stats={stats}
          state={state}
          onClose={() => setModal(null)}
          onShare={() => void handleShare()}
          onNewDay={handleNewDay}
        />
      )}
      {modal === "name" && (
        <NameModal
          mode={nameMode}
          currentName={state?.username ?? "Player"}
          onSubmit={handleName}
          onClose={() => {
            setNameError(null);
            setModal(nameMode === "post" ? "leaderboard" : null);
          }}
          error={nameError}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- icons */

const iconProps = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function IconHelp() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.3 9.5a2.7 2.7 0 1 1 3.9 2.4c-.8.4-1.2 1-1.2 1.8" />
      <line x1="12" y1="16.8" x2="12" y2="16.81" />
    </svg>
  );
}

function IconChart() {
  return (
    <svg {...iconProps}>
      <line x1="5" y1="20" x2="5" y2="12" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="19" y1="20" x2="19" y2="9" />
    </svg>
  );
}

function IconTrophy() {
  return (
    <svg {...iconProps}>
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 4h10v7a5 5 0 0 1-10 0z" />
      <path d="M7 6H4v1a3 3 0 0 0 3 3" />
      <path d="M17 6h3v1a3 3 0 0 1-3 3" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg {...iconProps} width={14} height={14}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
    </svg>
  );
}
