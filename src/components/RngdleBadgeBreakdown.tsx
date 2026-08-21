"use client";

import { useMemo } from "react";
import type { CSSProperties } from "react";
import {
  rngdleBadgeContributorIndexes,
  rngdleContributorMap,
} from "@/lib/rngdle/contributors";
import type { RngdleBadge } from "@/lib/rngdle/types";

export default function RngdleBadgeBreakdown({
  animate,
  badges,
  number,
  summaryVisible,
  visibleCount,
}: {
  animate: boolean;
  badges: RngdleBadge[];
  number: number;
  summaryVisible: boolean;
  visibleCount: number;
}) {
  const digits = [...String(number)];
  const contributorMap = useMemo(() => rngdleContributorMap(number), [number]);
  const visibleBadges = badges.slice(Math.max(0, badges.length - visibleCount));

  return (
    <section className="rngdle-badge-section" aria-labelledby="rngdle-badge-title">
      <div className="rngdle-section-heading">
        <h2 id="rngdle-badge-title">Badge Breakdown</h2>
        <span className={summaryVisible ? "rngdle-badge-summary--visible" : undefined}>
          {badges.length} badges earned
        </span>
      </div>
      <div className="rngdle-badge-list">
        {visibleBadges.map((badge) => {
          const contributorIndexes = rngdleBadgeContributorIndexes(
            badge,
            number,
            contributorMap,
          );
          const contributors = new Set(contributorIndexes);
          const contributorOrder = new Map(
            contributorIndexes.map((digitIndex, order) => [digitIndex, order]),
          );

          return (
            <article
              key={badge.id}
              data-badge-id={badge.id}
              className={`rngdle-badge rngdle-badge--${badge.rarity.toLowerCase()}${animate ? " rngdle-badge--entering" : ""}`}
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
                {digits.map((digit, digitIndex) => {
                  const active = contributors.has(digitIndex);
                  return (
                    <span
                      key={digitIndex}
                      className={active ? "rngdle-badge-digit--active" : undefined}
                      style={active
                        ? { "--rng-contributor-order": contributorOrder.get(digitIndex) ?? 0 } as CSSProperties
                        : undefined}
                    >
                      {digit}
                    </span>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
