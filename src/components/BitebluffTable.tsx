import type { BitebluffCard as Card } from "@/lib/bitebluff-constants";
import BitebluffCard from "./BitebluffCard";

export default function BitebluffTable({
  hand,
  revealedCount,
  dealing,
}: {
  hand: readonly Card[];
  revealedCount: number;
  dealing: boolean;
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
        <span>{dealing ? "Dealing…" : "Exclusive deck"}</span>
      </div>
      <div className="bitebluff-hand" aria-label={`${revealedCount} of 5 cards revealed`}>
        {Array.from({ length: 5 }, (_, index) => (
          <BitebluffCard
            key={`${index}:${hand[index]?.rank ?? "empty"}:${hand[index]?.suit ?? "empty"}`}
            card={hand[index]}
            faceDown={index >= revealedCount}
            dealing={dealing && index === revealedCount - 1}
          />
        ))}
      </div>
    </section>
  );
}
