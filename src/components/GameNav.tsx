"use client";

import { useEffect, useRef } from "react";
import type { GameMode } from "@/lib/types";

interface GameNavProps {
  mode: GameMode;
  onModeChange: (mode: GameMode) => void;
}

const TABS: readonly [GameMode, string][] = [
  ["classic", "Classic"],
  ["mega", "Bitesweeper"],
  ["biteracer", "Biteracer"],
  ["bitefight", "Bitefight"],
  ["biteshooter", "Biteshooter"],
  ["bitebluff", "Bitebluff"],
  ["biteball", "Biteball"],
  ["rngdle", "RNGDLE"],
];

/** The website's game-mode tab bar. Never rendered inside a Discord embed —
 *  embedded launches are locked to the mode their slash command chose. */
export default function GameNav({ mode, onModeChange }: GameNavProps) {
  const activeTabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ behavior: "auto", block: "nearest", inline: "center" });
  }, [mode]);

  return (
    <nav className="border-tileborder bg-raised/40 flex w-full justify-center border-b px-1 sm:px-4">
      <div className="flex w-full max-w-5xl overflow-x-auto" aria-label="Game mode">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            ref={mode === value ? activeTabRef : undefined}
            type="button"
            onClick={() => onModeChange(value)}
            aria-current={mode === value ? "page" : undefined}
            className={`min-w-20 flex-none cursor-pointer border-b-2 px-2 py-2.5 text-[10px] font-bold transition-colors sm:min-w-0 sm:flex-1 sm:text-xs lg:text-sm ${
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
  );
}
