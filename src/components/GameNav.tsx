"use client";

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
];

/** The website's game-mode tab bar. Never rendered inside a Discord embed —
 *  embedded launches are locked to the mode their slash command chose. */
export default function GameNav({ mode, onModeChange }: GameNavProps) {
  return (
    <nav className="border-tileborder bg-raised/40 flex w-full justify-center border-b px-4">
      <div className="flex w-full max-w-2xl" aria-label="Game mode">
        {TABS.map(([value, label]) => (
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
  );
}
