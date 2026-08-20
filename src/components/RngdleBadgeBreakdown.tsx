import type { CSSProperties } from "react";
import type { RngdleBadge, RngdleRevealState } from "@/lib/rngdle/types";

const WHOLE_NUMBER_BADGES = new Set([
  "HETEROGENEOUS",
  "ONE_DIGIT",
  "TWO_DIGITS",
  "THREE_DIGITS",
  "FOUR_DIGITS",
  "FIVE_DIGITS",
  "SIX_DIGITS",
]);

const DIGIT_BADGES: Record<string, string> = {
  BORON: "5",
  CARBON: "6",
  FLUORINE: "9",
  GHOST: "0",
  HYDROGEN: "1",
  LITHIUM: "3",
  NITROGEN: "7",
  OXYGEN: "8",
};

function badgeContributorIndexes(badge: RngdleBadge, number: number): Set<number> {
  const digits = [...String(number)];
  if (WHOLE_NUMBER_BADGES.has(badge.id)) return new Set(digits.map((_, index) => index));
  if (badge.id === "CLEAN") return new Set([digits.length - 1]);

  const targetDigit = DIGIT_BADGES[badge.id];
  if (targetDigit) {
    return new Set(digits.flatMap((digit, index) => digit === targetDigit ? [index] : []));
  }

  const exactNumber = badge.desc.match(/(?:exactly|contains)(?: the number)? ["']?(\d{2,})["']?/i)?.[1];
  if (exactNumber) {
    const start = String(number).indexOf(exactNumber);
    if (start >= 0) return new Set([...exactNumber].map((_, index) => start + index));
  }

  if (/every digit|all digits|only digits|no repeated digits/i.test(badge.desc)) {
    return new Set(digits.map((_, index) => index));
  }
  if (/first (?:and|two).*last|first.*last/i.test(badge.desc)) {
    return new Set([0, digits.length - 1]);
  }
  return new Set<number>();
}

export default function RngdleBadgeBreakdown({
  badges,
  number,
  state,
}: {
  badges: RngdleBadge[];
  number: number;
  state: RngdleRevealState;
}) {
  const visible =
    state === "revealing-badges" ||
    state === "initial-complete" ||
    state === "revealing-penalty" ||
    state === "final-complete";
  const digits = [...String(number)];

  if (badges.length === 0) {
    return (
      <section className="rngdle-badge-section" aria-labelledby="rngdle-badge-title">
        <div className="rngdle-section-heading">
          <h2 id="rngdle-badge-title">Badge Breakdown</h2>
          <span>0 badges earned</span>
        </div>
        <p className="rngdle-empty-badges">No badge patterns were found in this number.</p>
      </section>
    );
  }

  return (
    <section className="rngdle-badge-section" aria-labelledby="rngdle-badge-title">
      <div className="rngdle-section-heading">
        <h2 id="rngdle-badge-title">Badge Breakdown</h2>
        <span>{badges.length} badges earned</span>
      </div>
      <div className={`rngdle-badge-list${visible ? " rngdle-badge-list--visible" : ""}`}>
        {badges.map((badge, index) => {
          const contributors = badgeContributorIndexes(badge, number);
          return (
            <article
              key={badge.id}
              className={`rngdle-badge rngdle-badge--${badge.rarity.toLowerCase()}`}
              style={{ "--rng-badge-index": index } as CSSProperties}
            >
              <header>
                <div className="rngdle-badge-name">
                  <span className="rngdle-badge-emoji" aria-hidden="true">{badge.emoji}</span>
                  <h3>{badge.label}</h3>
                  <span className="rngdle-badge-rarity">{badge.rarity.toUpperCase()}</span>
                </div>
                <strong className={badge.ep === 0 ? "rngdle-badge-ep--superseded" : undefined}>
                  {badge.ep === 0 ? "0" : `+${badge.ep.toLocaleString()}`} EP
                </strong>
              </header>
              <p>{badge.desc}</p>
              <div className="rngdle-badge-digits" aria-hidden="true">
                {digits.map((digit, digitIndex) => (
                  <span
                    key={digitIndex}
                    className={contributors.has(digitIndex) ? "rngdle-badge-digit--active" : undefined}
                  >
                    {digit}
                  </span>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
