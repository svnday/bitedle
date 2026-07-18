"use client";

import { useEffect, useState } from "react";
import type { GameMode } from "@/lib/types";
import {
  type ActivityLaunchMode,
  getLaunchMode,
  isDiscordEmbed,
  launchModeSettled,
} from "@/lib/discord-context";
import Game from "./Game";
import BitesweeperGame from "./BitesweeperGame";

export default function GameTabs() {
  // Embedded: the mode is locked to whichever command launched the Activity
  // (/play → classic, /bitesweeper → mega) and isn't known until the Discord
  // handshake settles — hold rendering until then (bounded by the bootstrap's
  // 5s safety timeout) instead of flashing a classic board first.
  const [runtime, setRuntime] = useState<{
    embedded: boolean;
    mode: ActivityLaunchMode;
  } | null>(null);

  useEffect(() => {
    const embedded = isDiscordEmbed();
    let cancelled = false;
    if (!embedded) {
      Promise.resolve().then(() => {
        if (!cancelled) setRuntime({ embedded: false, mode: "classic" });
      });
    } else {
      launchModeSettled().then(() => {
        if (!cancelled) setRuntime({ embedded: true, mode: getLaunchMode() });
      });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  if (runtime === null) return null;
  if (runtime.mode === "unavailable") return <ActivityLoadError />;
  if (runtime.embedded && runtime.mode === "mega") return <BitesweeperGame />;
  const setWebMode = (mode: GameMode) => setRuntime({ embedded: false, mode });
  return (
    <Game
      key={runtime.mode}
      mode={runtime.mode}
      onModeChange={runtime.embedded ? undefined : setWebMode}
    />
  );
}

function ActivityLoadError() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 text-center">
      <div className="border-tileborder bg-raised max-w-sm rounded-lg border p-6">
        <h1 className="text-xl font-extrabold">Activity couldn&apos;t load</h1>
        <p className="text-muted mt-3 text-sm leading-relaxed">
          Close this Activity completely, then run the slash command again.
        </p>
      </div>
    </main>
  );
}
