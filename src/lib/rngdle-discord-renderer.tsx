import { ImageResponse } from "next/og";
import sharp from "sharp";
import type { RngdleLeaderboardEntry, RngdleUserProfile } from "./rngdle-discord-store";
import { rngdleBadgeRevealOffsets, rngdleDigitRevealOffsets } from "./rngdle/reveal";
import type { RngdleBadge, RngdleBadgeRarity, RngdleResult } from "./rngdle/types";

export const RNGDLE_DISCORD_WIDTH = 900;
export const RNGDLE_DISCORD_HEIGHT = 700;
export const RNGDLE_DISCORD_RESULT_WIDTH = 1200;
export const RNGDLE_DISCORD_RESULT_HEIGHT = 760;
export const RNGDLE_DISCORD_PROFILE_WIDTH = 1200;
export const RNGDLE_DISCORD_PROFILE_HEIGHT = 700;
export const RNGDLE_DISCORD_LEADERBOARD_WIDTH = 1200;
export const RNGDLE_DISCORD_LEADERBOARD_HEIGHT = 790;
export const RNGDLE_DISCORD_GIF_FILENAME = "rngdle-roll.gif";
export const RNGDLE_DISCORD_PNG_FILENAME = "rngdle-result.png";
export const RNGDLE_DISCORD_LEADERBOARD_FILENAME = "rngdle-leaderboard.png";
export const RNGDLE_DISCORD_PROFILE_FILENAME = "rngdle-profile.png";

const RARITY_COLORS: Record<RngdleBadgeRarity | RngdleResult["rarity"], string> = {
  Common: "#d9dde7",
  Uncommon: "#34e2ad",
  Rare: "#35a7ff",
  Epic: "#ba72ff",
  Anomaly: "#ff4ea3",
  Mythic: "#ffbe2e",
  trash: "#7d8290",
  common: "#d9dde7",
  uncommon: "#34e2ad",
  rare: "#35a7ff",
  epic: "#ba72ff",
  anomaly: "#ff4ea3",
  mythic: "#ffbe2e",
};

const ROLL_THEMES: Record<RngdleResult["rarity"], { primary: string; from: string; to: string }> = {
  trash: { primary: "#60718e", from: "#0b111a", to: "#25334a" },
  common: { primary: "#d9dde7", from: "#10131a", to: "#2b2d38" },
  uncommon: { primary: "#34e2ad", from: "#061a16", to: "#124536" },
  rare: { primary: "#35a7ff", from: "#07192b", to: "#124674" },
  epic: { primary: "#9f78ff", from: "#0c0920", to: "#42167e" },
  anomaly: { primary: "#ff4ea3", from: "#200716", to: "#741541" },
  mythic: { primary: "#ffc04a", from: "#251604", to: "#693907" },
};

interface RngdleAnimationFrame {
  delay: number;
  digits: string;
  lockedDigits: number;
  badge: RngdleBadge | null;
  badgeIndex: number;
  badgeCount: number;
  earnedEp: number;
  phase: "rolling" | "number" | "rarity" | "badge" | "complete";
}

export interface RngdleDiscordAssets {
  animation: Buffer;
  still: Buffer;
  durationMs: number;
}

function formatEp(value: number): string {
  return value.toLocaleString("en-US");
}

