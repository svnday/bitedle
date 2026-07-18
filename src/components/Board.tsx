"use client";

import type { CellResult, ClickRecord, MegaCellResult, MegaClickRecord } from "@/lib/types";

interface BoardProps {
  clicks: (ClickRecord | MegaClickRecord)[];
  /** The full board once the game is over; unclicked tiles reveal dimmed. */
  layout: (CellResult | MegaCellResult)[] | null;
  cols?: 5 | 10;
  disabled: boolean;
  shakingIndex?: number | null;
  effect?: "bomb" | "check" | null;
  onCellClick: (index: number) => void;
}

const CLASSIC_BACK_FACE: Record<
  CellResult,
  { className: string; glyph: (dense: boolean) => React.ReactNode; label: string }
> = {
  x: {
    className: "bg-tile",
    glyph: (dense) => (
      <span className={`text-miss font-bold leading-none ${dense ? "text-base" : "text-3xl"}`}>
        ✗
      </span>
    ),
    label: "Miss",
  },
  bomb: {
    className: "bg-danger",
    glyph: (dense) => <span className={`leading-none ${dense ? "text-sm" : "text-2xl"}`}>💣</span>,
    label: "Bomb",
  },
  check: {
    className: "bg-correct",
    glyph: (dense) => (
      <span className={`font-bold leading-none text-white ${dense ? "text-base" : "text-3xl"}`}>
        ✓
      </span>
    ),
    label: "Check mark",
  },
};

const NUMBER_STYLES = [
  { className: "border-tileborder bg-surface border", textClass: "text-muted", label: "0 adjacent" },
  { className: "bg-[#22627a]", textClass: "text-[#b9efff]", label: "1 adjacent" },
  { className: "bg-correct", textClass: "text-white", label: "2 adjacent" },
  { className: "bg-[#806719]", textClass: "text-[#fff0a6]", label: "3 adjacent" },
  { className: "bg-[#7a2f2b]", textClass: "text-white", label: "4 adjacent" },
] as const;

function backFace(result: CellResult | MegaCellResult, dense: boolean) {
  if (typeof result !== "number") {
    const face = CLASSIC_BACK_FACE[result];
    return { className: face.className, glyph: face.glyph(dense), label: face.label };
  }
  const number = NUMBER_STYLES[result];
  return {
    className: number.className,
    glyph: (
      <span className={`${number.textClass} font-extrabold leading-none ${dense ? "text-sm" : "text-2xl"}`}>
        {result}
      </span>
    ),
    label: number.label,
  };
}

const GRID_COLS = { 5: "grid-cols-5", 10: "grid-cols-10" } as const;

export default function Board({
  clicks,
  layout,
  cols = 5,
  disabled,
  shakingIndex = null,
  effect = null,
  onCellClick,
}: BoardProps) {
  const clicked = new Map(clicks.map((c) => [c.index, c.result]));
  const dense = cols === 10;
  const size = cols * cols;

  return (
    <div className={`relative w-full ${dense ? "max-w-[440px]" : "max-w-[360px]"}`}>
      <div
        className={`grid w-full ${GRID_COLS[cols]} ${dense ? "gap-1" : "gap-1.5"}`}
        role="grid"
        aria-label={dense ? "Bitedle XL board" : "Bitedle board"}
      >
        {Array.from({ length: size }, (_, i) => {
          const result = clicked.get(i) ?? layout?.[i];
          // Tiles the player never clicked flip dimmed at game end, cascading.
          const isDim = result !== undefined && !clicked.has(i);
          const row = Math.floor(i / cols) + 1;
          const col = (i % cols) + 1;
          const face = result !== undefined ? backFace(result, dense) : null;
          return (
            <div
              key={i}
              className={`tile aspect-square ${result !== undefined ? "revealed" : ""} ${
                isDim ? "tile-dim" : ""
              } ${shakingIndex === i ? "tile-shaking" : ""}`}
            >
              <button
                type="button"
                className="relative h-full w-full cursor-pointer disabled:cursor-default"
                disabled={disabled || result !== undefined}
                onClick={() => onCellClick(i)}
                aria-label={
                  face
                    ? `Row ${row}, column ${col}: ${face.label}${isDim ? " (not clicked)" : ""}`
                    : `Row ${row}, column ${col}: hidden`
                }
              >
                <div
                  className="tile-inner"
                  style={isDim ? { transitionDelay: `${i * (dense ? 8 : 30)}ms` } : undefined}
                >
                  <div className="tile-face tile-front bg-surface" />
                  {face && (
                    <div className={`tile-face tile-back ${face.className}`}>
                      {face.glyph}
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
