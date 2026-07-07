"use client";

import { useEffect, useRef, useState } from "react";

function format(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

interface CountdownProps {
  /** Epoch ms of the next daily reset, as reported by the server. */
  target: number;
  onExpire?: () => void;
}

/** Ticks down to the next daily board; fires onExpire once when it arrives. */
export default function Countdown({ target, onExpire }: CountdownProps) {
  const [remaining, setRemaining] = useState(() => target - Date.now());
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
    const id = setInterval(() => {
      const ms = target - Date.now();
      setRemaining(ms);
      if (ms <= 0 && !firedRef.current) {
        firedRef.current = true;
        onExpire?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [target, onExpire]);

  return (
    <span className="font-mono text-xl font-semibold tabular-nums" suppressHydrationWarning>
      {format(remaining)}
    </span>
  );
}
