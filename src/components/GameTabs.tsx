"use client";

import { useEffect, useState } from "react";
import type { GameMode } from "@/lib/types";
import { getLaunchMode, isDiscordEmbed, launchModeSettled } from "@/lib/discord-context";
import Game from "./Game";

export default function GameTabs() {
  // Embedded: the mode is locked to whichever command launched the Activity
  // (/play → classic, /bitesweeper → mega) and isn't known until the Discord
  // handshake settles — hold rendering until then (bounded by the bootstrap's
  // 5s safety timeout) instead of flashing a classic board first.
  const [mode, setMode] = useState<GameMode | null>(() =>
    isDiscordEmbed() ? null : "classic",
  );

  useEffect(() => {
    if (!isDiscordEmbed()) return;
    let cancelled = false;
    launchModeSettled().then(() => {
      if (!cancelled) setMode(getLaunchMode());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (mode === null) return null;
  return <Game key={mode} mode={mode} onModeChange={isDiscordEmbed() ? undefined : setMode} />;
}
