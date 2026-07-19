"use client";

import { useEffect, useRef } from "react";
import type { CellResult, ClickRecord, MegaCellResult, MegaClickRecord } from "@/lib/types";

interface BoardProps {
  clicks: (ClickRecord | MegaClickRecord)[];
  flags?: number[];
  /** The full board once the game is over; unclicked tiles reveal dimmed. */
  layout: (CellResult | MegaCellResult)[] | null;
  cols?: 5 | 10;
  disabled: boolean;
  shakingIndex?: number | null;
  effect?: "bomb" | "check" | null;
  onCellClick: (index: number) => void;
  onCellFlag?: (index: number) => void;
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
  { className: "bg-[#8a4a1f]", textClass: "text-white", label: "5 adjacent" },
  { className: "bg-[#94321f]", textClass: "text-white", label: "6 adjacent" },
  { className: "bg-[#7c2447]", textClass: "text-white", label: "7 adjacent" },
  { className: "bg-[#5b2a86]", textClass: "text-white", label: "8 adjacent" },
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
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE = 12;

interface ActiveLongPress {
  index: number;
  pointerId: number;
  startX: number;
  startY: number;
  timer: ReturnType<typeof setTimeout>;
}

export default function Board({
  clicks,
  flags = [],
  layout,
  cols = 5,
  disabled,
  shakingIndex = null,
  effect = null,
  onCellClick,
  onCellFlag,
}: BoardProps) {
  const clicked = new Map(clicks.map((c) => [c.index, c.result]));
  const flagged = new Set(flags);
  const dense = cols === 10;
  const size = cols * cols;
  const activeLongPress = useRef<ActiveLongPress | null>(null);
  const suppressClick = useRef<{ index: number; until: number } | null>(null);
  const touchFlagHandled = useRef<{ index: number; until: number } | null>(null);
  const recentTouchEnd = useRef<{ index: number; until: number } | null>(null);

  const cancelLongPress = (pointerId?: number) => {
    const press = activeLongPress.current;
    if (!press || (pointerId !== undefined && press.pointerId !== pointerId)) return;
    clearTimeout(press.timer);
    activeLongPress.current = null;
  };

  const markTouchFlagHandled = (index: number, now: number) => {
    const until = now + 1_000;
    suppressClick.current = { index, until };
    touchFlagHandled.current = { index, until };
  };

  useEffect(() => () => cancelLongPress(), []);

  return (
    <div className={`relative w-full ${dense ? "max-w-[440px]" : "max-w-[360px]"}`}>
      <div
        className={`grid w-full ${GRID_COLS[cols]} ${dense ? "gap-1" : "gap-1.5"}`}
        role="grid"
        aria-label={dense ? "Bitesweeper board" : "Bitedle board"}
      >
        {Array.from({ length: size }, (_, i) => {
          const result = clicked.get(i) ?? layout?.[i];
          // Tiles the player never clicked flip dimmed at game end, cascading.
          const isDim = result !== undefined && !clicked.has(i);
          const row = Math.floor(i / cols) + 1;
          const col = (i % cols) + 1;
          const face = result !== undefined ? backFace(result, dense) : null;
          const isFlagged = result === undefined && flagged.has(i);
          return (
            <div
              key={i}
              className={`tile aspect-square ${result !== undefined ? "revealed" : ""} ${
                isDim ? "tile-dim" : ""
              } ${shakingIndex === i ? "tile-shaking" : ""}`}
            >
              <button
                type="button"
                className="relative h-full w-full touch-manipulation cursor-pointer select-none disabled:cursor-default"
                disabled={disabled || result !== undefined}
                onClick={() => {
                  const suppressed = suppressClick.current;
                  if (suppressed && suppressed.until < Date.now()) suppressClick.current = null;
                  else if (suppressed?.index === i) {
                    suppressClick.current = null;
                    return;
                  }
                  if (!isFlagged) onCellClick(i);
                }}
                onPointerDown={(event) => {
                  if (
                    event.pointerType !== "touch" ||
                    !event.isPrimary ||
                    !onCellFlag ||
                    disabled ||
                    result !== undefined
                  ) return;
                  cancelLongPress();
                  const { pointerId, clientX, clientY } = event;
                  const timer = setTimeout(() => {
                    const press = activeLongPress.current;
                    if (press?.pointerId !== pointerId || press.index !== i) return;
                    activeLongPress.current = null;
                    markTouchFlagHandled(i, Date.now());
                    onCellFlag(i);
                  }, LONG_PRESS_MS);
                  activeLongPress.current = {
                    index: i,
                    pointerId,
                    startX: clientX,
                    startY: clientY,
                    timer,
                  };
                }}
                onPointerMove={(event) => {
                  const press = activeLongPress.current;
                  if (!press || press.pointerId !== event.pointerId) return;
                  if (
                    Math.hypot(event.clientX - press.startX, event.clientY - press.startY) >
                    LONG_PRESS_MOVE_TOLERANCE
                  ) cancelLongPress(event.pointerId);
                }}
                onPointerUp={(event) => {
                  const press = activeLongPress.current;
                  if (press?.pointerId === event.pointerId) {
                    recentTouchEnd.current = { index: press.index, until: Date.now() + 500 };
                  }
                  cancelLongPress(event.pointerId);
                }}
                onPointerCancel={(event) => cancelLongPress(event.pointerId)}
                onPointerLeave={(event) => cancelLongPress(event.pointerId)}
                onContextMenu={(event) => {
                  if (!onCellFlag || disabled || result !== undefined) return;
                  event.preventDefault();
                  const handled = touchFlagHandled.current;
                  if (handled && handled.until < Date.now()) touchFlagHandled.current = null;
                  else if (handled?.index === i) return;

                  const active = activeLongPress.current;
                  const recent = recentTouchEnd.current;
                  if (
                    active?.index === i ||
                    (recent?.index === i && recent.until >= Date.now())
                  ) {
                    cancelLongPress(active?.pointerId);
                    recentTouchEnd.current = null;
                    markTouchFlagHandled(i, Date.now());
                  }
                  onCellFlag(i);
                }}
                aria-pressed={onCellFlag ? isFlagged : undefined}
                aria-label={
                  face
                    ? `Row ${row}, column ${col}: ${face.label}${isDim ? " (not clicked)" : ""}`
                    : isFlagged
                      ? `Row ${row}, column ${col}: flagged as a possible bomb`
                    : `Row ${row}, column ${col}: hidden`
                }
              >
                <div
                  className="tile-inner"
                  style={isDim ? { transitionDelay: `${i * (dense ? 8 : 30)}ms` } : undefined}
                >
                  <div className="tile-face tile-front bg-surface">
                    {isFlagged && (
                      <span className={`${dense ? "text-base" : "text-xl"}`} aria-hidden>
                        🚩
                      </span>
                    )}
                  </div>
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
