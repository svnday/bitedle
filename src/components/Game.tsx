"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client-api";
import { BOARD_SIZE, type CellResult, type GameState, type UserStats } from "@/lib/types";
import Board from "./Board";
import Countdown from "./Countdown";
import {
  HelpModal,
  LeaderboardModal,
  LOSE_GIF,
  NameModal,
  ResultModal,
  StatsModal,
  WIN_GIF,
} from "./modals";

type ModalKind = null | "help" | "stats" | "leaderboard" | "name" | "result";

interface Toast {
  id: number;
  text: string;
}

const SHARE_EMOJI: Record<CellResult, string> = { x: "❌", check: "✅", bomb: "💣" };

/** The player's board as an emoji grid — only their own clicks, no spoilers. */
function shareText(state: GameState): string {
  const cells = Array<string>(BOARD_SIZE).fill("⬛");
  for (const c of state.clicks) cells[c.index] = SHARE_EMOJI[c.result];
  const rows: string[] = [];
  for (let r = 0; r < BOARD_SIZE; r += 5) rows.push(cells.slice(r, r + 5).join(""));
  const scoreLine =
    state.status === "won"
      ? `${state.score} ${state.score === 1 ? "click" : "clicks"}`
      : "boom 💣";
  return `Bitedle #${state.puzzleNumber} · ${scoreLine}\n${rows.join("\n")}`;
}

export default function Game() {
  const [state, setState] = useState<GameState | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [nameMode, setNameMode] = useState<"post" | "edit">("edit");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const toastId = useRef(0);
  const introChecked = useRef(false);

  const toast = useCallback((text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2400);
  }, []);

  const refresh = useCallback(() => {
    return api.state().then(
      (s) => {
        setState(s);
        if (!introChecked.current) {
          introChecked.current = true;
          if (!localStorage.getItem("bitedle:seenHelp")) {
            localStorage.setItem("bitedle:seenHelp", "1");
            setModal("help");
          }
        }
      },
      () => {
        toast("Couldn't reach the server");
      },
    );
  }, [toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Fetch the result gifs up front so they play instantly when a game ends.
  useEffect(() => {
    for (const src of [WIN_GIF, LOSE_GIF]) {
      const img = new Image();
      img.src = src;
    }
  }, []);

  const openStats = useCallback(async () => {
    setModal("stats");
    setStats(null);
    try {
      setStats(await api.stats());
    } catch {
      toast("Couldn't load statistics");
    }
  }, [toast]);

  /** After the result splash: unnamed players pick a name, then stats. */
  const handleResultContinue = () => {
    if (state && !state.named) {
      setNameError(null);
      setNameMode("post");
      setModal("name");
    } else {
      openStats();
    }
  };

  const handleName = async (name: string) => {
    try {
      await api.setName(name);
      setNameError(null);
      await refresh();
      if (nameMode === "post") {
        openStats();
      } else {
        setModal(null);
      }
    } catch (e) {
      setNameError(e instanceof Error ? e.message : "Couldn't save the name");
    }
  };

  const handleCell = async (index: number) => {
    if (!state || state.status !== "playing" || busy) return;
    setBusy(true);
    try {
      const { state: next } = await api.click(index);
      setState(next);
      if (next.status !== "playing") {
        // Let the tile finish flipping before the result splash covers it.
        setTimeout(() => setModal("result"), 900);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.state) setState(e.state);
        toast(e.message);
      } else {
        toast("Couldn't reach the server");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleShare = () => {
    if (!state) return;
    navigator.clipboard
      .writeText(shareText(state))
      .then(() => toast("Results copied to clipboard"))
      .catch(() => toast("Couldn't copy to clipboard"));
  };

  const handleNewDay = useCallback(() => {
    setModal(null);
    refresh();
  }, [refresh]);

  const finished = state !== null && state.status !== "playing";

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
          <h1 className="text-2xl font-extrabold tracking-[0.2em] select-none">BITEDLE</h1>
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
              onClick={() => openStats()}
              aria-label="Statistics"
              className="text-muted hover:text-foreground cursor-pointer p-1.5"
            >
              <IconChart />
            </button>
          </div>
        </div>
      </header>

      <main className="flex w-full max-w-lg flex-1 flex-col items-center gap-5 px-4 py-6">
        <div className="flex w-full max-w-[360px] items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="border-tileborder text-muted rounded border px-2 py-1">
              Puzzle #{state?.puzzleNumber ?? "—"}
            </span>
            <span className="border-tileborder text-muted rounded border px-2 py-1">
              💣 3–5 hidden
            </span>
            <span className="border-tileborder text-muted rounded border px-2 py-1 tabular-nums">
              Clicks: {state?.clicks.length ?? 0}
            </span>
          </div>
          {state && (
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
          )}
        </div>

        <Board
          clicks={state?.clicks ?? []}
          layout={state?.layout ?? null}
          disabled={busy || finished || !state}
          onCellClick={handleCell}
        />

        {finished && state && (
          <div className="animate-rise border-tileborder bg-raised flex w-full max-w-[360px] flex-col items-center gap-4 rounded-lg border p-4">
            <p className="text-center font-bold">
              {state.status === "won"
                ? `You found it in ${state.score} ${state.score === 1 ? "click" : "clicks"}! ✓`
                : "💥 Boom! The check mark got away today."}
            </p>
            <div className="flex w-full items-center">
              <div className="border-tileborder flex-1 border-r pr-3 text-center">
                <div className="text-muted text-[10px] font-semibold tracking-widest uppercase">
                  Next Bitedle
                </div>
                <Countdown target={state.nextResetAt} onExpire={handleNewDay} />
              </div>
              <div className="flex flex-1 flex-col items-center gap-2 pl-3">
                <button
                  type="button"
                  onClick={handleShare}
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
      </main>

      <div className="pointer-events-none fixed top-16 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="animate-pop bg-foreground text-surface rounded px-4 py-2 text-sm font-bold whitespace-nowrap shadow-lg"
          >
            {t.text}
          </div>
        ))}
      </div>

      {modal === "result" && finished && state && (
        <ResultModal
          won={state.status === "won"}
          score={state.score}
          onContinue={handleResultContinue}
        />
      )}
      {modal === "name" && (
        <NameModal
          mode={nameMode}
          currentName={state?.username ?? "Player"}
          onSubmit={handleName}
          onClose={() => {
            setNameError(null);
            if (nameMode === "post") {
              openStats();
            } else {
              setModal(null);
            }
          }}
          error={nameError}
        />
      )}
      {modal === "help" && <HelpModal onClose={() => setModal(null)} />}
      {modal === "stats" && (
        <StatsModal
          stats={stats}
          state={state}
          onClose={() => setModal(null)}
          onShare={handleShare}
          onNewDay={handleNewDay}
        />
      )}
      {modal === "leaderboard" && (
        <LeaderboardModal
          onClose={() => setModal(null)}
          nameHint={finished && state !== null && !state.named}
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
