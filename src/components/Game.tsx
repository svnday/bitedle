"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client-api";
import { copyToClipboard } from "@/lib/clipboard";
import { isDiscordEmbed } from "@/lib/discord-context";
import { megaShareText, shareText } from "@/lib/share-text";
import {
  DISTRIBUTION_BUCKETS,
  FIXED_BOMB_COUNT_FROM,
  MEGA_BOMB_COUNT,
  type GameMode,
  type GameState,
  type MegaGameState,
  type TodayEntry,
  type UserStats,
} from "@/lib/types";
import Board from "./Board";
import Countdown from "./Countdown";
import {
  ChannelStatsScreen,
  HelpModal,
  LeaderboardModal,
  LOSE_GIF,
  MadeByFooter,
  NameModal,
  PlayerResultCard,
  ResultModal,
  StatsModal,
  WelcomeBackScreen,
  WIN_GIF,
} from "./modals";

type ModalKind =
  | null
  | "help"
  | "stats"
  | "leaderboard"
  | "name"
  | "result"
  | "channelStats"
  | "welcomeBack";

interface Toast {
  id: number;
  text: string;
}

const TILE_SHAKE_MS = 520;
const BOARD_EFFECT_MS = 1250;
const RESULT_MODAL_DELAY_MS = 1700;

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

function gameShareText(state: GameState | MegaGameState, mode: GameMode): string {
  if (mode === "mega") {
    return megaShareText({
      status: state.status,
      totalClicks: state.status === "won" ? state.score ?? state.clicks.length : state.clicks.length,
    });
  }
  const classicState = state as GameState;
  const misses = classicState.clicks.filter((c) => c.result === "x").length;
  return shareText({
    puzzleNumber: classicState.puzzleNumber,
    status: classicState.status,
    score: classicState.score,
    misses,
  });
}

