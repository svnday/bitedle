"use client";

import dynamic from "next/dynamic";
import { BITEFIGHT_MAX_HEALTH } from "@/lib/bitefight-constants";
import type { BitefightPlayer } from "@/lib/types";

const BitefightStage3D = dynamic(() => import("./BitefightStage3D"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center bg-[radial-gradient(circle_at_50%_15%,#293340_0,#10151d_64%)] text-[10px] font-black tracking-[0.28em] text-white/30 uppercase">
      Building the ring
    </div>
  ),
});

function healthColor(health: number): string {
  if (health <= 24) return "from-red-500 to-red-700";
  if (health <= 49) return "from-amber-300 to-amber-600";
  return "from-lime-300 to-green-600";
}

function FighterHud({
  player,
  side,
  me,
}: {
  player: BitefightPlayer;
  side: "left" | "right";
  me: boolean;
}) {
  const healthPct = Math.max(
    0,
    Math.min(100, (player.health / BITEFIGHT_MAX_HEALTH) * 100),
  );
  return (
    <div className="min-w-0 flex-1">
      <div
        className={`mb-2 flex items-center gap-2 ${
          side === "right" ? "flex-row-reverse" : ""
        }`}
      >
        {player.discordAvatarUrl ? (
          // Discord avatar URLs are already tiny CDN renditions.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={player.discordAvatarUrl}
            alt=""
            className={`size-9 rounded-full border-2 object-cover ${
              side === "left" ? "border-cyan-400" : "border-red-400"
            }`}
          />
        ) : (
          <span
            className={`bg-raised grid size-9 place-items-center rounded-full border-2 font-black ${
              side === "left" ? "border-cyan-400" : "border-red-400"
            }`}
          >
            {player.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className={`min-w-0 ${side === "right" ? "text-right" : ""}`}>
          <div className="truncate text-sm font-extrabold sm:text-base">
            {player.name}
            {me ? " (you)" : ""}
          </div>
        </div>
      </div>
      <div className="border-tileborder bg-surface h-5 overflow-hidden rounded-full border p-0.5 shadow-inner">
        <div
          className={`h-full rounded-full bg-gradient-to-b shadow-[inset_0_1px_0_rgb(255_255_255/0.36)] transition-[width,background-color] duration-200 motion-reduce:transition-none ${healthColor(
            player.health,
          )}`}
          style={{ width: `${healthPct}%` }}
        />
      </div>
      <div
        className={`mt-1 text-xs font-black tabular-nums ${
          side === "right" ? "text-right" : ""
        }`}
      >
        {player.health} HP
      </div>
    </div>
  );
}

export default function BitefightArena({
  players,
  meDiscordUserId,
  winnerDiscordUserId,
  hitPlayerId,
  onPunch,
}: {
  players: [BitefightPlayer, BitefightPlayer];
  meDiscordUserId: string;
  winnerDiscordUserId: string | null;
  hitPlayerId: string | null;
  onPunch?: () => void;
}) {
  return (
    <section
      className={`border-tileborder bg-raised relative overflow-hidden rounded-2xl border ${
        onPunch ? "cursor-crosshair select-none" : ""
      }`}
      onClick={onPunch}
      aria-label={onPunch ? "Fight arena. Click or tap to punch." : "Fight arena"}
    >
      <div className="relative z-20 flex items-start gap-2 border-b border-white/10 bg-[#17191e]/95 px-3 py-3 shadow-lg sm:gap-5 sm:px-5">
        {players.map((player, index) => (
          <FighterHud
            key={player.discordUserId}
            player={player}
            side={index === 0 ? "left" : "right"}
            me={player.discordUserId === meDiscordUserId}
          />
        ))}
        <div className="absolute top-1/2 left-1/2 grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/55 text-sm font-black italic text-white/45 shadow-xl">
          VS
        </div>
      </div>
      <div className="relative h-[300px] overflow-hidden sm:h-[370px]">
        <BitefightStage3D
          players={players}
          winnerDiscordUserId={winnerDiscordUserId}
          hitPlayerId={hitPlayerId}
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-black/30 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/50 to-transparent" />
      </div>
      {onPunch && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 text-center">
          <span className="rounded-full border border-white/10 bg-black/55 px-3 py-1.5 text-[10px] font-black tracking-[0.22em] text-white/70 uppercase shadow-lg backdrop-blur-sm">
            Click or tap the ring to punch
          </span>
        </div>
      )}
      <span className="sr-only">
        A three-dimensional toy boxing ring with articulated blue and red robots.
      </span>
    </section>
  );
}
