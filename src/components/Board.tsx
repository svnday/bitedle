"use client";

import type { CellResult, ClickRecord } from "@/lib/types";
import { BOARD_SIZE } from "@/lib/types";

interface BoardProps {
  clicks: ClickRecord[];
  /** After a loss, the check's location is hinted on its unrevealed tile. */
  ghostCheckIndex: number | null;
  disabled: boolean;
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

export default function Board({ clicks, ghostCheckIndex, disabled, onCellClick }: BoardProps) {
  const revealed = new Map(clicks.map((c) => [c.index, c.result]));

  return (
    <div className="grid w-full max-w-[360px] grid-cols-5 gap-1.5" role="grid" aria-label="Bitedle board">
      {Array.from({ length: BOARD_SIZE }, (_, i) => {
        const result = revealed.get(i);
        const isGhost = ghostCheckIndex === i && !result;
        const row = Math.floor(i / 5) + 1;
        const col = (i % 5) + 1;
        return (
          <div
            key={i}
            className={`tile aspect-square ${result ? "revealed" : ""} ${isGhost ? "ghost-check" : ""}`}
          >
            <button
              type="button"
              className="relative h-full w-full cursor-pointer disabled:cursor-default"
              disabled={disabled || !!result}
              onClick={() => onCellClick(i)}
              aria-label={
                result
                  ? `Row ${row}, column ${col}: ${BACK_FACE[result].label}`
                  : `Row ${row}, column ${col}: hidden`
              }
            >
              <div className="tile-inner">
                <div className="tile-face tile-front bg-surface">
                  {isGhost && (
                    <span className="text-correct/80 text-2xl font-bold leading-none">✓</span>
                  )}
                </div>
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
  );
}
