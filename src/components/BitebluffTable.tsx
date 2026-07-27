import type { BitebluffCard as Card } from "@/lib/bitebluff-constants";
import BitebluffCard from "./BitebluffCard";

export default function BitebluffTable({
  hand,
  placedCount,
  revealedCount,
  dealing,
  readyToFlip,
  flipping,
  replacementPositions = [],
}: {
  hand: readonly Card[];
  placedCount: number;
  revealedCount: number;
  dealing: boolean;
  readyToFlip: boolean;
  flipping: boolean;
  replacementPositions?: readonly number[];
}) {
  return (
    <section
      className="bitebluff-table"
      aria-label="Your private Bitebluff table"
      aria-live="polite"
    >
      <div className="bitebluff-table-glow" />
      <div className="bitebluff-deck" aria-label="Centered deck">
        <BitebluffCard faceDown />
        <span>
          {dealing
            ? "Dealing…"
            : readyToFlip
              ? "Hand placed"
              : flipping
                ? "Flipping…"
                : "Exclusive deck"}
        </span>
      </div>
      <div
        className="bitebluff-hand"
        aria-label={`${placedCount} of 5 cards placed; ${revealedCount} revealed`}
      >
        {Array.from({ length: 5 }, (_, index) =>
          index >= placedCount ? (
            <div
              key={`destination:${index}`}
              className="bitebluff-card-placeholder"
              aria-label={`Empty card destination ${index + 1}`}
            />
          ) : (
            <BitebluffCard
              key={`${index}:${hand[index]?.rank ?? "empty"}:${hand[index]?.suit ?? "empty"}`}
              card={hand[index]}
              faceDown={index >= revealedCount}
              dealing={dealing && index === placedCount - 1}
              flipping={flipping && index === revealedCount - 1}
              dealIndex={index}
              className={
                replacementPositions.includes(index)
                  ? "bitebluff-card-replacement"
                  : ""
              }
            />
          ),
        )}
      </div>
    </section>
  );
}
