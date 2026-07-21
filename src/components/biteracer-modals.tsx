"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import type {
  BiteracerGameState,
  BiteracerLeaderboard,
  BiteracerUserStats,
} from "@/lib/types";
import Countdown from "./Countdown";
import { Modal } from "./modals";

/* ----------------------------------------------------------------- help */

export function BiteracerHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How to play" onClose={onClose}>
      <div className="space-y-4 text-sm leading-snug">
        <p>
          Type today&apos;s passage as fast and accurately as you can. Everyone gets the same
          passage each day, and you get <strong>one attempt</strong>.
        </p>
        <p>
          Your clock starts on your first keystroke and is measured by the server — refreshing
          the page never resets it. Backspace freely; mistyped characters are highlighted in
          red as you go.
        </p>
        <p>
          Scoring is <strong>net WPM</strong> — your words-per-minute counting only correctly
          typed characters — so accuracy matters as much as raw speed.
        </p>
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------- leaderboard */

export function BiteracerLeaderboardModal({
  onClose,
  nameHint,
}: {
  onClose: () => void;
  /** True when the viewer finished today's run without picking a name. */
  nameHint?: boolean;
}) {
  const [data, setData] = useState<BiteracerLeaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"today" | "alltime">("today");

  useEffect(() => {
    api
      .biteracerLeaderboard()
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
              Your result isn&apos;t posted — pick a name to join the leaderboard.
            </p>
          )}
          {data.today.length === 0 ? (
            <p className="text-muted py-8 text-center text-sm">
              No one has run today&apos;s Biteracer yet. Be the first!
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
                  <span className="shrink-0 text-sm tabular-nums">
                    <span className="font-bold">{entry.netWpm}</span> wpm · {entry.accuracy}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {data && tab === "alltime" && (
        <div>
          {data.allTime.length === 0 ? (
            <p className="text-muted py-8 text-center text-sm">No runs yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted text-left text-xs uppercase">
                  <th className="pb-2 font-semibold">Player</th>
                  <th className="pb-2 text-right font-semibold" title="Games played">
                    Played
                  </th>
                  <th className="pb-2 text-right font-semibold" title="Average net WPM">
                    Avg
                  </th>
                  <th className="pb-2 text-right font-semibold" title="Best net WPM">
                    Best
                  </th>
                  <th className="pb-2 text-right font-semibold" title="Current daily streak">
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
                    <td className="py-2 text-right tabular-nums">{entry.gamesPlayed}</td>
                    <td className="py-2 text-right tabular-nums">{entry.avgNetWpm}</td>
                    <td className="py-2 text-right tabular-nums">{entry.bestNetWpm}</td>
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

/* ------------------------------------------------------------ statistics */

export function BiteracerStatsModal({
  stats,
  state,
  onClose,
  onShare,
  onNewDay,
}: {
  stats: BiteracerUserStats | null;
  state: BiteracerGameState | null;
  onClose: () => void;
  onShare: () => void;
  onNewDay: () => void;
}) {
  const finished = state?.status === "finished";
  return (
    <Modal title="Statistics" onClose={onClose}>
      {!stats ? (
        <p className="text-muted py-8 text-center">Loading…</p>
      ) : (
        <>
          <div className="mb-2 grid grid-cols-4 gap-2 text-center">
            {(
              [
                [stats.played, "Played"],
                [stats.avgNetWpm ?? "–", "Avg WPM"],
                [stats.bestNetWpm ?? "–", "Best WPM"],
                [stats.currentStreak, "Current streak"],
              ] as const
            ).map(([value, label]) => (
              <div key={label}>
                <div className="text-3xl font-semibold">{value}</div>
                <div className="text-muted mt-0.5 text-[11px] leading-tight">{label}</div>
              </div>
            ))}
          </div>
          <p className="text-muted text-center text-xs">
            {stats.avgAccuracy !== null && <>Average accuracy {stats.avgAccuracy}% · </>}
            Max streak {stats.maxStreak}
          </p>

          {finished && state && (
            <div className="border-tileborder mt-6 flex items-center border-t pt-4">
              <div className="border-tileborder flex-1 border-r pr-4 text-center">
                <div className="text-muted text-[11px] font-semibold tracking-widest uppercase">
                  Next Biteracer
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
