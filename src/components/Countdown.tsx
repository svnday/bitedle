"use client";

import { useEffect, useRef, useState } from "react";

function msUntilMidnight(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

function format(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/** Ticking clock until the next daily board; fires onExpire once at midnight. */
export default function Countdown({ onExpire }: { onExpire?: () => void }) {
  const [remaining, setRemaining] = useState(msUntilMidnight());
  const prevRef = useRef(remaining);

  useEffect(() => {
    const id = setInterval(() => {
      const ms = msUntilMidnight();
      // The countdown only ever shrinks — a jump upward means we crossed midnight.
      if (ms > prevRef.current) onExpire?.();
      prevRef.current = ms;
      setRemaining(ms);
    }, 1000);
    return () => clearInterval(id);
  }, [onExpire]);

  return (
    <span className="font-mono text-xl font-semibold tabular-nums" suppressHydrationWarning>
      {format(remaining)}
    </span>
  );
}