function clipped(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function numberDigits(number: number): string {
  return String(number).padStart(6, "0");
}

function pseudoDigits(number: number, frame: number): string {
  let seed = (number + 1) * (frame + 17);
  return Array.from({ length: numberDigits(number).length }, (_, index) => {
    seed = (seed * 1_664_525 + 1_013_904_223 + index) >>> 0;
    return String(seed % 10);
  }).join("");
}

function animationFrames(result: RngdleResult): RngdleAnimationFrame[] {
  const frames: RngdleAnimationFrame[] = [];
  for (let index = 0; index < 5; index += 1) {
    frames.push({
      delay: 400,
      digits: pseudoDigits(result.number, index),
      lockedDigits: 0,
      badge: null,
      badgeIndex: 0,
      badgeCount: result.badges.length,
      earnedEp: 0,
      phase: "rolling",
    });
  }

  const finalDigits = numberDigits(result.number);
  const digitOffsets = rngdleDigitRevealOffsets(result.number);
  for (let index = 0; index < finalDigits.length; index += 1) {
    const nextOffset = digitOffsets[index + 1];
    frames.push({
      delay: nextOffset === undefined ? 900 : Math.round(Math.max(200, nextOffset - digitOffsets[index]) / 10) * 10,
      digits: finalDigits.slice(0, index + 1) + pseudoDigits(result.number, index + 8).slice(index + 1),
      lockedDigits: index + 1,
      badge: null,
      badgeIndex: 0,
      badgeCount: result.badges.length,
      earnedEp: 0,
      phase: "number",
    });
  }

  frames.push({
    delay: 900,
    digits: finalDigits,
    lockedDigits: finalDigits.length,
    badge: null,
    badgeIndex: 0,
    badgeCount: result.badges.length,
    earnedEp: 0,
    phase: "rarity",
  });

  const revealBadges = result.badges.slice().reverse();
  const offsets = rngdleBadgeRevealOffsets(revealBadges.length);
  let earnedEp = 0;
  revealBadges.forEach((badge, index) => {
    earnedEp += badge.ep;
    const nextOffset = offsets[index + 1];
    frames.push({
      delay: nextOffset === undefined ? 1_400 : Math.round(Math.max(500, nextOffset - offsets[index]) / 10) * 10,
      digits: finalDigits,
      lockedDigits: finalDigits.length,
      badge,
      badgeIndex: index + 1,
      badgeCount: revealBadges.length,
      earnedEp,
      phase: "badge",
    });
  });

  frames.push({
    delay: 1_500,
    digits: finalDigits,
    lockedDigits: finalDigits.length,
    badge: null,
    badgeIndex: revealBadges.length,
    badgeCount: revealBadges.length,
    earnedEp: result.rawEp,
    phase: "complete",
  });
  return frames;
}

function shell(children: React.ReactNode) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        overflow: "hidden",
        color: "#f5f5f8",
        background: "linear-gradient(145deg, #0d0c13 0%, #121119 58%, #09080e 100%)",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ position: "absolute", width: 420, height: 420, left: -210, top: -220, borderRadius: 9999, background: "rgba(87,45,135,.16)", filter: "blur(2px)", display: "flex" }} />
      <div style={{ position: "absolute", width: 420, height: 420, right: -240, bottom: -250, borderRadius: 9999, background: "rgba(0,178,255,.10)", display: "flex" }} />
      {children}
    </div>
  );
}

function Header({ subtitle }: { subtitle: string }) {
  return (
    <div style={{ position: "absolute", left: 48, top: 34, width: 804, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 11 }}>
        <div style={{ fontSize: 30, fontWeight: 950, letterSpacing: 3 }}>RNGDLE</div>
        <div style={{ fontSize: 11, fontWeight: 800, color: "#777583", letterSpacing: 2 }}>ONE ROLL. ONE NUMBER.</div>
      </div>
      <div style={{ fontSize: 11, fontWeight: 800, color: "#9c99a8", letterSpacing: 1.8, display: "flex" }}>{subtitle}</div>
    </div>
  );
}

function NumberReel({ digits, lockedDigits, result }: { digits: string; lockedDigits: number; result: RngdleResult }) {
  const color = RARITY_COLORS[result.rarity];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ display: "flex", gap: 8, padding: "17px 20px", borderRadius: 16, border: `2px solid ${lockedDigits === digits.length ? color : "#555460"}`, background: "linear-gradient(180deg, #37363d, #242329)", boxShadow: lockedDigits === digits.length ? `0 0 24px ${color}2e` : "0 16px 34px rgba(0,0,0,.35)" }}>
        {[...digits].map((digit, index) => (
          <div key={index} style={{ width: 58, height: 70, borderRadius: 8, border: `1px solid ${index < lockedDigits ? color : "#494852"}`, background: index < lockedDigits ? "#17161d" : "#2a2931", color: index < lockedDigits ? "#f7f7fa" : "#aaa8b0", fontFamily: "monospace", fontSize: 48, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {digit}
          </div>
        ))}
      </div>
    </div>
  );
}

