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
import BiteracerGame from "./BiteracerGame";
import BitesweeperGame from "./BitesweeperGame";
import BiteracerRaceGame from "./BiteracerRaceGame";

export default function GameTabs() {
  // Embedded: the mode is resolved per player from whichever command THEY ran
  // (/play → classic, /bitesweeper → mega; channel-mates can differ) and isn't
  // known until the Discord handshake settles — hold rendering until then
  // (bounded by the bootstrap's 5s safety timeout) instead of flashing a
  // classic board first.
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
  if (runtime.embedded && runtime.mode === "biteracer") return <BiteracerRaceGame />;
  const setWebMode = (mode: GameMode) => setRuntime({ embedded: false, mode });
  // Website-only: an embedded session's mode comes from the activity-mode
  // resolution, which only ever yields "classic" or "mega" — Biteracer can't
  // reach embeds.
  if (!runtime.embedded && runtime.mode === "biteracer") {
    return <BiteracerGame onModeChange={setWebMode} />;
  }
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
