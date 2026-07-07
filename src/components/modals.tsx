"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import type { GameState, Leaderboard, UserStats } from "@/lib/types";
import { DISTRIBUTION_BUCKETS } from "@/lib/types";
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

function MiniTile({ kind }: { kind: "x" | "bomb" | "check" | "hidden" }) {
  const styles = {
    hidden: { className: "border-2 border-tileborder", glyph: "" },
    x: { className: "bg-tile", glyph: "✗" },
    bomb: { className: "bg-danger", glyph: "💣" },
    check: { className: "bg-correct", glyph: "✓" },
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

/* ----------------------------------------------------------------- name */

interface NameModalProps {
  /** "intro" shows the rules blurb on first visit; "edit" is a plain rename. */
  mode: "intro" | "edit";
  currentName: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
  error: string | null;
}

export function NameModal({ mode, currentName, onSubmit, onClose, error }: NameModalProps) {
  const [value, setValue] = useState(mode === "edit" ? currentName : "");
  const [busy, setBusy] = useState(false);

  return (
    <Modal title={mode === "intro" ? "Welcome to Bitedle" : "Change your name"} onClose={onClose}>
      {mode === "intro" && (
        <div className="mb-5 flex items-start gap-3">
          <MiniTile kind="check" />
          <p className="text-sm leading-snug">
            One check mark hides on a 5×5 board with 3–5 bombs. Find it in as few clicks as you
            can — hit a bomb and you&apos;re done. One board a day, one try per player.
          </p>
        </div>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          // Skipping the name on first visit just starts the game.
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
          {mode === "intro"
            ? "Pick a display name for the leaderboard — no account needed, change it anytime"
            : "Your display name on the leaderboard"}
        </label>
        <input
          id="playername"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={20}
          placeholder={mode === "intro" ? `e.g. bomb-dodger (or skip: ${currentName})` : currentName}
          autoComplete="nickname"
          className="bg-surface border-tileborder focus:border-tilehover w-full rounded border px-3 py-2.5 text-base outline-none"
        />
        {error && <p className="text-miss mt-2 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={busy || (mode === "edit" && value.trim() === "")}
          className="bg-correct mt-4 w-full cursor-pointer rounded py-2.5 font-bold text-white hover:brightness-110 disabled:cursor-default disabled:opacity-50"
        >
          {busy ? "Saving…" : mode === "intro" ? "Play" : "Save"}
        </button>
      </form>
      <p className="text-muted mt-3 text-xs leading-snug">
        Your streaks and daily game live in a browser cookie — same browser, same player.
      </p>
    </Modal>
  );
}

/* ----------------------------------------------------------------- help */

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How to play" onClose={onClose}>
      <div className="space-y-4 text-sm leading-snug">
        <p>
          Somewhere on the 5×5 board hides <strong>one green check mark</strong>. Click tiles to
          find it in as few clicks as possible.
        </p>
        <div className="flex items-center gap-3">
          <MiniTile kind="x" />
          <p>
            A red <strong>✗</strong> is a safe miss — the game continues.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <MiniTile kind="bomb" />
          <p>
            A <strong>bomb</strong> ends your run instantly. There are 3 to 5 of them, and you
            never know exactly how many.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <MiniTile kind="check" />
          <p>
            The <strong>check mark</strong> wins the game. Your score is the total clicks it took
            — lower is better, and 1 is perfection.
          </p>
        </div>
        <p className="border-tileborder text-muted border-t pt-4">
          A new board drops every day at midnight. Everyone plays the same board, and you only get
          one shot at it — no retries, no second chances.
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
  state: GameState | null;
  onClose: () => void;
  onShare: () => void;
  onNewDay: () => void;
}

export function StatsModal({ stats, state, onClose, onShare, onNewDay }: StatsModalProps) {
  const finished = state !== null && state.status !== "playing";
  const todayBucket = state && finished ? bucketOf(state) : null;

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
            {DISTRIBUTION_BUCKETS.map((bucket) => {
              const count = stats.distribution[bucket] ?? 0;
              const max = Math.max(1, ...Object.values(stats.distribution));
              const isToday = todayBucket === bucket;
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

          {finished && (
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
}

export function LeaderboardModal({ onClose }: LeaderboardModalProps) {
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
                      💣 after {entry.clicks - 1} {entry.clicks - 1 === 1 ? "click" : "clicks"}
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
                    <td className="max-w-0 truncate py-2 pr-2 font-semibold">
                      {entry.name}
                      {entry.me && <span className="text-muted font-normal"> (you)</span>}
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
