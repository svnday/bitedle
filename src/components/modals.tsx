"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { squareTrail } from "@/lib/share-text";
import type { GameState, Leaderboard, TodayEntry, UserStats } from "@/lib/types";
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

/* --------------------------------------------------------------- result */

export const WIN_GIF = "/win.gif";
export const LOSE_GIF = "/lose.gif";

function praiseFor(score: number): string {
  if (score === 1) return "UNREAL — first click!";
  if (score <= 3) return "Splendid!";
  if (score <= 6) return "Nice work!";
  return "Phew — got there!";
}

/** One player's avatar + non-spoiling result trail + name, for the guild
 *  results carousel and the persistent board sidebar alike. */
export function PlayerResultCard({ entry }: { entry: TodayEntry }) {
  return (
    <div
      className={`flex w-16 shrink-0 flex-col items-center gap-1 rounded p-1.5 ${
        entry.me ? "bg-tile/50 ring-foreground ring-1" : ""
      }`}
    >
      {entry.discordAvatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={entry.discordAvatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="h-8 w-8 rounded-full"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : (
        <div className="bg-tile h-8 w-8 rounded-full" />
      )}
      <div className="text-center text-[10px] leading-tight break-all">
        {squareTrail(entry.status, entry.clicks - 1)}
      </div>
      <div className="w-full truncate text-center text-[10px] font-semibold">{entry.name}</div>
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
        <div className="flex gap-3 overflow-x-auto pb-1">
          {entries.map((entry, i) => (
            <PlayerResultCard key={i} entry={entry} />
          ))}
        </div>
      )}
      {onShare && entries.length > 0 && (
        <button
          type="button"
          onClick={onShare}
          className="bg-correct mt-3 w-full cursor-pointer rounded py-2 text-sm font-bold text-white hover:brightness-110"
        >
          Share your result 📋
        </button>
      )}
      {stats && (
        <div className="border-tileborder mt-4 grid grid-cols-3 gap-2 border-t pt-4 text-center">
          {(
            [
              [`${stats.winPct}%`, "Win rate"],
              [stats.currentStreak, "Current streak"],
              [stats.maxStreak, "Best streak"],
            ] as const
          ).map(([value, label]) => (
            <div key={label}>
              <div className="text-2xl font-semibold">{value}</div>
              <div className="text-muted mt-0.5 text-[11px] leading-tight">{label}</div>
            </div>
          ))}
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
}

export function ResultModal({ won, score, stats, guildEntries, onShare, onContinue }: ResultModalProps) {
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
          ? `${praiseFor(score)} Found in ${score} ${score === 1 ? "click" : "clicks"}. ✓`
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

      <button
        type="button"
        onClick={onContinue}
        className={`mt-4 w-full cursor-pointer rounded py-2.5 font-bold text-white hover:brightness-110 ${
          won ? "bg-correct" : "bg-danger"
        }`}
      >
        Continue
      </button>
    </Modal>
  );
}

/* -------------------------------------------------------- welcome back */

interface WelcomeBackModalProps {
  onChannelStats: () => void;
  onDismiss: () => void;
}

export function WelcomeBackModal({ onChannelStats, onDismiss }: WelcomeBackModalProps) {
  return (
    <Modal title="Welcome back" onClose={onDismiss}>
      <p className="text-center font-bold">Nice work on today&apos;s Bitedle!</p>
      <p className="text-muted mt-2 text-center text-sm">Check out how your server did today.</p>
      <button
        type="button"
        onClick={onChannelStats}
        className="bg-correct mt-4 w-full cursor-pointer rounded py-2.5 font-bold text-white hover:brightness-110"
      >
        Channel Stats
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="text-muted hover:text-foreground mt-2 w-full cursor-pointer py-1.5 text-sm font-semibold"
      >
        Back to puzzle
      </button>
    </Modal>
  );
}

/* -------------------------------------------------------- channel stats */

interface ChannelStatsModalProps {
  entries: TodayEntry[] | null;
  stats: UserStats | null;
  onShare: () => void;
  onClose: () => void;
}

export function ChannelStatsModal({ entries, stats, onShare, onClose }: ChannelStatsModalProps) {
  return (
    <Modal title="Channel Stats" onClose={onClose}>
      {!entries ? (
        <p className="text-muted py-8 text-center">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-muted py-8 text-center text-sm">
          No one has finished today&apos;s Bitedle yet. Be the first!
        </p>
      ) : (
        <GuildResultsPanel entries={entries} stats={stats} onShare={onShare} />
      )}
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
          one shot at it.
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
