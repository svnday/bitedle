import type { BitebluffSettledParticipant } from "@/lib/bitebluff-types";
import BitebluffCard from "./BitebluffCard";

function outcome(result: BitebluffSettledParticipant): string {
  if (result.net > 0) return `Won ${result.net.toLocaleString()} Bites`;
  if (result.net < 0) {
    return `Lost ${Math.abs(result.net).toLocaleString()} Bites`;
  }
  return "Broke even";
}

function winnerLabel(result: BitebluffSettledParticipant): string {
  if (!result.winner) return "Final hand";
  if (result.wonLayers.includes(0)) {
    return result.wonLayers.length === 1
      ? "Main pot winner"
      : `Main pot + ${result.wonLayers.length - 1} ${
          result.wonLayers.length === 2 ? "layer" : "layers"
        }`;
  }
  return `Layer ${result.wonLayers
    .map((layer) => layer + 1)
    .join(", ")} winner`;
}

export default function BitebluffSettlementResults({
  date,
  title,
  note,
  results,
  totalPool,
  onClose,
}: {
  date: string;
  title: string;
  note: string;
  results: BitebluffSettledParticipant[];
  totalPool: number;
  onClose: () => void;
}) {
  return (
    <div
      className="bitebluff-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="bitebluff-results-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bitebluff-results-title"
      >
        <div className="bitebluff-results-modal-heading">
          <div>
            <span className="bitebluff-private-label">
              Final results · {date}
            </span>
            <h2 id="bitebluff-results-title">{title}</h2>
            <p>
              Winners first, then strongest final hand to weakest ·{" "}
              {totalPool.toLocaleString()} Bite pool
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close revealed hands"
          >
            ×
          </button>
        </div>

        <div className="bitebluff-results-scroll">
          <div className="bitebluff-reveal-grid">
            {results.map((result) => (
              <article
                key={result.userId}
                className={`${result.winner ? "bitebluff-result-winner" : ""} ${
                  result.me ? "bitebluff-result-me" : ""
                }`}
              >
                <header>
                  <span className="bitebluff-result-rank">{result.rank}</span>
                  {result.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className="bitebluff-result-avatar"
                      src={result.avatarUrl}
                      alt=""
                    />
                  ) : (
                    <span
                      className="bitebluff-player-fallback bitebluff-result-avatar"
                      aria-hidden="true"
                    >
                      {result.displayName.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div>
                    <strong>
                      {result.displayName}
                      {result.me ? " · You" : ""}
                    </strong>
                    <small>{winnerLabel(result)}</small>
                  </div>
                  <b
                    className={
                      result.net > 0
                        ? "bitebluff-result-positive"
                        : result.net < 0
                          ? "bitebluff-result-negative"
                          : ""
                    }
                  >
                    {outcome(result)}
                  </b>
                </header>

                <div className="bitebluff-mini-hand">
                  {result.hand.map((card, index) => (
                    <BitebluffCard
                      key={`${result.userId}:${card.rank}:${card.suit}:${index}`}
                      card={card}
                    />
                  ))}
                </div>

                <footer>
                  <strong>{result.handLabel}</strong>
                  <span>
                    {result.committed.toLocaleString()} wagered ·{" "}
                    {result.payout.toLocaleString()} returned
                  </span>
                </footer>
              </article>
            ))}
          </div>
        </div>

        <p className="bitebluff-results-note">
          {note}
        </p>
      </section>
    </div>
  );
}
