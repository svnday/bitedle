import type { BitebluffCard as Card } from "@/lib/bitebluff-constants";

const SUIT_SYMBOL = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
} as const;

function rankLabel(rank: Card["rank"]): string {
  if (rank === 14) return "A";
  if (rank === 13) return "K";
  if (rank === 12) return "Q";
  if (rank === 11) return "J";
  return String(rank);
}

export default function BitebluffCard({
  card,
  faceDown = false,
  dealing = false,
  delay = 0,
}: {
  card?: Card;
  faceDown?: boolean;
  dealing?: boolean;
  delay?: number;
}) {
  const hidden = faceDown || !card;
  const red = card?.suit === "diamonds" || card?.suit === "hearts";
  const label = card ? `${rankLabel(card.rank)} of ${card.suit}` : "Empty card slot";

  return (
    <div
      className={`bitebluff-card-shell ${dealing ? "bitebluff-card-dealing" : ""}`}
      style={{ animationDelay: `${delay}ms` }}
      aria-label={hidden ? "Face-down playing card" : label}
    >
      <div className={`bitebluff-card-inner ${hidden ? "" : "bitebluff-card-revealed"}`}>
        <div className="bitebluff-card-back" aria-hidden="true">
          <span>BB</span>
        </div>
        <div
          className={`bitebluff-card-face ${red ? "bitebluff-card-red" : "bitebluff-card-black"}`}
          aria-hidden="true"
        >
          {card && (
            <>
              <span className="bitebluff-card-corner">
                <b>{rankLabel(card.rank)}</b>
                <i>{SUIT_SYMBOL[card.suit]}</i>
              </span>
              <strong>{SUIT_SYMBOL[card.suit]}</strong>
              <span className="bitebluff-card-corner bitebluff-card-corner-bottom">
                <b>{rankLabel(card.rank)}</b>
                <i>{SUIT_SYMBOL[card.suit]}</i>
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
