"use client";

import type { CellResult, ClickRecord } from "@/lib/types";
import { BOARD_SIZE } from "@/lib/types";

interface BoardProps {
  clicks: ClickRecord[];
  /** The full board once the game is over; unclicked tiles reveal dimmed. */
  layout: CellResult[] | null;
  disabled: boolean;
  shakingIndex?: number | null;
  effect?: "bomb" | "check" | null;
  onCellClick: (index: number) => void;
}

const BACK_FACE: Record<CellResult, { className: string; glyph: React.ReactNode; label: string }> = {
  x: {
    className: "bg-tile",
    glyph: <span className="text-miss text-3xl font-bold leading-none">✗</span>,
    label: "Miss",
  },
  bomb: {
    className: "bg-danger",
    glyph: <span className="text-2xl leading-none">💣</span>,
    label: "Bomb",
  },
  check: {
    className: "bg-correct",
    glyph: <span className="text-3xl font-bold leading-none text-white">✓</span>,
    label: "Check mark",
  },
};

export default function Board({
  clicks,
  layout,
  disabled,
  shakingIndex = null,
  effect = null,
  onCellClick,
}: BoardProps) {
  const clicked = new Map(clicks.map((c) => [c.index, c.result]));

  return (
    <div className="relative w-full max-w-[360px]">
      <div className="grid w-full grid-cols-5 gap-1.5" role="grid" aria-label="Bitedle board">
        {Array.from({ length: BOARD_SIZE }, (_, i) => {
          const result = clicked.get(i) ?? layout?.[i];
          // Tiles the player never clicked flip dimmed at game end, cascading.
          const isDim = result !== undefined && !clicked.has(i);
          const row = Math.floor(i / 5) + 1;
          const col = (i % 5) + 1;
          return (
            <div
              key={i}
              className={`tile aspect-square ${result ? "revealed" : ""} ${
                isDim ? "tile-dim" : ""
              } ${shakingIndex === i ? "tile-shaking" : ""}`}
            >
              <button
                type="button"
                className="relative h-full w-full cursor-pointer disabled:cursor-default"
                disabled={disabled || !!result}
                onClick={() => onCellClick(i)}
                aria-label={
                  result
                    ? `Row ${row}, column ${col}: ${BACK_FACE[result].label}${isDim ? " (not clicked)" : ""}`
                    : `Row ${row}, column ${col}: hidden`
                }
              >
                <div
                  className="tile-inner"
                  style={isDim ? { transitionDelay: `${i * 30}ms` } : undefined}
                >
                  <div className="tile-face tile-front bg-surface" />
                  {result && (
                    <div className={`tile-face tile-back ${BACK_FACE[result].className}`}>
                      {BACK_FACE[result].glyph}
                    </div>
                  )}
                </div>
              </button>
            </div>
          );
        })}
      </div>

      {effect === "bomb" && (
        <div className="board-explosion" aria-hidden>
          <span />
          <span />
          <span />
        </div>
      )}
      {effect === "check" && (
        <div className="board-confetti" aria-hidden>
          {Array.from({ length: 18 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
      )}
    </div>
  );
}