function RarityLine({ result }: { result: RngdleResult }) {
  const color = RARITY_COLORS[result.rarity];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 15 }}>
      <div style={{ padding: "4px 9px", border: `1px solid ${color}`, borderRadius: 4, color, fontSize: 13, fontWeight: 900, letterSpacing: 1.2, display: "flex" }}>{result.rarityLabel}</div>
      <div style={{ width: 4, height: 4, borderRadius: 99, backgroundColor: "#686671", display: "flex" }} />
      <div style={{ color: result.rarity === "trash" || result.rarity === "common" ? "#ff7b22" : color, fontSize: 14, fontWeight: 850, textTransform: "uppercase", display: "flex" }}>{result.rarityBand}</div>
    </div>
  );
}

function BadgeSpotlight({ badge, index, count, earnedEp }: { badge: RngdleBadge; index: number; count: number; earnedEp: number }) {
  const color = RARITY_COLORS[badge.rarity];
  return (
    <div style={{ width: 780, height: 236, marginTop: 38, borderRadius: 13, border: `1px solid ${color}88`, background: "#24232b", boxShadow: `0 0 26px ${color}20`, padding: "24px 28px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: 10, background: `${color}20`, border: `1px solid ${color}75`, color, fontSize: 21, fontWeight: 950, display: "flex", alignItems: "center", justifyContent: "center" }}>{badge.label.slice(0, 1).toUpperCase()}</div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 23, fontWeight: 900, display: "flex" }}>{clipped(badge.label.toUpperCase(), 34)}</div>
              <div style={{ padding: "4px 8px", border: `1px solid ${color}`, borderRadius: 4, color, fontSize: 11, fontWeight: 900, letterSpacing: 1, display: "flex" }}>{badge.rarity.toUpperCase()}</div>
            </div>
            <div style={{ marginTop: 8, color: "#aaa7b3", fontSize: 16, textTransform: "uppercase", display: "flex" }}>{clipped(badge.desc, 78)}</div>
          </div>
        </div>
        <div style={{ border: `1px solid ${color}8c`, borderRadius: 999, padding: "7px 13px", color, background: `${color}0f`, fontFamily: "monospace", fontSize: 18, fontWeight: 900, display: "flex" }}>+{formatEp(badge.ep)} EP</div>
      </div>
      <div style={{ height: 1, backgroundColor: "#3b3943", display: "flex" }} />
      <div style={{ display: "flex", justifyContent: "space-between", color: "#83808d", fontSize: 12, fontWeight: 800, letterSpacing: 1.3 }}>
        <div style={{ display: "flex" }}>BADGE {index} OF {count}</div>
        <div style={{ display: "flex" }}>{formatEp(earnedEp)} EP REVEALED</div>
      </div>
    </div>
  );
}

function animationImage(result: RngdleResult, frame: RngdleAnimationFrame) {
  const status = frame.phase === "rolling" ? "ROLLING" : frame.phase === "number" ? "LOCKING DIGITS" : frame.phase === "badge" ? "BADGE REVEAL" : frame.phase === "complete" ? "ROLL COMPLETE" : "RARITY FOUND";
  return shell(
    <>
      <Header subtitle={status} />
      <div style={{ position: "absolute", left: 0, width: 900, top: 104, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <NumberReel digits={frame.digits} lockedDigits={frame.lockedDigits} result={result} />
        {frame.phase !== "rolling" && frame.phase !== "number" ? <RarityLine result={result} /> : null}
        {frame.badge ? (
          <BadgeSpotlight badge={frame.badge} index={frame.badgeIndex} count={frame.badgeCount} earnedEp={frame.earnedEp} />
        ) : frame.phase === "complete" ? (
          <div style={{ marginTop: 48, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ color: "#92909c", fontSize: 13, fontWeight: 850, letterSpacing: 2 }}>TOTAL ROLL VALUE</div>
            <div style={{ marginTop: 8, fontFamily: "monospace", fontSize: 47, fontWeight: 950, display: "flex" }}>{formatEp(result.creditedEp)} EP</div>
            {result.penaltyPercent ? <div style={{ marginTop: 9, color: "#ff6767", fontSize: 15, fontWeight: 850, display: "flex" }}>{result.penaltyPercent}% REROLL RISK APPLIED · {formatEp(result.rawEp)} RAW EP</div> : null}
            <div style={{ marginTop: 16, color: "#aaa7b3", fontSize: 14, display: "flex" }}>{result.badges.length} BADGES EARNED</div>
          </div>
        ) : (
          <div style={{ marginTop: 70, color: "#777481", fontSize: 14, fontWeight: 850, letterSpacing: 2, display: "flex" }}>{frame.phase === "rarity" ? "CALCULATING BADGES…" : "REELS ARE SPINNING…"}</div>
        )}
      </div>
      <div style={{ position: "absolute", left: 48, width: 804, bottom: 31, display: "flex", justifyContent: "space-between", color: "#625f6c", fontSize: 10, fontWeight: 800, letterSpacing: 1.5 }}>
        <div>BITEDLE LABS</div><div>SCORING BY RNGDLE</div>
      </div>
    </>,
  );
}

function GridBackdrop({ from, to }: { from: string; to: string }) {
  return (
    <>
      <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", background: `linear-gradient(112deg, ${from} 0%, #12111d 46%, ${to} 100%)`, display: "flex" }} />
      {Array.from({ length: 13 }, (_, index) => (
        <div key={`v-${index}`} style={{ position: "absolute", left: index * 100, top: 0, width: 1, height: "100%", backgroundColor: "rgba(141,151,190,.08)", display: "flex" }} />
      ))}
      {Array.from({ length: 9 }, (_, index) => (
        <div key={`h-${index}`} style={{ position: "absolute", left: 0, top: index * 88, width: "100%", height: 1, backgroundColor: "rgba(141,151,190,.08)", display: "flex" }} />
      ))}
      {[
        [785, 17], [582, 83], [371, 109], [968, 3], [452, 522], [1014, 451], [223, 624], [33, 592],
      ].map(([left, top], index) => (
        <div key={`s-${index}`} style={{ position: "absolute", left, top, width: index % 3 === 0 ? 3 : 2, height: index % 3 === 0 ? 3 : 2, borderRadius: 99, backgroundColor: "rgba(214,218,241,.24)", display: "flex" }} />
      ))}
    </>
  );
}

function referenceShell(children: React.ReactNode, from: string, to: string) {
  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", color: "#f6f5fa", backgroundColor: "#0d0c14", fontFamily: "sans-serif", display: "flex" }}>
      <GridBackdrop from={from} to={to} />
      {children}
    </div>
  );
}

function compactResultBadge(badge: RngdleBadge) {
  const color = RARITY_COLORS[badge.rarity];
  return (
    <div key={badge.id} style={{ width: 190, height: 42, borderRadius: 15, border: `1px solid ${color}70`, background: `${color}0d`, padding: "6px 11px", display: "flex", flexDirection: "column" }}>
      <div style={{ width: "100%", display: "flex", justifyContent: "space-between" }}>
        <div style={{ fontSize: 11.5, fontWeight: 900, display: "flex" }}>{clipped(badge.label, 20)}</div>
        <div style={{ color, fontFamily: "monospace", fontSize: 9, fontWeight: 900, display: "flex" }}>+{formatEp(badge.ep)} POINTS</div>
      </div>
      <div style={{ marginTop: 4, color: "#8e91a5", fontSize: 8.5, display: "flex" }}>{clipped(badge.desc, 34)}</div>
    </div>
  );
}

export interface RngdleResultCardStats {
  gameDay: string;
  nextResetAt: number;
  now: number;
  currentStreak: number;
  careerEp: number;
  newBadges: number;
}

function formatDropCountdown(nextResetAt: number, now: number): string {
  const totalMinutes = Math.max(0, Math.ceil((nextResetAt - now) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function resultImage(
  result: RngdleResult,
  playerName: string,
  rank: number,
  playerCount: number,
  stats: RngdleResultCardStats,
) {
  const visible = result.badges.slice(0, 15);
  const theme = ROLL_THEMES[result.rarity];
  const color = theme.primary;
  return referenceShell(
    <>
      <div style={{ position: "absolute", left: 62, top: 45, display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 27, fontWeight: 950, letterSpacing: 1, display: "flex" }}>RNGDLE</div>
        <div style={{ marginTop: 9, color: "#858aa4", fontSize: 15, fontWeight: 800, letterSpacing: .5, display: "flex" }}>ONE ROLL. ONE NUMBER. EVERY DAY.</div>
      </div>
      <div style={{ position: "absolute", left: 920, top: 51, width: 218, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <div style={{ color: "#aeb0c6", fontSize: 14, fontWeight: 850, fontFamily: "monospace", display: "flex" }}>{stats.gameDay}</div>
        <div style={{ marginTop: 12, fontSize: 15, fontWeight: 900, display: "flex" }}>NEXT DROP IN {formatDropCountdown(stats.nextResetAt, stats.now)}</div>
      </div>
      <div style={{ position: "absolute", left: 55, top: 132, width: 1090, height: 330, borderRadius: 30, border: `1px solid ${color}42`, background: "linear-gradient(110deg, rgba(8,8,16,.94), rgba(24,10,48,.82))", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color, fontFamily: "monospace", fontSize: 126, fontWeight: 950, lineHeight: 1, textShadow: `0 0 32px ${color}55`, display: "flex" }}>{result.number}</div>
        <div style={{ marginTop: 18, padding: "7px 20px", borderRadius: 999, border: `1px solid ${color}`, color, backgroundColor: `${color}18`, fontSize: 15, fontWeight: 900, display: "flex" }}>{result.rarityLabel}</div>
        <div style={{ marginTop: 17, fontFamily: "monospace", fontSize: 34, fontWeight: 950, display: "flex" }}>{formatEp(result.creditedEp)} POINTS</div>
        {result.penaltyPercent !== null ? (
          <div style={{ marginTop: 7, color: "#ff738c", fontSize: 12, fontWeight: 850, display: "flex" }}>REROLL · -{result.penaltyPercent}% RISK · {formatEp(result.rawEp)} RAW POINTS</div>
        ) : null}
      </div>
      <div style={{ position: "absolute", left: 62, top: 478, width: 1076, display: "flex", flexWrap: "wrap", gap: 7 }}>
        {visible.map(compactResultBadge)}
      </div>
      <div style={{ position: "absolute", left: 62, bottom: 25, width: 1076, display: "flex", justifyContent: "space-between" }}>
        {[
          [clipped(playerName, 24), "TODAY'S ROLLER"],
          [`#${rank} / ${playerCount}`, "TODAY"],
          [`${stats.currentStreak} ${stats.currentStreak === 1 ? "DAY" : "DAYS"}`, "STREAK"],
          [formatEp(stats.careerEp), "CAREER POINTS"],
        ].map(([value, label]) => (
          <div key={label} style={{ width: 230, display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 20, fontWeight: 950, fontFamily: "monospace", display: "flex" }}>{value}</div>
            <div style={{ marginTop: 10, color: "#727990", fontSize: 13, display: "flex" }}>{label}</div>
          </div>
        ))}
      </div>
    </>,
    theme.from,
    theme.to,
  );
}

function profileRollCard(
  title: string,
  roll: RngdleUserProfile["top"] | null,
  accent: string,
  footer: string,
) {
  return (
    <div style={{ width: 350, height: 270, padding: "22px 24px", borderRadius: 24, border: `1px solid ${accent}aa`, background: "rgba(10,10,17,.82)", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ width: 300, color: "#8090aa", fontSize: 13, fontWeight: 850, display: "flex" }}>{title}</div>
      {roll ? (
        <div style={{ width: 300, height: 210, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ width: 300, marginTop: 38, color: accent, fontFamily: "monospace", fontSize: 56, fontWeight: 950, lineHeight: 1, display: "flex", justifyContent: "center" }}>{roll.result.number}</div>
          <div style={{ width: 300, marginTop: 17, fontFamily: "monospace", fontSize: 19, fontWeight: 950, display: "flex", justifyContent: "center" }}>{formatEp(roll.result.creditedEp)} POINTS</div>
          <div style={{ width: 300, marginTop: 11, color: accent, fontSize: 12, fontWeight: 900, display: "flex", justifyContent: "center" }}>{roll.result.rarityLabel}</div>
          {roll.result.penaltyPercent !== null ? <div style={{ width: 300, marginTop: 7, color: "#a8afbf", fontSize: 8.5, fontWeight: 850, display: "flex", justifyContent: "center" }}>REROLL · -{roll.result.penaltyPercent}% · {formatEp(roll.result.rawEp)} RAW</div> : null}
          <div style={{ width: 300, marginTop: "auto", color: "#65718a", fontSize: 9.5, fontFamily: "monospace", display: "flex", justifyContent: "center" }}>{footer}</div>
        </div>
      ) : (
        <div style={{ marginTop: 88, color: "#596277", fontSize: 20, fontWeight: 850, display: "flex" }}>NO ROLL TODAY</div>
      )}
    </div>
  );
}

function profileImage(profile: RngdleUserProfile, avatarDataUrl?: string | null) {
  const initials = profile.displayName.slice(0, 2).toUpperCase();
  const profileTheme = ROLL_THEMES[profile.top.result.rarity];
  return referenceShell(
    <>
      <div style={{ position: "absolute", left: 58, top: 40, display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 25, fontWeight: 950, display: "flex" }}>RNGDLE</div>
        <div style={{ marginTop: 10, color: "#8090aa", fontSize: 15, fontWeight: 850, display: "flex" }}>PLAYER PROFILE</div>
      </div>
      <div style={{ position: "absolute", left: 850, top: 30, width: 296, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 18 }}>
        <div style={{ fontSize: 31, fontWeight: 950, display: "flex" }}>{clipped(profile.displayName, 24)}</div>
        <div style={{ width: 74, height: 74, borderRadius: 999, border: `3px solid ${profileTheme.primary}`, backgroundColor: `${profileTheme.primary}22`, ...(avatarDataUrl ? { backgroundImage: `url("${avatarDataUrl}")`, backgroundPosition: "center", backgroundSize: "cover" } : {}), color: profileTheme.primary, fontSize: 22, fontWeight: 950, display: "flex", alignItems: "center", justifyContent: "center" }}>{avatarDataUrl ? "" : initials}</div>
      </div>
      <div style={{ position: "absolute", left: 51, top: 124, width: 1098, display: "flex", gap: 22 }}>
        {profileRollCard("TODAY'S ROLL", profile.today, profile.today ? ROLL_THEMES[profile.today.result.rarity].primary : "#45506a", "TODAY'S RESULT")}
        {profileRollCard("TOP ROLL", profile.top, ROLL_THEMES[profile.top.result.rarity].primary, `ROLLED ${profile.top.gameDay}`)}
        {profileRollCard("WORST ROLL", profile.worst, ROLL_THEMES[profile.worst.result.rarity].primary, `ROLLED ${profile.worst.gameDay}`)}
      </div>
      <div style={{ position: "absolute", left: 51, top: 417, width: 1098, display: "flex", gap: 9 }}>
        {[
          [`#${profile.allTimeRank} / ${profile.totalPlayers}`, "ALL-TIME RANK"],
          [String(profile.games), "GAMES"],
          [formatEp(profile.careerEp), "CAREER POINTS"],
          [String(profile.currentStreak), "CURRENT STREAK"],
          [`${profile.uniqueBadges} / ${profile.totalBadges}`, "UNIQUE PATTERNS"],
          [`${profile.rerollDeltaEp >= 0 ? "+" : ""}${formatEp(profile.rerollDeltaEp)}`, "REROLL P&L"],
        ].map(([value, label]) => (
          <div key={label} style={{ width: 175, height: 96, borderRadius: 18, border: `1px solid ${profileTheme.primary}35`, background: `${profileTheme.primary}0d`, padding: "19px 17px", display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: "monospace", fontSize: 20, fontWeight: 950, display: "flex" }}>{value}</div>
            <div style={{ marginTop: 15, color: "#7b879f", fontSize: 11, display: "flex" }}>{label}</div>
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 58, top: 548, color: "#8190a7", fontSize: 13, fontWeight: 850, display: "flex" }}>RAREST FINDS</div>
      <div style={{ position: "absolute", left: 57, top: 577, width: 1086, display: "flex", gap: 9 }}>
        {profile.rarestBadges.map((badge) => (
          <div key={badge.id} style={{ width: 208, height: 76, borderRadius: 17, border: `1px solid ${profileTheme.primary}aa`, background: "rgba(18,18,22,.85)", padding: "10px 16px", display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 15, fontWeight: 900, display: "flex" }}>{clipped(badge.label, 22)}</div>
            <div style={{ marginTop: 7, color: "#929aab", fontSize: 9.5, display: "flex" }}>{clipped(badge.desc, 31)}</div>
            <div style={{ marginTop: "auto", color: profileTheme.primary, fontFamily: "monospace", fontSize: 9, fontWeight: 900, display: "flex" }}>+{formatEp(badge.ep)} POINTS</div>
          </div>
        ))}
      </div>
    </>,
    profileTheme.from,
    profileTheme.to,
  );
}

function leaderboardImage(entries: RngdleLeaderboardEntry[]) {
  return referenceShell(
    <>
      <div style={{ position: "absolute", left: 58, top: 42, display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 27, fontWeight: 950, display: "flex" }}>RNGDLE</div>
        <div style={{ marginTop: 17, fontSize: 37, fontWeight: 950, display: "flex" }}>ALL-TIME LEADERBOARD</div>
        <div style={{ marginTop: 8, color: "#7f8ca5", fontSize: 15, display: "flex" }}>{entries.length} PLAYERS · CAREER POINTS</div>
      </div>
      <div style={{ position: "absolute", left: 51, top: 187, width: 1098, display: "flex", flexDirection: "column", gap: 8 }}>
        {entries.slice(0, 10).map((entry, index) => {
          const accent = ROLL_THEMES[entry.bestRarity].primary;
          const rankColor = index === 0 ? "#ffd02e" : index === 1 ? "#dce5ef" : index === 2 ? "#ff8735" : "#718098";
          return (
            <div key={entry.userId} style={{ width: 1098, height: 47, borderRadius: 14, border: `1px solid ${accent}88`, background: "linear-gradient(90deg, rgba(24,33,42,.88), rgba(47,30,73,.62))", display: "flex", alignItems: "center" }}>
              <div style={{ width: 92, paddingLeft: 19, color: rankColor, fontFamily: "monospace", fontSize: 17, fontWeight: 950, display: "flex" }}>#{index + 1}</div>
              <div style={{ width: 355, fontSize: 17, fontWeight: 900, display: "flex" }}>{clipped(entry.displayName, 32)}</div>
              <div style={{ width: 220, color: accent, fontFamily: "monospace", fontSize: 15, fontWeight: 950, display: "flex" }}>{entry.rolls} GAMES</div>
              <div style={{ width: 250, display: "flex", flexDirection: "column" }}>
                <div style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 900, display: "flex" }}>BEST {entry.bestNumber}</div>
                <div style={{ marginTop: 3, color: index >= 7 ? accent : "#aab0c1", fontFamily: "monospace", fontSize: 8.5, display: "flex" }}>{formatEp(entry.bestEp)} PTS{entry.bestPenaltyPercent === null ? "" : ` · -${entry.bestPenaltyPercent}%`}</div>
              </div>
              <div style={{ flex: 1, paddingRight: 24, justifyContent: "flex-end", fontFamily: "monospace", fontSize: 17, fontWeight: 950, display: "flex" }}>{formatEp(entry.totalEp)} POINTS</div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 58, bottom: 37, color: "#718098", fontSize: 13, display: "flex" }}>Ranked by total career points</div>
      <div style={{ position: "absolute", left: 900, width: 242, bottom: 37, color: "#718098", fontSize: 13, justifyContent: "flex-end", display: "flex" }}>Daily play builds your all-time total</div>
    </>,
    "#0b2837",
    "#3c1b70",
  );
}

async function render(
  element: React.ReactElement,
  width = RNGDLE_DISCORD_WIDTH,
  height = RNGDLE_DISCORD_HEIGHT,
): Promise<Buffer> {
  const response = new ImageResponse(element, { width, height });
  return Buffer.from(await response.arrayBuffer());
}

export function renderRngdleDiscordStill(
  result: RngdleResult,
  playerName: string,
  rank: number,
  playerCount: number,
  stats: RngdleResultCardStats,
): Promise<Buffer> {
  return render(
    resultImage(result, playerName, rank, playerCount, stats),
    RNGDLE_DISCORD_RESULT_WIDTH,
    RNGDLE_DISCORD_RESULT_HEIGHT,
  );
}

export function renderRngdleDiscordProfile(profile: RngdleUserProfile, avatarDataUrl?: string | null): Promise<Buffer> {
  return render(
    profileImage(profile, avatarDataUrl),
    RNGDLE_DISCORD_PROFILE_WIDTH,
    RNGDLE_DISCORD_PROFILE_HEIGHT,
  );
}

export function renderRngdleDiscordLeaderboard(entries: RngdleLeaderboardEntry[]): Promise<Buffer> {
  return render(
    leaderboardImage(entries),
    RNGDLE_DISCORD_LEADERBOARD_WIDTH,
    RNGDLE_DISCORD_LEADERBOARD_HEIGHT,
  );
}

export async function renderRngdleDiscordAssets(
  result: RngdleResult,
  playerName: string,
  rank: number,
  playerCount: number,
  stats: RngdleResultCardStats,
): Promise<RngdleDiscordAssets> {
  const frames = animationFrames(result);
  const framePngs = await Promise.all(frames.map((frame) => render(animationImage(result, frame))));
  const rawFrames = await Promise.all(framePngs.map(async (png) => {
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== RNGDLE_DISCORD_WIDTH || info.height !== RNGDLE_DISCORD_HEIGHT || info.channels !== 4) {
      throw new Error("RNGDLE frame rendered at an unexpected size.");
    }
    return data;
  }));
  const animation = await sharp(Buffer.concat(rawFrames), {
    raw: {
      width: RNGDLE_DISCORD_WIDTH,
      height: RNGDLE_DISCORD_HEIGHT * frames.length,
      channels: 4,
      pageHeight: RNGDLE_DISCORD_HEIGHT,
    },
  }).gif({ loop: 1, delay: frames.map((frame) => frame.delay), colours: 128, effort: 4 }).toBuffer();
  return {
    animation,
    still: await renderRngdleDiscordStill(result, playerName, rank, playerCount, stats),
    durationMs: frames.reduce((total, frame) => total + frame.delay, 0),
  };
}
