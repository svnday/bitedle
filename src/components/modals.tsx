"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import type {
  ClickRecord,
  GameMode,
  GameState,
  GameStatus,
  Leaderboard,
  MegaGameState,
  TodayEntry,
  UserStats,
} from "@/lib/types";
import { BOARD_SIZE, DISTRIBUTION_BUCKETS } from "@/lib/types";
import Countdown from "./Countdown";

/* ---------------------------------------------------------------- shell */

interface ModalProps {
  title: string;
  onClose?: () => void;
  children: React.ReactNode;
}

export function Modal({ title, onClose, children }: ModalProps) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="animate-fadein fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-rise bg-raised border-tileborder relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border p-6 shadow-2xl"
      >
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted hover:text-foreground absolute top-3 right-3 cursor-pointer p-1 text-lg leading-none"
          >
            ✕
          </button>
        )}
        <h2 className="text-muted mb-4 text-center text-sm font-bold tracking-widest uppercase">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ mini tile */

function MiniTile({ kind }: { kind: "x" | "bomb" | "check" | "hidden" | "number" }) {
  const styles = {
    hidden: { className: "border-2 border-tileborder", glyph: "" },
    x: { className: "bg-tile", glyph: "✗" },
    bomb: { className: "bg-danger", glyph: "💣" },
    check: { className: "bg-correct", glyph: "✓" },
    number: { className: "bg-[#22627a]", glyph: "2" },
  }[kind];
  return (
    <span
      aria-hidden
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded ${styles.className} ${
        kind === "x" ? "text-miss" : "text-white"
      } text-xl font-bold`}
    >
      {styles.glyph}
    </span>
  );
}

let resultGridFrame = 0;
let resultGridTimer: ReturnType<typeof setInterval> | null = null;
const resultGridListeners = new Set<(frame: number) => void>();
const RESULT_GRID_FRAME_MS = 400;
const RESULT_GRID_HOLD_MS = 2000;

function startResultGridTicker() {
  if (resultGridTimer !== null) return;
  resultGridTimer = setInterval(() => {
    resultGridFrame += 1;
    for (const listener of resultGridListeners) listener(resultGridFrame);
  }, RESULT_GRID_FRAME_MS);
}

function stopResultGridTicker() {
  if (resultGridTimer === null || resultGridListeners.size > 0) return;
  clearInterval(resultGridTimer);
  resultGridTimer = null;
}

function useResultGridFrame(enabled: boolean) {
  const [frame, setFrame] = useState(resultGridFrame);

  useEffect(() => {
    if (!enabled) return;
    const listener = (nextFrame: number) => setFrame(nextFrame);
    resultGridListeners.add(listener);
    startResultGridTicker();
    return () => {
      resultGridListeners.delete(listener);
      stopResultGridTicker();
    };
  }, [enabled]);

  return frame;
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

function AnimatedResultGrid({ board, status }: { board: ClickRecord[]; status: GameStatus }) {
  const reducedMotion = usePrefersReducedMotion();
  const frame = useResultGridFrame(!reducedMotion && board.length > 0);
  const clicks = board.filter((click) => click.index >= 0 && click.index < BOARD_SIZE);
  const holdSteps = Math.ceil(RESULT_GRID_HOLD_MS / RESULT_GRID_FRAME_MS);
  const cycleLength = Math.max(1, clicks.length + holdSteps);
  const visibleCount = reducedMotion ? clicks.length : Math.min(clicks.length, frame % cycleLength);
  const revealed = new Map<number, ClickRecord["result"]>();

  for (const click of clicks.slice(0, visibleCount)) {
    revealed.set(click.index, click.result);
  }

  const cellClass = (result: ClickRecord["result"] | undefined) => {
    if (result === "check") return "border-correct bg-correct";
    if (result === "bomb") return "border-danger bg-danger";
    if (result === "x") return "border-tileborder bg-tile";
    return "border-tileborder bg-surface";
  };

  return (
    <div
      role="img"
      aria-label={`${status === "won" ? "Winning" : "Losing"} result grid with ${clicks.length} clicks`}
      className="grid grid-cols-5 gap-0.5 rounded-md border border-tileborder/70 bg-black/15 p-1"
    >
      {Array.from({ length: BOARD_SIZE }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={`h-3 w-3 rounded-[2px] border ${cellClass(revealed.get(i))}`}
        />
      ))}
    </div>
  );
}

function MiniResultTrail({ entry }: { entry: TodayEntry }) {
  // A horizontal Wordle-style trail: one square per click. We don't have
  // per-tile data here, so misses read as muted squares and the final square
  // is the outcome — green for the check, red for the bomb. Wraps if a player
  // took many clicks.
  const total = Math.max(1, Math.min(25, entry.clicks));
  const last = total - 1;
  const won = entry.status === "won";
  return (
    <div className="mt-1 flex max-w-full flex-wrap justify-center gap-[3px]">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={`h-2.5 w-2.5 rounded-[2px] ${
            i === last ? (won ? "bg-correct" : "bg-danger") : "bg-tileborder"
          }`}
        />
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- name */

interface NameModalProps {
  /** "post" asks after the first finished game; "edit" is a plain rename. */
  mode: "post" | "edit";
  currentName: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
  error: string | null;
}

export function NameModal({ mode, currentName, onSubmit, onClose, error }: NameModalProps) {
  const [value, setValue] = useState(mode === "edit" ? currentName : "");
  const [busy, setBusy] = useState(false);

  return (
    <Modal title={mode === "post" ? "Get on the leaderboard" : "Change your name"} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          // Skipping keeps the auto-generated name.
          if (value.trim() === "") {
            onClose();
            return;
          }
          setBusy(true);
          try {
            await onSubmit(value);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="playername" className="text-muted mb-1 block text-xs font-semibold">
          {mode === "post"
            ? "Pick a display name to post your score — skip and your results stay off the leaderboard"
            : "Your display name on the leaderboard"}
        </label>
        <input
          id="playername"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={20}
          placeholder={mode === "post" ? "e.g. bomb-dodger" : currentName}
          autoComplete="nickname"
          className="bg-surface border-tileborder focus:border-tilehover w-full rounded border px-3 py-2.5 text-base outline-none"
        />
        {error && <p className="text-miss mt-2 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={busy || (mode === "edit" && value.trim() === "")}
          className="bg-correct mt-4 w-full cursor-pointer rounded py-2.5 font-bold text-white hover:brightness-110 disabled:cursor-default disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {mode === "post" && (
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground mt-2 w-full cursor-pointer py-1.5 text-sm font-semibold"
          >
            Skip — don&apos;t post my score
          </button>
        )}
      </form>
      <p className="text-muted mt-3 text-xs leading-snug">
        {mode === "post"
          ? "Changed your mind later? Name yourself from the header and your results (including today's) will appear."
          : "Your streaks and daily game live in a browser cookie — same browser, same player."}
      </p>
    </Modal>
  );
}

/* --------------------------------------------------------- screen shell */

/** Full-page takeover for screens that should feel like a distinct page
 *  within the Activity (Wordle's "Channel Stats"/welcome-back pattern),
 *  not a floating dialog like Modal. No backdrop, no dialog chrome. */
function ScreenShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-fadein bg-surface fixed inset-0 z-40 flex justify-center overflow-y-auto px-4 py-8">
      <div className="flex w-full max-w-md flex-1 flex-col">{children}</div>
    </div>
  );
}

/** Attribution footer, shared across the puzzle page and the full-page
 *  Discord screens. */
export function MadeByFooter() {
  return (
    <div className="border-tileborder mt-8 flex w-full items-center justify-center gap-2 border-t pt-5">
      {/* Self-hosted avatar, same as the win/lose gifs — works in the iframe. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/sundei.png" alt="" className="h-6 w-6 rounded-full" />
      <span className="text-sm font-semibold">made by sundei for his friend bite</span>
    </div>
  );
}

/* --------------------------------------------------------------- result */

export const WIN_GIF = "/win.gif";
export const LOSE_GIF = "/lose.gif";

function praiseFor(score: number, mode: GameMode = "classic"): string {
  if (mode === "mega") {
    if (score <= 5) return "UNREAL!";
    if (score <= 10) return "Splendid!";
    if (score <= 20) return "Nice work!";
    return "Phew — got there!";
  }
  if (score === 1) return "UNREAL — first click!";
  if (score <= 3) return "Splendid!";
  if (score <= 6) return "Nice work!";
  return "Phew — got there!";
}

/** One player's avatar + non-spoiling result trail + name, for the guild
 *  results carousel and the persistent board sidebar alike. `onShare` is
 *  only ever rendered for the viewer's own ("me") card. */
export function PlayerResultCard({
  entry,
  onShare,
  variant = "portrait",
}: {
  entry: TodayEntry;
  onShare?: () => void;
  variant?: "portrait" | "landscape";
}) {
  const result = entry.board ? (
    <AnimatedResultGrid board={entry.board} status={entry.status} />
  ) : (
    <MiniResultTrail entry={entry} />
  );
  const chrome = entry.me ? "border-white/80 bg-tile/50" : "border-transparent bg-raised/60";

  if (variant === "landscape") {
    return (
      <div className={`flex w-full max-w-full items-center gap-2 rounded-lg border px-2 py-2 ${chrome}`}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {entry.discordAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={entry.discordAvatarUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="h-10 w-10 shrink-0 rounded-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <div className="bg-tile h-10 w-10 shrink-0 rounded-full" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-sm">
              <span className="text-base">{entry.status === "won" ? "\u2705" : "\uD83D\uDCA5"}</span>
              <span className="font-semibold">{entry.clicks}</span>
            </div>
            <div className="truncate text-xs font-semibold">{entry.name}</div>
          </div>
        </div>
        <div className="shrink-0">{result}</div>
      </div>
    );
  }

  return (
    <div
      className={`flex w-24 shrink-0 flex-col items-center gap-1.5 rounded-lg border px-2 py-3 ${
        entry.me ? "border-white/80 bg-tile/50" : "border-transparent bg-raised/60"
      }`}
    >
      {entry.discordAvatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={entry.discordAvatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="h-10 w-10 rounded-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : (
        <div className="bg-tile h-10 w-10 rounded-full" />
      )}
      <div className="flex items-center justify-center gap-1 text-sm">
        <span className="text-base">{entry.status === "won" ? "✅" : "💥"}</span>
        <span className="font-semibold">{entry.clicks}</span>
      </div>
      <div className="w-full truncate text-center text-xs font-semibold">{entry.name}</div>
      {result}
      {entry.me && onShare && (
        <button
          type="button"
          onClick={onShare}
          className="bg-correct mt-1 cursor-pointer rounded-full px-3 py-0.5 text-xs font-bold text-white hover:brightness-110"
        >
          Share
        </button>
      )}
    </div>
  );
}

/** Guild results carousel + win rate/streak stats — shared by the win/lose
 *  splash and the standalone Channel Stats screen. */
export function GuildResultsPanel({
  entries,
  stats,
  onShare,
}: {
  entries: TodayEntry[];
  stats: UserStats | null;
  onShare?: () => void;
}) {
  return (
    <div>
      {entries.length > 0 && (
        <div className="scrollbar-slim flex gap-3 overflow-x-auto pb-2">
          {entries.map((entry, i) => (
            <PlayerResultCard key={i} entry={entry} onShare={entry.me ? onShare : undefined} />
          ))}
        </div>
      )}
      {stats && (
        <div className="mt-6 flex flex-col items-center">
          <h3 className="text-muted mb-2 text-center text-xs font-bold tracking-widest uppercase">
            General Statistics
          </h3>
          <div className="mt-2 flex items-center justify-center">
            <div className="flex items-center">
              <div className="text-center px-4">
                <div className="text-3xl font-extrabold">{`${stats.winPct}%`}</div>
                <div className="text-muted mt-1 text-[11px] leading-tight">Win Rate</div>
              </div>

              <div className="mx-4 h-10 w-px bg-border/70" />

              <div className="text-center px-4">
                <div className="text-3xl font-extrabold">{stats.currentStreak}</div>
                <div className="text-muted mt-1 text-[11px] leading-tight">Current streak</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface ResultModalProps {
  won: boolean;
  score: number | null;
  stats: UserStats | null;
  guildEntries: TodayEntry[] | null;
  onShare: () => void;
  onContinue: () => void;
  onPlayAgain?: () => void;
  busy?: boolean;
  mode?: GameMode;
}

export function ResultModal({
  won,
  score,
  stats,
  guildEntries,
  onShare,
  onContinue,
  onPlayAgain,
  busy = false,
  mode = "classic",
}: ResultModalProps) {
  return (
    <Modal title={won ? "You found it!" : "Game over"} onClose={onContinue}>
      {/* Plain <img>: self-hosted animated gif, not a next/image candidate. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={won ? WIN_GIF : LOSE_GIF}
        alt={won ? "DJ Khaled celebrating your win" : "DJ Khaled taking the loss"}
        className="w-full rounded"
      />
      <p className="mt-4 text-center font-bold">
        {won && score !== null
          ? `${praiseFor(score, mode)} Found in ${score} ${score === 1 ? "click" : "clicks"}. ✓`
          : mode === "mega"
            ? "💥 Out of lives! You hit three bombs. Ready for another board?"
            : "💥 BOOM! That was a bomb. See you tomorrow."}
      </p>

      {guildEntries && guildEntries.length > 0 && (
        <div className="border-tileborder mt-4 border-t pt-4">
          <h3 className="text-muted mb-2 text-xs font-bold tracking-widest uppercase">
            This server today
          </h3>
          <GuildResultsPanel entries={guildEntries} stats={stats} onShare={onShare} />
        </div>
      )}

      {mode === "mega" && onPlayAgain ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onPlayAgain}
            disabled={busy}
            className="bg-correct col-span-2 cursor-pointer rounded py-2.5 font-bold text-white hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? "Starting..." : "Play again"}
          </button>
          <button
            type="button"
            onClick={onShare}
            className="border-tileborder hover:border-tilehover cursor-pointer rounded border py-2 text-sm font-semibold"
          >
            Share
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="border-tileborder hover:border-tilehover cursor-pointer rounded border py-2 text-sm font-semibold"
          >
            Close
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onContinue}
          className={`mt-4 w-full cursor-pointer rounded py-2.5 font-bold text-white hover:brightness-110 ${
            won ? "bg-correct" : "bg-danger"
          }`}
        >
          Continue
        </button>
      )}
    </Modal>
  );
}

/* -------------------------------------------------------- welcome back */

interface WelcomeBackModalProps {
  puzzleNumber: number;
  date: string;
  /** True when the player found the check on their very first click. */
  firstTry: boolean;
  onChannelStats: () => void;
  onDismiss: () => void;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-07-07" -> "July 7, 2026". Parses the parts directly to avoid any
 *  Date/timezone off-by-one. */
function formatDisplayDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return "";
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function WelcomeBackScreen({
  puzzleNumber,
  date,
  firstTry,
  onChannelStats,
  onDismiss,
}: WelcomeBackModalProps) {
  return (
    <ScreenShell>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <MiniTile kind="check" />
        <h2 className="mt-3 text-sm font-extrabold tracking-[0.2em]">BITEDLE</h2>
        <p className="text-muted mx-auto mt-6 max-w-xs text-base leading-snug">
          {firstTry
            ? "Okay so you got lucky… see how everyone else did."
            : "Could you really do any worse? Check out how much better everyone else did."}
        </p>
        <button
          type="button"
          onClick={onChannelStats}
          className="bg-correct mt-6 cursor-pointer rounded-full px-10 py-3 font-bold text-white hover:brightness-110"
        >
          Channel Stats
        </button>
        <div className="text-muted mt-6 text-xs leading-relaxed">
          <div>{formatDisplayDate(date)}</div>
          <div>No. {puzzleNumber}</div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-muted hover:text-foreground mt-4 cursor-pointer text-sm font-semibold"
        >
          Back to puzzle
        </button>
      </div>
      <MadeByFooter />
    </ScreenShell>
  );
}

/* -------------------------------------------------------- channel stats */

interface ChannelStatsScreenProps {
  entries: TodayEntry[] | null;
  stats: UserStats | null;
  onShare: () => void;
  onBack: () => void;
}

export function ChannelStatsScreen({ entries, stats, onShare, onBack }: ChannelStatsScreenProps) {
  return (
    <ScreenShell>
      <button
        type="button"
        onClick={onBack}
        className="text-muted hover:text-foreground mb-6 w-fit cursor-pointer text-sm font-semibold"
      >
        ← Back to puzzle
      </button>
      <h1 className="mb-6 text-center text-lg font-extrabold tracking-wide">Channel Stats</h1>
      {!entries ? (
        <p className="text-muted py-8 text-center">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-muted py-8 text-center text-sm">
          No one has finished today&apos;s Bitedle yet. Be the first!
        </p>
      ) : (
        <GuildResultsPanel entries={entries} stats={stats} onShare={onShare} />
      )}
      <div className="flex-1" />
      <MadeByFooter />
    </ScreenShell>
  );
}

/* ----------------------------------------------------------------- help */

export function HelpModal({
  legacyBombRange,
  mode = "classic",
  onClose,
}: {
  legacyBombRange: boolean;
  mode?: GameMode;
  onClose: () => void;
}) {
  return (
    <Modal title="How to play" onClose={onClose}>
      <div className="space-y-4 text-sm leading-snug">
        <p>
          Somewhere on the {mode === "mega" ? "10×10" : "5×5"} board hides{" "}
          <strong>one green check mark</strong>. Click tiles to find it in as few clicks as
          possible.
        </p>
        {mode === "mega" ? (
          <>
            <div className="flex items-center gap-3">
              <MiniTile kind="number" />
              <p>
                A number counts adjacent bombs or the check mark directly up, down, left, or right.
                Diagonals do not count, and a 0 reveals only itself.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="border-tileborder bg-surface flex h-11 w-11 shrink-0 items-center justify-center rounded border-2 text-xl">
                🚩
              </div>
              <p>
                Right-click a hidden square, or press and hold on mobile, to flag a possible bomb.
                Flagged squares stay hidden and cannot be revealed until you remove the flag.
              </p>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-3">
            <MiniTile kind="x" />
            <p>
              A red <strong>✗</strong> is a safe miss — the game continues.
            </p>
          </div>
        )}
        <div className="flex items-center gap-3">
          <MiniTile kind="bomb" />
          <p>
            {mode === "mega" ? (
              <>
                You start with <strong>3 lives</strong>. Each bomb costs one life, and the third bomb
                ends your run. There are exactly 12 bombs hidden across the larger board.
              </>
            ) : legacyBombRange ? (
              <>
                A <strong>bomb</strong> ends your run instantly. There are 3 to 5 of them, and you
                never know exactly how many.
              </>
            ) : (
              <>
                A <strong>bomb</strong> ends your run instantly. There are exactly 3 of them, and you
                never know which tiles hide them.
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <MiniTile kind="check" />
          <p>
            The <strong>check mark</strong> wins the game. Your score is the total clicks it took
            — lower is better, and 1 is perfection.
          </p>
        </div>
        {mode === "mega" && (
          <p className="border-tileborder bg-raised rounded border p-3">
            Reveal all 87 numbered squares with at least one life remaining and the check reveals
            itself automatically. Any bomb hits still count toward your final click score.
          </p>
        )}
        <p className="border-tileborder text-muted border-t pt-4">
          {mode === "mega"
            ? "Finish the board, then choose Play again for a fresh randomly generated board."
            : "A new board drops every day at midnight. Everyone plays the same board, and you only get one shot at it."}
        </p>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- stats */

function bucketOf(state: GameState): string | null {
  if (state.status === "lost") return "X";
  if (state.status === "won" && state.score !== null) {
    return state.score <= 5 ? String(state.score) : "6+";
  }
  return null;
}

interface StatsModalProps {
  stats: UserStats | null;
  state: GameState | MegaGameState | null;
  onClose: () => void;
  onShare: () => void;
  onNewDay: () => void;
  onPlayAgain?: () => void;
  buckets?: readonly string[];
  todayBucket?: string | null;
  mode?: GameMode;
}

export function StatsModal({
  stats,
  state,
  onClose,
  onShare,
  onNewDay,
  onPlayAgain,
  buckets = DISTRIBUTION_BUCKETS,
  todayBucket,
  mode = "classic",
}: StatsModalProps) {
  const finished = state !== null && state.status !== "playing";
  const resolvedTodayBucket =
    todayBucket === undefined && state && finished && mode === "classic"
      ? bucketOf(state as GameState)
      : todayBucket;

  return (
    <Modal title="Statistics" onClose={onClose}>
      {!stats ? (
        <p className="text-muted py-8 text-center">Loading…</p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-4 gap-2 text-center">
            {(
              [
                [stats.played, "Played"],
                [`${stats.winPct}`, "Win %"],
                [stats.currentStreak, "Current streak"],
                [stats.maxStreak, "Max streak"],
              ] as const
            ).map(([value, label]) => (
              <div key={label}>
                <div className="text-3xl font-semibold">{value}</div>
                <div className="text-muted mt-0.5 text-[11px] leading-tight">{label}</div>
              </div>
            ))}
          </div>

          <h3 className="text-muted mb-2 text-xs font-bold tracking-widest uppercase">
            Score distribution
          </h3>
          <div className="space-y-1.5">
            {buckets.map((bucket) => {
              const count = stats.distribution[bucket] ?? 0;
              const max = Math.max(1, ...Object.values(stats.distribution));
              const isToday = resolvedTodayBucket === bucket;
              const fill = isToday ? (bucket === "X" ? "bg-danger" : "bg-correct") : "bg-tileborder";
              return (
                <div key={bucket} className="flex items-center gap-2">
                  <div className="w-6 shrink-0 text-right text-sm font-semibold">
                    {bucket === "X" ? "💣" : bucket}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div
                      className={`flex h-5 items-center justify-end rounded-r-[4px] px-1.5 ${fill}`}
                      style={{ width: `${8 + 92 * (count / max)}%` }}
                    >
                      <span className="text-xs font-bold text-white">{count}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {finished && mode === "mega" && onPlayAgain ? (
            <div className="border-tileborder mt-6 grid grid-cols-2 gap-2 border-t pt-4">
              <button
                type="button"
                onClick={onPlayAgain}
                className="bg-correct cursor-pointer rounded py-2.5 font-bold text-white hover:brightness-110"
              >
                Play again
              </button>
              <button
                type="button"
                onClick={onShare}
                className="border-tileborder hover:border-tilehover cursor-pointer rounded border py-2.5 font-bold"
              >
                Share
              </button>
            </div>
          ) : finished && (
            <div className="border-tileborder mt-6 flex items-center border-t pt-4">
              <div className="border-tileborder flex-1 border-r pr-4 text-center">
                <div className="text-muted text-[11px] font-semibold tracking-widest uppercase">
                  Next Bitedle
                </div>
                <Countdown target={state.nextResetAt} onExpire={onNewDay} />
              </div>
              <div className="flex-1 pl-4 text-center">
                <button
                  type="button"
                  onClick={onShare}
                  className="bg-correct cursor-pointer rounded px-6 py-2.5 font-bold text-white hover:brightness-110"
                >
                  Share 📋
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

/* ----------------------------------------------------------- leaderboard */

interface LeaderboardModalProps {
  onClose: () => void;
  /** True when the viewer finished today's game without picking a name. */
  nameHint?: boolean;
}

export function LeaderboardModal({ onClose, nameHint }: LeaderboardModalProps) {
  const [data, setData] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"today" | "alltime">("today");

  useEffect(() => {
    api
      .leaderboard()
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <Modal title="Leaderboard" onClose={onClose}>
      <div className="border-tileborder mb-4 flex border-b">
        {(
          [
            ["today", "Today"],
            ["alltime", "All-time"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px w-1/2 cursor-pointer border-b-2 pb-2 text-sm font-bold ${
              tab === key ? "border-foreground" : "text-muted border-transparent"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="text-miss py-6 text-center text-sm">{error}</p>}
      {!data && !error && <p className="text-muted py-8 text-center">Loading…</p>}

      {data && tab === "today" && (
        <div>
          {nameHint && (
            <p className="border-tileborder bg-tile/40 mb-3 rounded border px-3 py-2 text-xs leading-snug">
              Your result isn&apos;t posted — pick a name (the 👤 button above the board) to join
              the leaderboard.
            </p>
          )}
          {data.today.length === 0 ? (
            <p className="text-muted py-8 text-center text-sm">
              No one has finished today&apos;s Bitedle yet. Be the first!
            </p>
          ) : (
            <ul>
              {data.today.map((entry, i) => (
                <li
                  key={i}
                  className={`border-tileborder/60 flex items-center gap-3 border-b py-2 last:border-b-0 ${
                    entry.me ? "bg-tile/50 -mx-2 rounded px-2" : ""
                  }`}
                >
                  <span className="text-muted w-6 shrink-0 text-right font-mono text-sm tabular-nums">
                    {i + 1}
                  </span>
                  {entry.discordAvatarUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={entry.discordAvatarUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-6 w-6 shrink-0 rounded-full"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {entry.name}
                    {entry.me && <span className="text-muted font-normal"> (you)</span>}
                  </span>
                  {entry.status === "won" ? (
                    <span className="shrink-0 text-sm">
                      <span aria-hidden className="text-correct font-bold">
                        ✓
                      </span>{" "}
                      {entry.score} {entry.score === 1 ? "click" : "clicks"}
                    </span>
                  ) : (
                    <span className="text-muted shrink-0 text-sm">
                      💣 after {entry.clicks} {entry.clicks === 1 ? "click" : "clicks"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {data && tab === "alltime" && (
        <div>
          {data.allTime.length === 0 ? (
            <p className="text-muted py-8 text-center text-sm">No games played yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted text-left text-xs uppercase">
                  <th className="pb-2 font-semibold">Player</th>
                  <th className="pb-2 text-right font-semibold">Wins</th>
                  <th className="pb-2 text-right font-semibold">Played</th>
                  <th className="pb-2 text-right font-semibold" title="Average clicks per win">
                    Avg
                  </th>
                  <th className="pb-2 text-right font-semibold" title="Best score">
                    Best
                  </th>
                  <th className="pb-2 text-right font-semibold" title="Current streak">
                    Streak
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.allTime.map((entry, i) => (
                  <tr
                    key={i}
                    className={`border-tileborder/60 border-t ${entry.me ? "bg-tile/50" : ""}`}
                  >
                    <td className="max-w-0 py-2 pr-2 font-semibold">
                      <div className="flex min-w-0 items-center gap-2">
                        {entry.discordAvatarUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={entry.discordAvatarUrl}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="h-5 w-5 shrink-0 rounded-full"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        )}
                        <span className="truncate">
                          {entry.name}
                          {entry.me && <span className="text-muted font-normal"> (you)</span>}
                        </span>
                      </div>
                    </td>
                    <td className="py-2 text-right tabular-nums">{entry.wins}</td>
                    <td className="py-2 text-right tabular-nums">{entry.played}</td>
                    <td className="py-2 text-right tabular-nums">{entry.avgScore ?? "–"}</td>
                    <td className="py-2 text-right tabular-nums">{entry.bestScore ?? "–"}</td>
                    <td className="py-2 text-right tabular-nums">{entry.currentStreak}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Modal>
  );
}