export default function Game({
  mode = "classic",
  onModeChange,
}: {
  mode?: GameMode;
  onModeChange?: (mode: GameMode) => void;
}) {
  const [state, setState] = useState<GameState | MegaGameState | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [channelStats, setChannelStats] = useState<UserStats | null>(null);
  const [guildEntries, setGuildEntries] = useState<TodayEntry[] | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [nameMode, setNameMode] = useState<"post" | "edit">("edit");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [shakingIndex, setShakingIndex] = useState<number | null>(null);
  const [boardEffect, setBoardEffect] = useState<"bomb" | "check" | null>(null);
  const toastId = useRef(0);
  const introChecked = useRef(false);
  const boardEffectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultModalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const finished = state !== null && state.status !== "playing";

  useEffect(() => {
    return () => {
      if (boardEffectTimer.current) clearTimeout(boardEffectTimer.current);
      if (resultModalTimer.current) clearTimeout(resultModalTimer.current);
    };
  }, []);

  const toast = useCallback((text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2400);
  }, []);

  const refresh = useCallback(() => {
    const request = mode === "mega" ? api.megaState : api.state;
    return request().then(
      (s) => {
        setState(s);
        if (!introChecked.current) {
          introChecked.current = true;
          const helpKey = mode === "mega" ? "bitedle:seenHelpMega" : "bitedle:seenHelp";
          if (!localStorage.getItem(helpKey)) {
            localStorage.setItem(helpKey, "1");
            setModal("help");
          } else if (mode === "classic" && isDiscordEmbed() && s.status !== "playing") {
            // Relaunching the Activity after already finishing today.
            setModal("welcomeBack");
          }
        }
      },
      (e) => {
        toast(e instanceof Error ? e.message : "Couldn't reach the server");
      },
    );
  }, [mode, toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // DiscordBootstrap links the Discord identity (and syncs the display name)
  // asynchronously, in a separate component, after this already fetched
  // state once — refetch so the header picks up the synced name promptly.
  useEffect(() => {
    if (!isDiscordEmbed()) return;
    window.addEventListener("bitedle:discord-identity-synced", refresh);
    return () => window.removeEventListener("bitedle:discord-identity-synced", refresh);
  }, [refresh]);

  // Fetch the result gifs up front so they play instantly when a game ends.
  useEffect(() => {
    for (const src of [WIN_GIF, LOSE_GIF]) {
      const img = new Image();
      img.src = src;
    }
  }, []);

  const loadChannelData = useCallback(() => {
    api
      .leaderboard()
      .then((data) => {
        setGuildEntries(data.today);
        setChannelStats(data.channelStats ?? null);
      })
      .catch(() => {});
  }, []);

  // The results carousel/sidebar/stats need this data as soon as the game is
  // finished, since it's shown in three places: the win/lose splash, the
  // standalone Channel Stats screen, and the persistent board sidebar.
  // Classic only — Bitesweeper has no stats or channel leaderboards.
  useEffect(() => {
    if (!isDiscordEmbed() || !finished || mode !== "classic") return;
    api.stats().then(setStats).catch(() => {});
    loadChannelData();
  }, [finished, loadChannelData, mode]);

  const openStats = useCallback(async () => {
    setModal("stats");
    setStats(null);
    try {
      setStats(await api.stats());
    } catch {
      toast("Couldn't load statistics");
    }
  }, [toast]);

  /** After the result splash: unnamed players pick a name, then stats.
   *  Bitesweeper has neither (no leaderboards to be named on) — just close. */
  const handleResultContinue = () => {
    if (mode !== "classic") {
      setModal(null);
    } else if (state && !state.named) {
      setNameError(null);
      setNameMode("post");
      setModal("name");
    } else {
      openStats();
    }
  };

  const handlePlayAgain = useCallback(async () => {
    if (mode !== "mega" || busy) return;
    setBusy(true);
    if (boardEffectTimer.current) clearTimeout(boardEffectTimer.current);
    if (resultModalTimer.current) clearTimeout(resultModalTimer.current);
    try {
      const next = await api.megaReplay();
      setState(next);
      setStats(null);
      setModal(null);
      setShakingIndex(null);
      setBoardEffect(null);
      toast("Fresh Bitesweeper board ready");
    } catch (e) {
      if (e instanceof ApiError && e.state) setState(e.state);
      toast(e instanceof Error ? e.message : "Couldn't start a new board");
    } finally {
      setBusy(false);
    }
  }, [busy, mode, toast]);

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
    setBoardEffect(null);
    if (!reducedMotion) setShakingIndex(index);
    const startedAt = performance.now();
    try {
      const { result, state: next } =
        mode === "mega" ? await api.megaClick(index) : await api.click(index);
      if (!reducedMotion) {
        const remainingShake = TILE_SHAKE_MS - (performance.now() - startedAt);
        if (remainingShake > 0) await wait(remainingShake);
      }
      setShakingIndex(null);
      setState(next);
      const resolvedEffect = next.status === "won" ? "check" : result === "bomb" ? "bomb" : null;
      if (!reducedMotion && resolvedEffect) {
        setBoardEffect(resolvedEffect);
        if (boardEffectTimer.current) clearTimeout(boardEffectTimer.current);
        boardEffectTimer.current = setTimeout(() => setBoardEffect(null), BOARD_EFFECT_MS);
      }
      if (next.status !== "playing") {
        // Let the tile flip and board-level effect breathe before the result splash covers it.
        if (resultModalTimer.current) clearTimeout(resultModalTimer.current);
        resultModalTimer.current = setTimeout(
          () => setModal("result"),
          reducedMotion ? 0 : RESULT_MODAL_DELAY_MS,
        );
      }
    } catch (e) {
      setShakingIndex(null);
      setBoardEffect(null);
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

  const handleFlag = async (index: number) => {
    if (mode !== "mega" || !state || state.status !== "playing" || busy) return;
    const megaState = state as MegaGameState;
    if (megaState.clicks.some((click) => click.index === index)) return;
    const removing = megaState.flags.includes(index);
    if (!removing && megaState.flags.length >= MEGA_BOMB_COUNT) {
      toast("All 12 flags are placed — remove one first.");
      return;
    }
    const previous = megaState;
    const flags = removing
      ? megaState.flags.filter((flaggedIndex) => flaggedIndex !== index)
      : [...megaState.flags, index];
    setState({ ...megaState, flags });
    setBusy(true);
    try {
      const next = await api.megaFlag(index);
      setState(next);
      if (next.status === "won") {
        if (!reducedMotion) {
          setBoardEffect("check");
          if (boardEffectTimer.current) clearTimeout(boardEffectTimer.current);
          boardEffectTimer.current = setTimeout(() => setBoardEffect(null), BOARD_EFFECT_MS);
        }
        if (resultModalTimer.current) clearTimeout(resultModalTimer.current);
        resultModalTimer.current = setTimeout(
          () => setModal("result"),
          reducedMotion ? 0 : RESULT_MODAL_DELAY_MS,
        );
      }
    } catch (e) {
      setState(previous);
      toast(e instanceof Error ? e.message : "Couldn't update the flag");
    } finally {
      setBusy(false);
    }
  };

  const openChannelStats = useCallback(() => {
    setModal("channelStats");
    if (guildEntries === null && channelStats === null) {
      loadChannelData();
    }
  }, [channelStats, guildEntries, loadChannelData]);

  const handleShare = async () => {
    if (!state) return;
    const ok = await copyToClipboard(gameShareText(state, mode));
    toast(ok ? "Results copied to clipboard" : "Couldn't copy to clipboard");
  };

  const handleNewDay = useCallback(() => {
    setModal(null);
    refresh();
  }, [refresh]);

  const toastsEl = (
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
  );

  // Channel Stats and the welcome-back splash are full-page takeovers (like
  // Wordle's own Activity), not overlays on top of the board — they replace
  // the whole screen instead of floating over it. Toasts still need to be
  // visible during them (Share triggers one), so they're rendered as a
  // sibling either way rather than nested inside this swap.
  if (modal === "welcomeBack") {
    return (
      <>
        <WelcomeBackScreen
          puzzleNumber={(state as GameState | null)?.puzzleNumber ?? 0}
          date={state?.date ?? ""}
          firstTry={state?.status === "won" && state?.score === 1}
          onChannelStats={openChannelStats}
          onDismiss={() => setModal(null)}
        />
        {toastsEl}
      </>
    );
  }
  if (modal === "channelStats") {
    return (
      <>
        <ChannelStatsScreen
          entries={guildEntries}
          stats={channelStats}
          onShare={handleShare}
          onBack={() => setModal(null)}
        />
        {toastsEl}
      </>
    );
  }

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
          <h1
            className={`font-extrabold select-none ${
              mode === "mega" ? "text-xl tracking-[0.1em]" : "text-2xl tracking-[0.2em]"
            }`}
          >
            {mode === "mega" ? "BITESWEEPER" : "BITEDLE"}
          </h1>
          <div className="flex items-center gap-0.5">
            {/* Bitesweeper is pure gameplay — no channel stats, leaderboard,
                or statistics anywhere, so those buttons are classic-only. */}
            {mode === "classic" && isDiscordEmbed() && (
              <button
                type="button"
                onClick={openChannelStats}
                aria-label="Channel Stats"
                className="text-muted hover:text-foreground cursor-pointer p-1.5"
              >
                <IconUsers />
              </button>
            )}
            {mode === "classic" && (
              <>
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
              </>
            )}
          </div>
        </div>
      </header>

      {!isDiscordEmbed() && onModeChange && (
        <nav className="border-tileborder bg-raised/40 flex w-full justify-center border-b px-4">
          <div className="flex w-full max-w-lg" aria-label="Game mode">
            {(
              [
                ["classic", "Classic"],
                ["mega", "Bitesweeper"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => onModeChange(value)}
                aria-current={mode === value ? "page" : undefined}
                className={`flex-1 cursor-pointer border-b-2 py-2.5 text-sm font-bold transition-colors ${
                  mode === value
                    ? "border-correct text-foreground"
                    : "text-muted hover:text-foreground border-transparent"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </nav>
      )}

      <main className="flex w-full max-w-lg flex-1 flex-col items-center gap-5 px-4 py-6">
        <div
          className={`flex w-full items-center justify-between text-xs ${
            mode === "mega" ? "max-w-[440px]" : "max-w-[360px]"
          }`}
        >
          <div className="flex items-center gap-2">
            {mode === "classic" && (
              <span className="border-tileborder text-muted rounded border px-2 py-1">
                Puzzle #{(state as GameState | null)?.puzzleNumber ?? "—"}
              </span>
            )}
            {mode === "mega" && (
              <span
                className="border-tileborder text-muted rounded border px-2 py-1 tabular-nums"
                title="Flags remaining"
              >
                🚩 {MEGA_BOMB_COUNT - ((state as MegaGameState | null)?.flags.length ?? 0)}
              </span>
            )}
            <span className="border-tileborder text-muted rounded border px-2 py-1">
              💣{" "}
              {mode === "mega"
                ? MEGA_BOMB_COUNT
                : state && state.date < FIXED_BOMB_COUNT_FROM
                  ? "3–5"
                  : "3"}{" "}
              hidden
            </span>
            <span className="border-tileborder text-muted rounded border px-2 py-1 tabular-nums">
              Clicks: {state?.clicks.length ?? 0}
            </span>
          </div>
          {state && !isDiscordEmbed() && (
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
          {state && isDiscordEmbed() && (
            <span
              title="Your Discord name"
              className="border-tileborder flex max-w-28 items-center gap-1 rounded border px-2 py-1 font-semibold"
            >
              <IconUser />
              <span className="truncate">{state.username}</span>
            </span>
          )}
        </div>

        {isDiscordEmbed() && finished && guildEntries && guildEntries.length > 0 ? (
          <div className="flex w-full max-w-2xl items-start justify-center gap-4">
            <div className="scrollbar-slim hidden max-h-[440px] w-52 shrink-0 flex-col gap-2 overflow-x-hidden overflow-y-auto pr-1 sm:flex">
              {guildEntries.map((entry, i) => (
                <PlayerResultCard key={i} entry={entry} variant="landscape" />
              ))}
            </div>
            <Board
              cols={mode === "mega" ? 10 : 5}
              clicks={state?.clicks ?? []}
              flags={mode === "mega" ? (state as MegaGameState | null)?.flags ?? [] : []}
              layout={state?.layout ?? null}
              disabled={busy || finished || !state}
              shakingIndex={shakingIndex}
              effect={boardEffect}
              onCellClick={handleCell}
              onCellFlag={mode === "mega" ? handleFlag : undefined}
            />
          </div>
        ) : (
          <Board
            cols={mode === "mega" ? 10 : 5}
            clicks={state?.clicks ?? []}
            flags={mode === "mega" ? (state as MegaGameState | null)?.flags ?? [] : []}
            layout={state?.layout ?? null}
            disabled={busy || finished || !state}
            shakingIndex={shakingIndex}
            effect={boardEffect}
            onCellClick={handleCell}
            onCellFlag={mode === "mega" ? handleFlag : undefined}
          />
        )}

        {finished && state && (
          <div
            className={`animate-rise border-tileborder bg-raised flex w-full flex-col items-center gap-4 rounded-lg border p-4 ${
              mode === "mega" ? "max-w-[440px]" : "max-w-[360px]"
            }`}
          >
            <p className="text-center font-bold">
              {state.status === "won"
                ? state.score === 0
                  ? "You flagged every bomb without a single click! ✓"
                  : `You found it in ${state.score} ${state.score === 1 ? "click" : "clicks"}! ✓`
                : mode === "mega"
                  ? "💥 Boom! You hit a bomb."
                  : "💥 Boom! The check mark got away today."}
            </p>
            <div className="flex w-full items-center">
              <div
                className={`border-tileborder flex-1 border-r pr-3 text-center ${
                  mode === "mega" ? "hidden" : ""
                }`}
              >
                <div className="text-muted text-[10px] font-semibold tracking-widest uppercase">
                  Next Bitedle
                </div>
                <Countdown target={state.nextResetAt} onExpire={handleNewDay} />
              </div>
              <div
                className={`flex flex-col items-center gap-2 ${
                  mode === "mega" ? "w-full" : "flex-1 pl-3"
                }`}
              >
                {mode === "mega" && (
                  <button
                    type="button"
                    onClick={handlePlayAgain}
                    disabled={busy}
                    className="bg-correct w-full max-w-36 cursor-pointer rounded py-2 font-bold text-white hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
                  >
                    {busy ? "Starting..." : "Play again"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleShare}
                  className="bg-correct w-full max-w-36 cursor-pointer rounded py-2 font-bold text-white hover:brightness-110"
                >
                  Share 📋
                </button>
                {mode === "classic" && (
                  <button
                    type="button"
                    onClick={() => setModal("leaderboard")}
                    className="border-tileborder hover:border-tilehover w-full max-w-36 cursor-pointer rounded border py-2 text-sm font-semibold"
                  >
                    Leaderboard
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        <div className={`w-full ${mode === "mega" ? "max-w-[440px]" : "max-w-[360px]"}`}>
          <MadeByFooter />
        </div>
      </main>

      {toastsEl}

      {modal === "result" && finished && state && (
        <ResultModal
          won={state.status === "won"}
          score={state.score}
          stats={stats}
          guildEntries={guildEntries}
          onShare={handleShare}
          onContinue={handleResultContinue}
          onPlayAgain={handlePlayAgain}
          busy={busy}
          mode={mode}
        />
      )}
      {modal === "name" && (
        <NameModal
          mode={nameMode}
          currentName={state?.username ?? "Player"}
          onSubmit={handleName}
          onClose={() => {
            setNameError(null);
            if (nameMode === "post" && mode === "classic") {
              openStats();
            } else {
              setModal(null);
            }
          }}
          error={nameError}
        />
      )}
      {modal === "help" && (
        <HelpModal
          legacyBombRange={Boolean(state && state.date < FIXED_BOMB_COUNT_FROM)}
          mode={mode}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "stats" && (
        <StatsModal
          stats={stats}
          state={state}
          onClose={() => setModal(null)}
          onShare={handleShare}
          onNewDay={handleNewDay}
          onPlayAgain={handlePlayAgain}
          buckets={DISTRIBUTION_BUCKETS}
          mode={mode}
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

function IconUsers() {
  return (
    <svg {...iconProps}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5" />
      <path d="M15.5 6.2a3.2 3.2 0 0 1 0 6.2" />
      <path d="M17 14.6c2.4.5 4.5 2.2 4.5 5.4" />
    </svg>
  );
}
