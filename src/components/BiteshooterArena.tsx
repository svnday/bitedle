"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BITESHOOTER_CANONICAL_OUTER_RADIUS,
  BITESHOOTER_INNER_RADIUS_RATIO,
  BITESHOOTER_MIDDLE_RADIUS_RATIO,
  BITESHOOTER_TARGET_EDGE_PADDING,
  BITESHOOTER_TARGET_OUTER_DIAMETER_DESKTOP,
  BITESHOOTER_TARGET_OUTER_DIAMETER_MOBILE,
} from "@/lib/biteshooter-constants";
import {
  classifyBiteshooterHit,
  damageForBiteshooterZone,
  targetFor,
  type BiteshooterZone,
} from "@/lib/biteshooter-targets";

interface ArenaSize {
  width: number;
  height: number;
}

interface Impact {
  id: number;
  x: number;
  y: number;
  zone: BiteshooterZone;
  damage: number;
}

export default function BiteshooterArena({
  active,
  showTarget = active,
  seed,
  targetIndex,
  onAttempt,
}: {
  active: boolean;
  showTarget?: boolean;
  seed: string;
  targetIndex: number;
  onAttempt: (
    zone: BiteshooterZone,
    damage: number,
    point: { x: number; y: number },
  ) => void;
}) {
  const arenaRef = useRef<HTMLDivElement>(null);
  const impactSequence = useRef(0);
  const [size, setSize] = useState<ArenaSize>({ width: 0, height: 0 });
  const [impact, setImpact] = useState<Impact | null>(null);

  useEffect(() => {
    const arena = arenaRef.current;
    if (!arena) return;
    const measure = () => {
      const rect = arena.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(arena);
    return () => observer.disconnect();
  }, []);

  const diameter =
    size.width < 640
      ? BITESHOOTER_TARGET_OUTER_DIAMETER_MOBILE
      : BITESHOOTER_TARGET_OUTER_DIAMETER_DESKTOP;
  const radius = diameter / 2;
  const margin = radius + BITESHOOTER_TARGET_EDGE_PADDING;
  const usableWidth = Math.max(0, size.width - margin * 2);
  const usableHeight = Math.max(0, size.height - margin * 2);
  const target = targetFor(seed, targetIndex);
  const centerX = margin + target.x * usableWidth;
  const centerY = margin + target.y * usableHeight;
  const arenaReady = usableWidth > 0 && usableHeight > 0;

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!active || !arenaReady || !event.isPrimary || event.button !== 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const zone = classifyBiteshooterHit(Math.hypot(x - centerX, y - centerY), radius);
      const damage = damageForBiteshooterZone(zone);
      impactSequence.current += 1;
      setImpact({ id: impactSequence.current, x, y, zone, damage });
      onAttempt(zone, damage, {
        x: target.x + ((x - centerX) / radius) * BITESHOOTER_CANONICAL_OUTER_RADIUS,
        y: target.y + ((y - centerY) / radius) * BITESHOOTER_CANONICAL_OUTER_RADIUS,
      });
    },
    [
      active,
      arenaReady,
      centerX,
      centerY,
      onAttempt,
      radius,
      target.x,
      target.y,
    ],
  );

  return (
    <div
      ref={arenaRef}
      data-testid="biteshooter-arena"
      onPointerDown={handlePointerDown}
      className={`border-tileborder relative min-h-[340px] flex-1 overflow-hidden rounded-2xl border bg-[radial-gradient(circle_at_center,#25272d_0%,#191a1e_58%,#141416_100%)] shadow-inner sm:min-h-[440px] ${
        active ? "cursor-crosshair touch-none select-none" : ""
      }`}
      aria-label="Biteshooter target range"
    >
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgb(255_255_255/0.035)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.035)_1px,transparent_1px)] [background-size:32px_32px]" />

      {!arenaReady && (
        <div className="text-muted absolute inset-0 grid place-items-center px-6 text-center text-sm">
          Make the window a little larger to load the target range.
        </div>
      )}

      {showTarget && arenaReady && (
        <div
          key={`${seed}:${targetIndex}`}
          data-testid="biteshooter-target"
          className="animate-pop motion-reduce:animate-none pointer-events-none absolute rounded-full bg-[#d84b45] shadow-[0_0_0_3px_rgb(255_255_255/0.12),0_12px_30px_rgb(0_0_0/0.45)]"
          style={{
            width: diameter,
            height: diameter,
            left: centerX - radius,
            top: centerY - radius,
          }}
        >
          <span
            className="absolute top-1/2 left-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[#f0c94f] text-[9px] font-black text-black"
            style={{
              width: `${BITESHOOTER_MIDDLE_RADIUS_RATIO * 100}%`,
              height: `${BITESHOOTER_MIDDLE_RADIUS_RATIO * 100}%`,
            }}
          >
            <span
              className="grid place-items-center rounded-full bg-[#f7f3e8] text-[9px] font-black text-[#171717]"
              style={{
                width: `${(BITESHOOTER_INNER_RADIUS_RATIO / BITESHOOTER_MIDDLE_RADIUS_RATIO) * 100}%`,
                height: `${(BITESHOOTER_INNER_RADIUS_RATIO / BITESHOOTER_MIDDLE_RADIUS_RATIO) * 100}%`,
              }}
            >
              3
            </span>
          </span>
        </div>
      )}

      {impact && (
        <span
          key={impact.id}
          className={`animate-rise motion-reduce:animate-none pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 text-sm font-black drop-shadow ${
            impact.zone === "miss" ? "text-miss" : "text-white"
          }`}
          style={{ left: impact.x, top: impact.y }}
        >
          {impact.zone === "miss" ? "MISS" : `-${impact.damage}`}
        </span>
      )}

      <div className="pointer-events-none absolute right-3 bottom-3 flex gap-2 text-[10px] font-black">
        <span className="rounded-full bg-[#f7f3e8] px-2 py-1 text-black">3 HP</span>
        <span className="rounded-full bg-[#f0c94f] px-2 py-1 text-black">2 HP</span>
        <span className="rounded-full bg-[#d84b45] px-2 py-1 text-white">1 HP</span>
      </div>
    </div>
  );
}
