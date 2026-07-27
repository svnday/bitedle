import type { BitebluffCard } from "@/lib/bitebluff-constants";
import { bitebluffHandInsight } from "@/lib/bitebluff-poker";

export default function BitebluffHandStrength({
  hand,
}: {
  hand: readonly BitebluffCard[];
}) {
  const insight = bitebluffHandInsight(hand);
  const scoreLabel = insight.score === 100 ? "100" : insight.score.toFixed(1);

  return (
    <section className="bitebluff-hand-strength" aria-label="Your hand strength">
      <div className="bitebluff-hand-strength-heading">
        <div>
          <span>Hand strength</span>
          <h3>{insight.label}</h3>
        </div>
        <div className="bitebluff-hand-score">
          <strong>{scoreLabel}</strong>
          <small>/ 100</small>
        </div>
      </div>
      <p>{insight.summary}</p>
      <div
        className="bitebluff-hand-meter"
        role="meter"
        aria-label={`Relative hand score: ${scoreLabel} out of 100`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={insight.score}
      >
        <span style={{ width: `${Math.max(2, insight.score)}%` }} />
      </div>
      <div className="bitebluff-hand-strength-footer">
        <strong>{insight.tier}</strong>
        <span>
          Stronger than roughly {scoreLabel}% of possible five-card deals.
          This ranks the cards, not your odds of winning today&apos;s pool.
        </span>
      </div>
    </section>
  );
}
