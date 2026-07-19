"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client-api";
import { copyToClipboard } from "@/lib/clipboard";
import { megaShareText } from "@/lib/share-text";
import {
  MEGA_BOMB_COUNT,
  type BitesweeperPlayer,
  type MegaCellResult,
  type MegaGameState,
} from "@/lib/types";
import Board from "./Board";
import { HelpModal, LOSE_GIF, MadeByFooter, ResultModal, WIN_GIF } from "./modals";

type ModalKind = null | "help" | "result";
interface Toast { id: number; text: string }

const TILE_SHAKE_MS = 520;
const BOARD_EFFECT_MS = 1250;
const RESULT_MODAL_DELAY_MS = 1700;
const PLAYER_POLL_MS = 4_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

export default function BitesweeperGame() {
  const [state, setState] = useState<MegaGameState | null>(null);
  const [players, setPlayers] = useState<BitesweeperPlayer[]>([]);
  const [modal, setModal] = useState<ModalKind>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState(false);
  const [shakingIndex, setShakingIndex] = useState<number | null>(null);
  const [boardEffect, setBoardEffect] = useState<"bomb" | "check" | null>(null);
  const toastId = useRef(0);
  const introChecked = useRef(false);
  const boardEffectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultModalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const finished = state !== null && state.status !== "playing";

  const toast = useCallback((text: string) => {
    const id = ++toastId.current;
    setToasts((current) => [...current, { id, text }]);
    setTimeout(
      () => setToasts((current) => current.filter((item) => item.id !== id)),
      2400,
    );
  }, []);

  const refreshPlayers = useCallback(() => {
    return api.bitesweeperPlayers().then(
      ({ players: next }) => setPlayers(next),
      () => {},
    );
  }, []);

  const refresh = useCallback(() => {
    return api.megaState().then(
      (next) => {
        setState(next);
        void refreshPlayers();
        if (!introChecked.current) {
          introChecked.current = true;
          if (!localStorage.getItem("bitesweeper:seenHelp")) {
            localStorage.setItem("bitesweeper:seenHelp", "1");
            setModal("help");
          }
        }
      },
      (error) => toast(error instanceof Error ? error.message : "Couldn't reach the server"),
    );
  }, [refreshPlayers, toast]);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => void refreshPlayers(), PLAYER_POLL_MS);
    window.addEventListener("bitedle:discord-identity-synced", refresh);
    return () => {
      clearInterval(poll);
      window.removeEventListener("bitedle:discord-identity-synced", refresh);
      if (boardEffectTimer.current) clearTimeout(boardEffectTimer.current);
      if (resultModalTimer.current) clearTimeout(resultModalTimer.current);
    };
  }, [refresh, refreshPlayers]);

  useEffect(() => {
    for (const src of [WIN_GIF, LOSE_GIF]) {
      const image = new Image();
      image.src = src;
    }
  }, []);

  const finishBoard = (effect: "bomb" | "check") => {
    if (!reducedMotion) {
      setBoardEffect(effect);
      if (boardEffectTimer.current) clearTimeout(boardEffectTimer.current);
      boardEffectTimer.current = setTimeout(() => setBoardEffect(null), BOARD_EFFECT_MS);
    }
    if (resultModalTimer.current) clearTimeout(resultModalTimer.current);
    resultModalTimer.current = setTimeout(
      () => setModal("result"),
      reducedMotion ? 0 : RESULT_MODAL_DELAY_MS,
    );
  };

  const handleCell = async (index: number) => {
    if (!state || state.status !== "playing" || busy) return;
    setBusy(true);
    setBoardEffect(null);
    if (!reducedMotion) setShakingIndex(index);
    const startedAt = performance.now();
    try {
      const { state: next } = await api.megaClick(index);
      if (!reducedMotion) {
        const remaining = TILE_SHAKE_MS - (performance.now() - startedAt);
        if (remaining > 0) await wait(remaining);
      }
      setShakingIndex(null);
      setState(next);
      void refreshPlayers();
      if (next.status !== "playing") {
        finishBoard(next.status === "won" ? "check" : "bomb");
      }
    } catch (error) {
      setShakingIndex(null);
      setBoardEffect(null);
      if (error instanceof ApiError) {
        if (error.state) setState(error.state as MegaGameState);
        toast(error.message);
      } else {
        toast("Couldn't reach the server");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleFlag = async (index: number) => {
    if (!state || state.status !== "playing" || busy) return;
    if (state.clicks.some((click) => click.index === index)) return;
    const removing = state.flags.includes(index);
    if (!removing && state.flags.length >= MEGA_BOMB_COUNT) {
      toast("All 12 flags are placed — remove one first.");
      return;
    }
    const previous = state;
    const nextFlags = removing
      ? state.flags.filter((flaggedIndex) => flaggedIndex !== index)
      : [...state.flags, index];
    setState({ ...state, flags: nextFlags });
    setBusy(true);
    try {
      const next = await api.megaFlag(index);
      setState(next);
      void refreshPlayers();
      if (next.status === "won") finishBoard("check");
    } catch (error) {
      setState(previous);
      toast(error instanceof Error ? error.message : "Couldn't update the flag");
    } finally {
      setBusy(false);
    }
  };

  const handlePlayAgain = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    if (boardEffectTimer.current) clearTimeout(boardEffectTimer.current);
    if (resultModalTimer.current) clearTimeout(resultModalTimer.current);
    try {
      const next = await api.megaReplay();
      setState(next);
      setModal(null);
      setShakingIndex(null);
      setBoardEffect(null);
      void refreshPlayers();
      toast("Fresh Bitesweeper board ready");
    } catch (error) {
      if (error instanceof ApiError && error.state) {
        setState(error.state as MegaGameState);
      }
      toast(error instanceof Error ? error.message : "Couldn't start a new board");
    } finally {
      setBusy(false);
    }
  }, [busy, refreshPlayers, toast]);

  const handleShare = async () => {
    if (!state) return;
    const ok = await copyToClipboard(
      megaShareText({
        status: state.status,
        totalClicks: state.status === "won" ? state.score ?? state.clicks.length : state.clicks.length,
      }),
    );
    toast(ok ? "Results copied to clipboard" : "Couldn't copy to clipboard");
  };

  return (
    <div className="flex min-h-screen w-full flex-col items-center">
      <header className="border-tileborder w-full border-b">
        <div className="mx-auto grid h-14 w-full max-w-3xl grid-cols-[40px_1fr_40px] items-center px-4">
          <button
            type="button"
            onClick={() => setModal("help")}
            aria-label="How to play"
            className="text-muted hover:text-foreground cursor-pointer p-1.5"
          >
            <IconHelp />
          </button>
          <h1 className="text-center text-xl font-extrabold tracking-[0.1em] select-none">
            BITESWEEPER
          </h1>
          <div />
        </div>
      </header>

      <main className="flex w-full max-w-3xl flex-1 flex-col items-center gap-5 px-4 py-6">
        <div className="flex w-full max-w-[440px] items-center justify-center gap-2 text-xs">
          <span
            className="border-tileborder text-muted rounded border px-2 py-1 tabular-nums"
            title="Flags remaining"
          >
            🚩 {MEGA_BOMB_COUNT - (state?.flags.length ?? 0)}
          </span>
          <span className="border-tileborder text-muted rounded border px-2 py-1">
            💣 {MEGA_BOMB_COUNT} hidden
          </span>
          <span className="border-tileborder text-muted rounded border px-2 py-1 tabular-nums">
            Clicks: {state?.clicks.length ?? 0}
          </span>
        </div>

        <div className="flex w-full items-start justify-center gap-4">
          <PlayersPanel players={players} />
          <Board
            cols={10}
            clicks={state?.clicks ?? []}
            flags={state?.flags ?? []}
            layout={state?.layout ?? null}
            disabled={busy || finished || !state}
            shakingIndex={shakingIndex}
            effect={boardEffect}
            onCellClick={handleCell}
            onCellFlag={handleFlag}
          />
        </div>

        {finished && state && (
          <div className="animate-rise border-tileborder bg-raised flex w-full max-w-[440px] flex-col items-center gap-4 rounded-lg border p-4">
            <p className="text-center font-bold">
              {state.status === "won"
                ? state.score === 0
                  ? "You flagged every bomb without a single click! ✓"
                  : `You found it in ${state.score} ${state.score === 1 ? "click" : "clicks"}! ✓`
                : "💥 Boom! You hit a bomb."}
            </p>
            <div className="grid w-full max-w-72 grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handlePlayAgain}
                disabled={busy}
                className="bg-correct cursor-pointer rounded py-2 font-bold text-white hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
              >
                {busy ? "Starting..." : "Play again"}
              </button>
              <button
                type="button"
                onClick={handleShare}
                className="border-tileborder hover:border-tilehover cursor-pointer rounded border py-2 font-bold"
              >
                Share
              </button>
            </div>
          </div>
        )}

        <div className="w-full max-w-[440px]"><MadeByFooter /></div>
      </main>

      <div className="pointer-events-none fixed top-16 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((item) => (
          <div key={item.id} className="animate-pop bg-foreground text-surface rounded px-4 py-2 text-sm font-bold whitespace-nowrap shadow-lg">
            {item.text}
          </div>
        ))}
      </div>

      {modal === "result" && finished && state && (
        <ResultModal
          won={state.status === "won"}
          score={state.score}
          stats={null}
          guildEntries={null}
          onShare={handleShare}
          onContinue={() => setModal(null)}
          onPlayAgain={handlePlayAgain}
          busy={busy}
          mode="mega"
        />
      )}
      {modal === "help" && <HelpModal legacyBombRange={false} mode="mega" onClose={() => setModal(null)} />}
    </div>
  );
}

