import type { CSSProperties } from "react";
import type { RngdleBadge, RngdleRevealState } from "@/lib/rngdle/types";

export default function RngdleBadgeBreakdown({
  badges,
  state,
}: {
  badges: RngdleBadge[];
  state: RngdleRevealState;
}) {
  const visible =
    state === "revealing-badges" ||
    state === "initial-complete" ||
    state === "revealing-penalty" ||
    state === "final-complete";

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
        {badges.map((badge, index) => (
          <article
            key={badge.id}
            className={`rngdle-badge rngdle-badge--${badge.rarity.toLowerCase()}`}
            style={{ "--rng-badge-index": index } as CSSProperties}
          >
            <span className="rngdle-badge-emoji" aria-hidden="true">{badge.emoji}</span>
            <div className="rngdle-badge-copy">
              <div>
                <h3>{badge.label}</h3>
                <span>{badge.rarity.toUpperCase()}</span>
              </div>
              <p>{badge.desc}</p>
            </div>
            <strong className={badge.ep === 0 ? "rngdle-badge-ep--superseded" : undefined}>
              {badge.ep === 0 ? "0" : `+${badge.ep.toLocaleString()}`} EP
            </strong>
          </article>
        ))}
      </div>
    </section>
  );
}
