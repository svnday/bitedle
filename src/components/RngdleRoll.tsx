import type { RngdleResult, RngdleRevealState } from "@/lib/rngdle/types";

const HIDDEN_NUMBER_STATES = new Set<RngdleRevealState>(["rolling", "rerolling"]);

export default function RngdleRoll({
  result,
  state,
}: {
  result: RngdleResult | null;
  state: RngdleRevealState;
}) {
  const number = result ? String(result.number) : "000000";
  const hidden = HIDDEN_NUMBER_STATES.has(state);
  const showRarity = !hidden && state !== "revealing-number" && state !== "revealing-reroll";
  const showScore =
    showRarity && state !== "revealing-rarity";
  const showPenalty = result?.penaltyPercent !== null &&
    (state === "revealing-penalty" || state === "final-complete");

  return (
    <div className={`rngdle-number-card rngdle-tier--${result?.rarity ?? "common"}`}>
      <div className="rngdle-card-gloss" aria-hidden="true" />
      <div className="rngdle-digit-row" aria-hidden="true">
        {[...number].map((digit, index) => (
          <span
            key={`${index}-${digit}`}
            className={`rngdle-digit${hidden ? " rngdle-digit--rolling" : ""}`}
            style={{ animationDelay: `${index * 70}ms` }}
          >
            {hidden ? (index * 7 + 3) % 10 : digit}
          </span>
        ))}
      </div>
      <p className="sr-only">
        {hidden ? "A random number is rolling." : result ? `Rolled ${result.number}.` : "Ready to roll."}
      </p>

      <div className={`rngdle-rarity-line${showRarity ? " rngdle-reveal-visible" : ""}`}>
        <strong>{result?.rarityLabel ?? "COMMON"}</strong>
        <span aria-hidden="true">•</span>
        <span>{result?.rarityBand ?? "Awaiting roll"}</span>
      </div>

      <div className={`rngdle-score-block${showScore ? " rngdle-reveal-visible" : ""}`}>
        {showPenalty && result ? (
          <>
            <span className="rngdle-raw-score">{result.rawEp.toLocaleString()} EP</span>
            <span className="rngdle-penalty-chip">−{result.penaltyPercent}%</span>
            <strong>{result.creditedEp.toLocaleString()} EP</strong>
            <small>credited after reroll penalty</small>
          </>
        ) : (
          <>
            <strong>{result?.rawEp.toLocaleString() ?? "0"} EP</strong>
            <small>{result?.penaltyPercent ? "raw reroll score" : "entropy points"}</small>
          </>
        )}
      </div>
    </div>
  );
}
