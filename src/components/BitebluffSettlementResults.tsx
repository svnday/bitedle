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
  results,
  totalPool,
}: {
  results: BitebluffSettledParticipant[];
  totalPool: number;
}) {
  return (
    <section
      className="bitebluff-action-panel bitebluff-settlement bitebluff-settled-results"
      aria-label="Final Bitebluff hands"
    >
      <div className="bitebluff-settlement-heading">
        <div>
          <span className="bitebluff-private-label">Settlement complete</span>
          <h2>Everyone&apos;s cards are revealed</h2>
          <p>
            Winners appear first, followed by the strongest final hand down to
            the weakest. These results remain public until the next round opens
            at midnight Eastern.
          </p>
        </div>
        <strong>{totalPool.toLocaleString()} Bite pool</strong>
      </div>

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
    </section>
  );
}