function PlayersPanel({ players }: { players: BitesweeperPlayer[] }) {
  return (
    <aside className="border-tileborder bg-raised scrollbar-slim hidden max-h-[440px] w-52 shrink-0 flex-col overflow-y-auto rounded-lg border p-3 sm:flex">
      <h2 className="text-muted mb-3 text-[11px] font-bold tracking-widest uppercase">
        Playing now
      </h2>
      {players.length === 0 ? (
        <p className="text-muted py-8 text-center text-xs leading-relaxed">
          Waiting for other players to join.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {players.map((player) => (
            <div key={player.name} className="border-tileborder border-b pb-3 last:border-0 last:pb-0">
              <div className="mb-2 flex items-center gap-2">
                {player.discordAvatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={player.discordAvatarUrl} alt="" className="h-6 w-6 rounded-full" />
                ) : (
                  <div className="bg-tile h-6 w-6 rounded-full" />
                )}
                <span className="min-w-0 flex-1 truncate text-xs font-bold">{player.name}</span>
                <span
                  className="text-muted text-[10px] tabular-nums"
                  title={`${player.flags.length} of ${MEGA_BOMB_COUNT} flags placed`}
                >
                  🚩 {player.flags.length}/{MEGA_BOMB_COUNT}
                </span>
              </div>
              <MiniBoard player={player} />
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

function MiniBoard({ player }: { player: BitesweeperPlayer }) {
  const clicked = new Map(player.clicks.map((click) => [click.index, click.result]));
  const flagged = new Set(player.flags);
  return (
    <div className="grid grid-cols-10 gap-px" aria-label={`${player.name}'s Bitesweeper board`}>
      {Array.from({ length: 100 }, (_, index) => {
        const result = clicked.get(index);
        const isFlagged = result === undefined && flagged.has(index);
        return (
          <span
            key={index}
            className={`flex aspect-square items-center justify-center rounded-[1px] text-[5px] ${miniCellClass(result)}`}
          >
            {isFlagged ? "🚩" : ""}
          </span>
        );
      })}
    </div>
  );
}

function miniCellClass(result: MegaCellResult | undefined): string {
  if (result === "bomb") return "bg-danger";
  if (result === "check") return "bg-correct";
  if (result === 0) return "bg-[#454548]";
  if (result === 1) return "bg-[#22627a]";
  if (result === 2) return "bg-[#538d4e]";
  if (result === 3) return "bg-[#806719]";
  if (result === 4) return "bg-[#7a2f2b]";
  if (result === 5) return "bg-[#8a4a1f]";
  if (result === 6) return "bg-[#94321f]";
  if (result === 7) return "bg-[#7c2447]";
  if (result === 8) return "bg-[#5b2a86]";
  return "bg-tileborder";
}

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
