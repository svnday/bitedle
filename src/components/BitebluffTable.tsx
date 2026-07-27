import {
  BITEBLUFF_BURN_STAGGER_MS,
  type BitebluffCard as Card,
} from "@/lib/bitebluff-constants";
import BitebluffCard from "./BitebluffCard";
import type { BitebluffRedrawAnimationState } from "./useBitebluffRedrawAnimation";

export default function BitebluffTable({
  hand,
  placedCount,
  revealedCount,
  dealing,
  readyToFlip,
  flipping,
  replacementPositions = [],
  selectedBurnPositions = [],
  burnSelectionMode = false,
  burnSelectionLocked = false,
  onToggleBurnPosition,
  redrawAnimation = null,
}: {
  hand: readonly Card[];
  placedCount: number;
  revealedCount: number;
  dealing: boolean;
  readyToFlip: boolean;
  flipping: boolean;
  replacementPositions?: readonly number[];
  selectedBurnPositions?: readonly number[];
  burnSelectionMode?: boolean;
  burnSelectionLocked?: boolean;
  onToggleBurnPosition?: (position: number) => void;
  redrawAnimation?: BitebluffRedrawAnimationState | null;
}) {
  const selectedSet = new Set(selectedBurnPositions);
  const replacementSet = new Set(replacementPositions);
  const redrawPosition = redrawAnimation
    ? redrawAnimation.positions[redrawAnimation.step]
    : null;
  const deckLabel = redrawAnimation
    ? redrawAnimation.phase === "burning"
      ? "Burning selected cardsâ€¦"
      : redrawAnimation.phase === "drawing"
        ? `Drawing ${redrawAnimation.step + 1} of ${redrawAnimation.positions.length}â€¦`
        : "Revealing replacementâ€¦"
    : dealing
      ? "Dealingâ€¦"
      : readyToFlip
        ? "Hand placed"
        : flipping
          ? "Flippingâ€¦"
          : "Exclusive deck";

  function renderRedrawCard(index: number) {
    if (!redrawAnimation) return null;
    const replacementOrder = redrawAnimation.positions.indexOf(index);
    if (redrawAnimation.phase === "burning") {
      return (
        <BitebluffCard
          key={replacementOrder >= 0 ? `burn:${index}` : `held:${index}`}
          card={redrawAnimation.previousHand[index]}
          dealIndex={index}
          delay={
            replacementOrder >= 0
              ? replacementOrder * BITEBLUFF_BURN_STAGGER_MS
              : 0
          }
          className={
            replacementOrder >= 0 ? "bitebluff-card-burning" : ""
          }
        />
      );
    }
    if (replacementOrder < 0 || replacementOrder < redrawAnimation.step) {
      return (
        <BitebluffCard
          key={`held:${index}`}
          card={hand[index]}
          dealIndex={index}
          className={
            replacementSet.has(index) ? "bitebluff-card-replacement" : ""
          }
        />
      );
    }
    if (replacementOrder > redrawAnimation.step) {
      return (
        <div
          key={`redraw-destination:${index}`}
          className="bitebluff-card-placeholder bitebluff-redraw-placeholder"
          aria-label={`Empty replacement destination ${index + 1}`}
        />
      );
    }
    return (
      <BitebluffCard
        key={`redraw:${index}:${hand[index]?.rank}:${hand[index]?.suit}`}
        card={hand[index]}
        faceDown={redrawAnimation.phase === "drawing"}
        dealing={redrawAnimation.phase === "drawing" && index === redrawPosition}
        flipping={redrawAnimation.phase === "flipping" && index === redrawPosition}
        dealIndex={index}
        className="bitebluff-card-replacement"
      />
    );
  }

  return (
    <section
      className="bitebluff-table"
      aria-label="Your private Bitebluff table"
      aria-live="polite"
    >
      <div className="bitebluff-table-glow" />
      <div className="bitebluff-deck" aria-label="Centered deck">
        <BitebluffCard faceDown />
        <span>{deckLabel}</span>
      </div>
      <div
        className="bitebluff-hand"
        aria-label={
          redrawAnimation
            ? `${redrawAnimation.positions.length} selected cards are being replaced`
            : `${placedCount} of 5 cards placed; ${revealedCount} revealed`
        }
      >
        {Array.from({ length: 5 }, (_, index) => {
          const redrawCard = renderRedrawCard(index);
          if (redrawCard) return redrawCard;
          if (index >= placedCount) {
            return (
              <div
                key={`destination:${index}`}
                className="bitebluff-card-placeholder"
                aria-label={`Empty card destination ${index + 1}`}
              />
            );
          }
          const card = (
            <BitebluffCard
              key={`${index}:${hand[index]?.rank ?? "empty"}:${hand[index]?.suit ?? "empty"}`}
              card={hand[index]}
              faceDown={index >= revealedCount}
              dealing={dealing && index === placedCount - 1}
              flipping={flipping && index === revealedCount - 1}
              dealIndex={index}
              className={
                replacementSet.has(index) ? "bitebluff-card-replacement" : ""
              }
            />
          );
          if (!burnSelectionMode) return card;
          const selected = selectedSet.has(index);
          const disabled =
            burnSelectionLocked ||
            (!selected && selectedBurnPositions.length >= 3);
          return (
            <button
              key={`burn-choice:${index}`}
              type="button"
              className={`bitebluff-card-choice ${selected ? "is-selected" : ""}`}
              aria-pressed={selected}
              aria-label={`${selected ? "Keep" : "Burn"} card ${index + 1}`}
              disabled={disabled}
              onClick={() => onToggleBurnPosition?.(index)}
            >
              {card}
              <span>{selected ? "Selected" : "Select"}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
