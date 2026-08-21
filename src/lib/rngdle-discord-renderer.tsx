import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import type { RngdleLeaderboardEntry, RngdleUserProfile } from "./rngdle-discord-store";
import type { RngdleBadge, RngdleResult } from "./rngdle/types";

// The roll animation shares the still's canvas so the GIF settles into the
// final card without the Discord embed reflowing.
export const RNGDLE_DISCORD_WIDTH = 1200;
export const RNGDLE_DISCORD_HEIGHT = 760;
export const RNGDLE_DISCORD_RISK_WIDTH = 900;
export const RNGDLE_DISCORD_RISK_HEIGHT = 700;
export const RNGDLE_DISCORD_RESULT_WIDTH = 1200;
export const RNGDLE_DISCORD_RESULT_HEIGHT = 760;
export const RNGDLE_DISCORD_PROFILE_WIDTH = 1200;
export const RNGDLE_DISCORD_PROFILE_HEIGHT = 700;
export const RNGDLE_DISCORD_LEADERBOARD_WIDTH = 1200;
export const RNGDLE_DISCORD_LEADERBOARD_HEIGHT = 790;
export const RNGDLE_DISCORD_GIF_FILENAME = "rngdle-roll.gif";
export const RNGDLE_DISCORD_RISK_GIF_FILENAME = "rngdle-reroll-risk.gif";
export const RNGDLE_DISCORD_PNG_FILENAME = "rngdle-result.png";
export const RNGDLE_DISCORD_LEADERBOARD_FILENAME = "rngdle-leaderboard.png";
export const RNGDLE_DISCORD_PROFILE_FILENAME = "rngdle-profile.png";

const ROLL_THEMES: Record<RngdleResult["rarity"], {
  primary: string;
  from: string;
  to: string;
  panelFrom: string;
  panelTo: string;
}> = {
  trash: { primary: "#6d7f9c", from: "#0a1420", to: "#33455e", panelFrom: "#080c12", panelTo: "#141b26" },
  common: { primary: "#e1e3ea", from: "#0d0e15", to: "#2c2e3c", panelFrom: "#08090e", panelTo: "#171821" },
  uncommon: { primary: "#34e2ad", from: "#08201a", to: "#1e5f47", panelFrom: "#071310", panelTo: "#102a21" },
  rare: { primary: "#35a7ff", from: "#082030", to: "#1d6099", panelFrom: "#071019", panelTo: "#0f2b46" },
  epic: { primary: "#9f78ff", from: "#130c2b", to: "#54309e", panelFrom: "#0a0816", panelTo: "#211540" },
  anomaly: { primary: "#ff4ea3", from: "#250a1b", to: "#872050", panelFrom: "#130710", panelTo: "#3a1324" },
  mythic: { primary: "#ffc04a", from: "#2a1a06", to: "#87590f", panelFrom: "#150f05", panelTo: "#3a280a" },
};

const FONT_ROOT = path.join(process.cwd(), "node_modules", "geist", "dist", "fonts");
const IMAGE_FONTS = Promise.all([
  readFile(path.join(FONT_ROOT, "geist-sans", "Geist-Regular.ttf")),
  readFile(path.join(FONT_ROOT, "geist-sans", "Geist-Bold.ttf")),
  readFile(path.join(FONT_ROOT, "geist-mono", "GeistMono-Regular.ttf")),
  readFile(path.join(FONT_ROOT, "geist-mono", "GeistMono-Bold.ttf")),
]);

interface RngdleAnimationFrame {
  delay: number;
  digits: string;
  lockedDigits: number;
  badge: RngdleBadge | null;
  badgeIndex: number;
  badgeCount: number;
  earnedEp: number;
  revealProgress: number;
  phase: "rolling" | "number" | "rarity" | "badge" | "complete";
}

interface RngdleRiskFrame {
  delay: number;
  percent: number;
  progress: number;
  locked: boolean;
  nearby: number[];
}

export interface RngdleDiscordAssets {
  animation: Buffer;
  still: Buffer;
  durationMs: number;
}

export interface RngdleRiskAnimation {
  animation: Buffer;
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
  for (let index = 0; index < 10; index += 1) {
    frames.push({
      delay: 120,
      digits: pseudoDigits(result.number, index),
      lockedDigits: 0,
      badge: null,
      badgeIndex: 0,
      badgeCount: result.badges.length,
      earnedEp: 0,
      revealProgress: 0,
      phase: "rolling",
    });
  }

  const finalDigits = numberDigits(result.number);
  for (let index = 0; index < finalDigits.length; index += 1) {
    frames.push({
      delay: 90,
      digits: finalDigits.slice(0, index) + pseudoDigits(result.number, index * 3 + 12).slice(index),
      lockedDigits: index,
      badge: null,
      badgeIndex: 0,
      badgeCount: result.badges.length,
      earnedEp: 0,
      revealProgress: .4,
      phase: "number",
    });
    frames.push({
      delay: 90,
      digits: finalDigits.slice(0, index) + pseudoDigits(result.number, index * 3 + 13).slice(index),
      lockedDigits: index,
      badge: null,
      badgeIndex: 0,
      badgeCount: result.badges.length,
      earnedEp: 0,
      revealProgress: .7,
      phase: "number",
    });
    frames.push({
      delay: index === finalDigits.length - 1 ? 600 : 330,
      digits: finalDigits.slice(0, index + 1) + pseudoDigits(result.number, index + 8).slice(index + 1),
      lockedDigits: index + 1,
      badge: null,
      badgeIndex: 0,
      badgeCount: result.badges.length,
      earnedEp: 0,
      revealProgress: 1,
      phase: "number",
    });
  }

  // The landed number and its rarity colour are the payoff, so hold on them
  // before anything else competes for attention.
  const revealBadges = result.badges.slice(0, 15);
  frames.push({
    delay: 1_250,
    digits: finalDigits,
    lockedDigits: finalDigits.length,
    badge: null,
    badgeIndex: 0,
    badgeCount: revealBadges.length,
    earnedEp: 0,
    revealProgress: 1,
    phase: "rarity",
  });

  // Badges then fill in beneath the number, in the order the final card lists
  // them, quickly enough that the roll stays the centrepiece.
  let earnedEp = 0;
  revealBadges.forEach((badge, index) => {
    earnedEp += badge.ep;
    frames.push({
      delay: 70,
      digits: finalDigits,
      lockedDigits: finalDigits.length,
      badge,
      badgeIndex: index + 1,
      badgeCount: revealBadges.length,
      earnedEp,
      revealProgress: .5,
      phase: "badge",
    });
    frames.push({
      // GIF delays are encoded in centiseconds, so every value here stays a
      // multiple of 10 to keep the reported duration exact.
      delay: index === revealBadges.length - 1 ? 520 : 220,
      digits: finalDigits,
      lockedDigits: finalDigits.length,
      badge,
      badgeIndex: index + 1,
      badgeCount: revealBadges.length,
      earnedEp,
      revealProgress: 1,
      phase: "badge",
    });
  });

  frames.push({
    delay: 2_200,
    digits: finalDigits,
    lockedDigits: finalDigits.length,
    badge: null,
    badgeIndex: revealBadges.length,
    badgeCount: revealBadges.length,
    earnedEp: result.rawEp,
    revealProgress: 1,
    phase: "complete",
  });
  return frames;
}

function riskPercent(seed: number, frame: number): number {
  let value = ((seed + 17) * (frame + 31) * 1_103_515_245 + 12_345) >>> 0;
  value = (value ^ (value >>> 13)) >>> 0;
  return value % 99 + 1;
}

function riskAnimationFrames(finalPercent: number): RngdleRiskFrame[] {
  const frames = Array.from({ length: 28 }, (_, index) => {
    const percent = riskPercent(finalPercent, index);
    return {
      delay: 500,
      percent,
      progress: index / 28,
      locked: false,
      nearby: [-2, -1, 0, 1, 2].map((offset) => offset === 0 ? percent : riskPercent(finalPercent, index + offset + 41)),
    };
  });
  frames.push({
    delay: 1_000,
    percent: finalPercent,
    progress: 1,
    locked: true,
    nearby: [riskPercent(finalPercent, 88), riskPercent(finalPercent, 89), finalPercent, riskPercent(finalPercent, 90), riskPercent(finalPercent, 91)],
  });
  return frames;
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

function animationDigits(digits: string, lockedDigits: number, color: string) {
  return (
    <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 126, fontWeight: 700, lineHeight: 1, textShadow: `0 0 34px ${color}55, 0 0 120px ${color}3a` }}>
      {[...digits].map((digit, index) => (
        <div key={index} style={{ color: index < lockedDigits ? color : "#464e63", display: "flex" }}>{digit}</div>
      ))}
    </div>
  );
}

/**
 * The one region of the result card that changes between animation frames.
 * The same builder renders the still's panel and the per-frame patches, so a
 * composited frame is pixel-identical to a full render.
 */
interface RngdlePanelView {
  digitsText: string;
  lockedDigits: number | null; // null renders the still's single text run
  settled: boolean;
  pointsEp: number;
  showPenalty: boolean;
}

const PANEL_RECT = { left: 55, top: 132, width: 1090, height: 330 } as const;

function panelViewForFrame(result: RngdleResult, frame: RngdleAnimationFrame): RngdlePanelView {
  const complete = frame.phase === "complete";
  return {
    digitsText: frame.digits,
    lockedDigits: frame.lockedDigits,
    settled: frame.phase !== "rolling" && frame.phase !== "number",
    pointsEp: complete ? result.creditedEp : frame.earnedEp,
    showPenalty: complete && result.penaltyPercent !== null,
  };
}

function stillPanelView(result: RngdleResult): RngdlePanelView {
  return {
    digitsText: String(result.number),
    lockedDigits: null,
    settled: true,
    pointsEp: result.creditedEp,
    showPenalty: result.penaltyPercent !== null,
  };
}

function panelBoxStyle(result: RngdleResult): Record<string, unknown> {
  const theme = ROLL_THEMES[result.rarity];
  return {
    borderRadius: 30,
    border: `1px solid ${theme.primary}42`,
    background: `linear-gradient(110deg, ${theme.panelFrom}, ${theme.panelTo})`,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  };
}

// Returned as a keyed array, not a fragment: satori treats a fragment child as
// one flex-row box, which would flatten the panel's column stack sideways.
function resultPanelBody(result: RngdleResult, stats: RngdleResultCardStats, view: RngdlePanelView) {
  const color = ROLL_THEMES[result.rarity].primary;
  return [
    view.lockedDigits === null
      ? <div key="digits" style={{ color, fontFamily: "Geist Mono", fontSize: 126, fontWeight: 700, lineHeight: 1, textShadow: `0 0 34px ${color}55, 0 0 120px ${color}3a`, display: "flex" }}>{view.digitsText}</div>
      : <div key="digits" style={{ display: "flex" }}>{animationDigits(view.digitsText, view.lockedDigits, color)}</div>,
    <div key="pill" style={{ marginTop: 18, padding: "7px 20px", borderRadius: 999, border: `1px solid ${view.settled ? color : "#3d465c"}`, color: view.settled ? color : "#68718a", backgroundColor: view.settled ? `${color}14` : "rgba(255,255,255,.02)", fontSize: 15, fontWeight: 700, display: "flex" }}>
      {view.settled ? result.rarityLabel : "ROLLING"}
    </div>,
    <div key="points" style={{ marginTop: 12, color: view.settled ? "#f6f5fa" : "#5c6479", fontFamily: "Geist Mono", fontSize: 34, fontWeight: 700, display: "flex" }}>{formatEp(view.pointsEp)} POINTS</div>,
    view.showPenalty && result.penaltyPercent !== null ? (
      <div key="penalty" style={{ marginTop: 5, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ color: "#e2e5eb", fontFamily: "Geist Mono", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="15" height="15" viewBox="0 0 15 15"><path d="M12.4 5.2A5.2 5.2 0 1 0 12 10.4" fill="none" stroke="#e2e5eb" strokeWidth="1.7" strokeLinecap="round" /><path d="M10.1 3.9h2.8v2.8" fill="none" stroke="#e2e5eb" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {stats.rerollDeltaEp !== null && stats.rerollDeltaEp >= 0 ? "+" : ""}{formatEp(stats.rerollDeltaEp ?? result.creditedEp - result.rawEp)} POINTS
        </div>
        <div style={{ marginTop: 6, color, fontFamily: "Geist Mono", fontSize: 11, fontWeight: 700, display: "flex" }}>REROLL&nbsp;&nbsp;•&nbsp;&nbsp;-{result.penaltyPercent}% FROM {formatEp(result.rawEp)} BASE</div>
      </div>
    ) : null,
  ];
}

function panelPatchImage(result: RngdleResult, stats: RngdleResultCardStats, view: RngdlePanelView) {
  return (
    <div style={{ width: PANEL_RECT.width, height: PANEL_RECT.height, fontFamily: "Geist", color: "#f6f5fa", ...panelBoxStyle(result) }}>
      {resultPanelBody(result, stats, view)}
    </div>
  );
}

function riskAnimationImage(frame: RngdleRiskFrame) {
  const accent = frame.locked ? "#ff4d5e" : "#ff6b46";
  const trackWidth = 700;
  const markerLeft = Math.round(frame.progress * trackWidth);
  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", color: "#f7f7fa", background: "linear-gradient(145deg, #10090d 0%, #171016 52%, #09080d 100%)", fontFamily: "Geist", display: "flex" }}>
      <GridBackdrop from="#16080c" to="#351014" />
      <Header subtitle={frame.locked ? "RISK LOCKED" : "ROLLING REROLL RISK"} />
      <div style={{ position: "absolute", left: 0, top: 122, width: 900, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ color: "#96909b", fontSize: 13, fontWeight: 700, letterSpacing: 2.2, display: "flex" }}>{frame.locked ? "FINAL SCORE REDUCTION" : "CALCULATING SCORE REDUCTION"}</div>
        <div style={{ marginTop: 18, color: accent, fontFamily: "Geist Mono", fontSize: 112, fontWeight: 700, lineHeight: 1, textShadow: `0 0 34px ${accent}55`, display: "flex" }}>{frame.percent}%</div>
        <div style={{ marginTop: 35, width: 720, height: 95, overflow: "hidden", borderRadius: 18, border: "1px solid #4c3439", backgroundColor: "rgba(16,10,14,.88)", display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
          {frame.nearby.map((percent, index) => (
            <div key={`${index}-${percent}`} style={{ width: index === 2 ? 118 : 105, height: index === 2 ? 66 : 54, borderRadius: 12, border: index === 2 ? `2px solid ${accent}` : "1px solid #49363b", backgroundColor: index === 2 ? `${accent}1f` : "#171217", color: index === 2 ? "#fff7f4" : "#746c74", fontFamily: "Geist Mono", fontSize: index === 2 ? 31 : 24, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{percent}%</div>
          ))}
        </div>
        <div style={{ position: "relative", marginTop: 54, width: trackWidth, height: 18, borderRadius: 999, border: "1px solid #453137", backgroundColor: "#21161a", display: "flex" }}>
          <div style={{ width: markerLeft, height: 16, borderRadius: 999, background: `linear-gradient(90deg, #682530, ${accent})`, boxShadow: `0 0 18px ${accent}55`, display: "flex" }} />
          <div style={{ position: "absolute", left: Math.max(0, markerLeft - 9), top: -6, width: 28, height: 28, borderRadius: 99, border: "4px solid #fff", backgroundColor: accent, boxShadow: `0 0 22px ${accent}`, display: "flex" }} />
        </div>
        <div style={{ marginTop: 24, color: frame.locked ? accent : "#847b84", fontSize: 14, fontWeight: 700, letterSpacing: 1.3, display: "flex" }}>{frame.locked ? `${frame.percent}% WILL BE SUBTRACTED FROM THE NEW ROLL` : "RISK CAN LAND ANYWHERE FROM 1% TO 99%"}</div>
      </div>
      <div style={{ position: "absolute", left: 48, width: 804, bottom: 31, display: "flex", justifyContent: "space-between", color: "#66585e", fontSize: 10, fontWeight: 700, letterSpacing: 1.5 }}>
        <div>ONE REROLL PER DAY</div><div>1-99% RISK</div>
      </div>
    </div>
  );
}

function GridBackdrop({ from, to }: { from: string; to: string }) {
  return (
    <>
      <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", background: `linear-gradient(112deg, ${from} 0%, #0c1119 46%, ${to} 100%)`, display: "flex" }} />
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

function referenceShell(children: React.ReactNode, from: string, to: string, glow?: string) {
  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", color: "#f6f5fa", backgroundColor: "#0d0c14", fontFamily: "Geist", display: "flex" }}>
      <GridBackdrop from={from} to={to} />
      {glow ? (
        <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", background: `radial-gradient(circle at 84% 4%, ${glow}30 0%, rgba(0,0,0,0) 52%)`, display: "flex" }} />
      ) : null}
      {children}
    </div>
  );
}

function chipPointsText(badge: RngdleBadge): string {
  return `+${formatEp(badge.ep)} POINTS`;
}

// Chip widths stay integers so the crop rectangles computed in
// resultBadgeRects line up exactly with where yoga lays the chips out. The
// width covers whichever row is wider — label plus the points value (a large
// EP like "+37,023 POINTS" used to wrap and spill out of the box) or the
// description — using rough per-glyph widths for each font size.
function chipWidth(badge: RngdleBadge): number {
  const topRow = 22 + clipped(badge.label, 20).length * 6.6 + 10 + chipPointsText(badge).length * 5.2;
  const descRow = 22 + clipped(badge.desc, 38).length * 4.4;
  return Math.round(Math.min(250, Math.max(160, topRow, descRow)));
}

// Chips stay mostly neutral — white label, grey border, accent only in the
// points — so the roll's colour lives in the number, panel, and backdrop.
// Rarer badges (anything above Common) get the bright standout border the
// reference cards show.
function compactResultBadge(badge: RngdleBadge, color: string) {
  const width = chipWidth(badge);
  const standout = badge.rarity !== "Common";
  return (
    <div key={badge.id} style={{ width, height: 42, borderRadius: 15, border: `1px solid ${standout ? "rgba(238,241,252,.78)" : "rgba(148,155,186,.30)"}`, background: standout ? "rgba(255,255,255,.05)" : "rgba(255,255,255,.02)", padding: "6px 11px", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ width: "100%", display: "flex", justifyContent: "space-between" }}>
        <div style={{ color: "#f3f4f9", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", display: "flex" }}>{clipped(badge.label, 20)}</div>
        <div style={{ color, fontFamily: "Geist Mono", fontSize: 8.5, fontWeight: 700, whiteSpace: "nowrap", display: "flex" }}>{chipPointsText(badge)}</div>
      </div>
      <div style={{ marginTop: 4, color: "#8a90a2", fontSize: 8.5, whiteSpace: "nowrap", display: "flex" }}>{clipped(badge.desc, 38)}</div>
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
  rerollDeltaEp: number | null;
}

function formatDropCountdown(nextResetAt: number, now: number): string {
  const totalMinutes = Math.max(0, Math.ceil((nextResetAt - now) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function resultCardImage(
  result: RngdleResult,
  playerName: string,
  rank: number,
  playerCount: number,
  stats: RngdleResultCardStats,
  view: RngdlePanelView,
  badges: RngdleBadge[],
) {
  const theme = ROLL_THEMES[result.rarity];
  const color = theme.primary;
  return referenceShell(
    <>
      <div style={{ position: "absolute", left: 62, top: 45, display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 27, fontWeight: 700, letterSpacing: 1, display: "flex" }}>RNGDLE</div>
        <div style={{ marginTop: 9, color: "#8390a5", fontSize: 15, fontWeight: 700, letterSpacing: .5, display: "flex" }}>ONE ROLL. ONE NUMBER. EVERY DAY.</div>
      </div>
      <div style={{ position: "absolute", left: 920, top: 51, width: 218, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <div style={{ color: "#aeb7ca", fontSize: 14, fontWeight: 700, fontFamily: "Geist Mono", display: "flex" }}>{stats.gameDay}</div>
        <div style={{ marginTop: 12, fontSize: 15, fontWeight: 700, display: "flex" }}>NEXT DROP IN {formatDropCountdown(stats.nextResetAt, stats.now)}</div>
      </div>
      <div style={{ position: "absolute", left: PANEL_RECT.left, top: PANEL_RECT.top, width: PANEL_RECT.width, height: PANEL_RECT.height, ...panelBoxStyle(result) }}>
        {resultPanelBody(result, stats, view)}
      </div>
      <div style={{ position: "absolute", left: 62, top: 478, width: 1076, display: "flex", flexWrap: "wrap", gap: 7 }}>
        {badges.map((badge) => compactResultBadge(badge, color))}
      </div>
      <div style={{ position: "absolute", left: 62, bottom: 25, width: 1076, display: "flex", justifyContent: "space-between" }}>
        {[
          [clipped(playerName, 24), "TODAY'S ROLLER"],
          [`#${rank} / ${playerCount}`, "TODAY"],
          [`${stats.currentStreak} ${stats.currentStreak === 1 ? "DAY" : "DAYS"}`, "STREAK"],
          [formatEp(stats.careerEp), "CAREER POINTS"],
        ].map(([value, label]) => (
          <div key={label} style={{ width: 230, display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "Geist Mono", display: "flex" }}>{value}</div>
            <div style={{ marginTop: 10, color: "#727990", fontSize: 13, display: "flex" }}>{label}</div>
          </div>
        ))}
      </div>
    </>,
    theme.from,
    theme.to,
    theme.primary,
  );
}

function resultImage(
  result: RngdleResult,
  playerName: string,
  rank: number,
  playerCount: number,
  stats: RngdleResultCardStats,
) {
  return resultCardImage(result, playerName, rank, playerCount, stats, stillPanelView(result), result.badges.slice(0, 15));
}

// Mirrors the badge grid's flex-wrap layout (left 62, top 478, width 1076,
// gap 7, chip height 42) so chips can be cropped out of the rendered still.
// Rects carry a 2px margin to capture anti-aliased edges; chips sit 7px apart
// so margins never overlap a neighbour.
const CHIP_CROP_MARGIN = 2;

function resultBadgeRects(badges: RngdleBadge[]): Array<{ left: number; top: number; width: number; height: number }> {
  const rects: Array<{ left: number; top: number; width: number; height: number }> = [];
  let x = 0;
  let row = 0;
  for (const badge of badges) {
    const width = chipWidth(badge);
    if (x > 0 && x + width > 1076) {
      x = 0;
      row += 1;
    }
    rects.push({
      left: 62 + x - CHIP_CROP_MARGIN,
      top: 478 + row * 49 - CHIP_CROP_MARGIN,
      width: width + CHIP_CROP_MARGIN * 2,
      height: 42 + CHIP_CROP_MARGIN * 2,
    });
    x += width + 7;
  }
  return rects;
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
          <div style={{ width: 300, marginTop: 38, color: accent, fontFamily: "Geist Mono", fontSize: 56, fontWeight: 700, lineHeight: 1, display: "flex", justifyContent: "center" }}>{roll.result.number}</div>
          <div style={{ width: 300, marginTop: 17, fontFamily: "Geist Mono", fontSize: 19, fontWeight: 700, display: "flex", justifyContent: "center" }}>{formatEp(roll.result.creditedEp)} POINTS</div>
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
            <div style={{ fontFamily: "Geist Mono", fontSize: 20, fontWeight: 700, display: "flex" }}>{value}</div>
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
            <div style={{ marginTop: "auto", color: profileTheme.primary, fontFamily: "Geist Mono", fontSize: 9, fontWeight: 700, display: "flex" }}>+{formatEp(badge.ep)} POINTS</div>
          </div>
        ))}
      </div>
    </>,
    profileTheme.from,
    profileTheme.to,
    profileTheme.primary,
  );
}

function LeaderboardOrbitBackdrop() {
  return (
    <svg width="1200" height="790" viewBox="0 0 1200 790" style={{ position: "absolute", left: 0, top: 0 }}>
      <path d="M -85 430 C 245 112, 760 76, 1285 185" fill="none" stroke="rgba(95,108,170,.42)" strokeWidth="1.4" />
      <path d="M 385 118 C 230 354, 125 522, 92 770" fill="none" stroke="rgba(64,124,161,.25)" strokeWidth="1" />
      <path d="M 420 130 C 575 376, 657 598, 623 835" fill="none" stroke="rgba(113,91,170,.23)" strokeWidth="1" />
      <path d="M 551 140 C 574 314, 605 515, 614 790" fill="none" stroke="rgba(104,89,163,.15)" strokeWidth="1" />
      <circle cx="410" cy="136" r="4" fill="#5abfff" opacity=".82" />
      <circle cx="590" cy="230" r="5" fill="#63d7ff" opacity=".85" />
      <circle cx="658" cy="357" r="7" fill="#5fe2ff" opacity=".8" />
      <circle cx="622" cy="678" r="6" fill="#51dbff" opacity=".82" />
      <circle cx="756" cy="156" r="3" fill="#58d6ff" opacity=".75" />
      <circle cx="881" cy="151" r="4" fill="#6ee8ff" opacity=".76" />
    </svg>
  );
}

function leaderboardImage(entries: RngdleLeaderboardEntry[], totalPlayers: number) {
  return referenceShell(
    <>
      <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 790, background: "linear-gradient(90deg, rgba(0,112,150,.20), rgba(28,24,58,.05) 46%, rgba(103,43,178,.34))", display: "flex" }} />
      <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 790, background: "radial-gradient(circle at 62% 8%, rgba(124,58,205,.40) 0%, rgba(0,0,0,0) 52%)", display: "flex" }} />
      <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 790, background: "radial-gradient(circle at 6% 94%, rgba(0,140,180,.22) 0%, rgba(0,0,0,0) 46%)", display: "flex" }} />
      <LeaderboardOrbitBackdrop />
      <div style={{ position: "absolute", left: 58, top: 42, display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 27, fontWeight: 950, display: "flex" }}>RNGDLE</div>
        <div style={{ marginTop: 17, fontSize: 37, fontWeight: 950, display: "flex" }}>ALL-TIME LEADERBOARD</div>
        <div style={{ marginTop: 8, color: "#7f8ca5", fontSize: 15, display: "flex" }}>{totalPlayers} PLAYERS&nbsp;&nbsp;•&nbsp;&nbsp;CAREER POINTS</div>
      </div>
      <div style={{ position: "absolute", left: 51, top: 187, width: 1098, display: "flex", flexDirection: "column", gap: 8 }}>
        {entries.slice(0, 10).map((entry, index) => {
          const accent = index === 0 ? "#24d8ff" : index <= 6 ? "#f0a300" : "#ff4caf";
          const borderColor = index === 0 ? "#24d8ff" : index <= 6 ? "#b87900" : "#26303f";
          const gamesColor = index === 0 ? "#24d8ff" : index <= 6 ? "#ffad00" : "#ff55b6";
          const bestColor = index >= 7 ? "#ff55b6" : "#f2f0f7";
          const rankColor = index === 0 ? "#ffd02e" : index === 1 ? "#dce5ef" : index === 2 ? "#ff8735" : "#718098";
          return (
            <div key={entry.userId} style={{ width: 1098, height: 47, borderRadius: 14, border: `1px solid ${borderColor}`, background: index <= 6 ? "linear-gradient(90deg, rgba(28,35,40,.88), rgba(65,43,81,.65))" : "linear-gradient(90deg, rgba(18,25,34,.82), rgba(28,25,45,.64))", display: "flex", alignItems: "center" }}>
              <div style={{ width: 92, paddingLeft: 19, color: rankColor, fontFamily: "Geist Mono", fontSize: 17, fontWeight: 700, display: "flex" }}>#{index + 1}</div>
              <div style={{ width: 355, fontSize: 17, fontWeight: 700, display: "flex" }}>{clipped(entry.displayName, 32)}</div>
              <div style={{ width: 220, color: gamesColor, fontFamily: "Geist Mono", fontSize: 15, fontWeight: 700, display: "flex" }}>{entry.rolls} GAMES</div>
              <div style={{ width: 250, display: "flex", flexDirection: "column" }}>
                <div style={{ color: bestColor, fontFamily: "Geist Mono", fontSize: 11, fontWeight: 700, display: "flex" }}>BEST {entry.bestNumber}</div>
                <div style={{ marginTop: 3, color: index >= 7 ? accent : "#b7b5c5", fontFamily: "Geist Mono", fontSize: 8.5, display: "flex", alignItems: "center", gap: 3 }}>
                  <div style={{ display: "flex" }}>{formatEp(entry.bestEp)} PTS</div>
                  {entry.bestPenaltyPercent === null ? null : (
                    <svg width="9" height="9" viewBox="0 0 15 15"><path d="M12.4 5.2A5.2 5.2 0 1 0 12 10.4" fill="none" stroke={index >= 7 ? accent : "#b7b5c5"} strokeWidth="2" strokeLinecap="round" /><path d="M10.1 3.9h2.8v2.8" fill="none" stroke={index >= 7 ? accent : "#b7b5c5"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  )}
                  {entry.bestPenaltyPercent === null ? null : <div style={{ display: "flex" }}>-{entry.bestPenaltyPercent}%</div>}
                </div>
              </div>
              <div style={{ width: 181, paddingRight: 15, justifyContent: "flex-end", whiteSpace: "nowrap", fontFamily: "Geist Mono", fontSize: 15, fontWeight: 700, letterSpacing: -.25, display: "flex" }}>{formatEp(entry.totalEp)} POINTS</div>
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
  const [sansRegular, sansBold, monoRegular, monoBold] = await IMAGE_FONTS;
  const response = new ImageResponse(element, {
    width,
    height,
    fonts: [
      { name: "Geist", data: new Uint8Array(sansRegular).buffer, weight: 400, style: "normal" },
      { name: "Geist", data: new Uint8Array(sansBold).buffer, weight: 700, style: "normal" },
      { name: "Geist Mono", data: new Uint8Array(monoRegular).buffer, weight: 400, style: "normal" },
      { name: "Geist Mono", data: new Uint8Array(monoBold).buffer, weight: 700, style: "normal" },
    ],
  });
  return Buffer.from(await response.arrayBuffer());
}

// Bounded frame-render concurrency: unbounded Promise.all held every frame's
// intermediate buffers alive at once and peaked over half a GiB of RSS.
const RENDER_CONCURRENCY = 6;

async function mapLimit<T>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await task(items[index], index);
    }
  }));
}

export async function renderRngdleRiskAnimation(finalPercent: number): Promise<RngdleRiskAnimation> {
  const frames = riskAnimationFrames(finalPercent);
  const frameBytes = RNGDLE_DISCORD_RISK_WIDTH * RNGDLE_DISCORD_RISK_HEIGHT * 4;
  const stacked = Buffer.allocUnsafe(frameBytes * frames.length);
  await mapLimit(frames, RENDER_CONCURRENCY, async (frame, index) => {
    const png = await render(riskAnimationImage(frame), RNGDLE_DISCORD_RISK_WIDTH, RNGDLE_DISCORD_RISK_HEIGHT);
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== RNGDLE_DISCORD_RISK_WIDTH || info.height !== RNGDLE_DISCORD_RISK_HEIGHT || info.channels !== 4) {
      throw new Error("RNGDLE risk frame rendered at an unexpected size.");
    }
    data.copy(stacked, index * frameBytes);
  });
  return {
    animation: await sharp(stacked, {
      raw: {
        width: RNGDLE_DISCORD_RISK_WIDTH,
        height: RNGDLE_DISCORD_RISK_HEIGHT * frames.length,
        channels: 4,
        pageHeight: RNGDLE_DISCORD_RISK_HEIGHT,
      },
    }).gif({ loop: 1, delay: frames.map((frame) => frame.delay), colours: 96, effort: 4 }).toBuffer(),
    durationMs: frames.reduce((total, frame) => total + frame.delay, 0),
  };
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

export function renderRngdleDiscordLeaderboard(entries: RngdleLeaderboardEntry[], totalPlayers = entries.length): Promise<Buffer> {
  return render(
    leaderboardImage(entries, totalPlayers),
    RNGDLE_DISCORD_LEADERBOARD_WIDTH,
    RNGDLE_DISCORD_LEADERBOARD_HEIGHT,
  );
}

export interface RngdleAnimationAssets {
  animation: Buffer;
  still: Buffer;
  durationMs: number;
}

/**
 * The roll reveal, built by compositing instead of re-rendering: the card
 * shell renders once, each frame re-renders only the panel region, and badge
 * chips are cropped straight out of the final still. Frames are therefore
 * pixel-identical to a full render at a fraction of the rasterisation cost,
 * and the still comes back as a byproduct for delivery to reuse.
 */
export async function renderRngdleDiscordAnimation(
  result: RngdleResult,
  playerName: string,
  rank: number,
  playerCount: number,
  stats: RngdleResultCardStats,
): Promise<RngdleAnimationAssets> {
  const frames = animationFrames(result);
  const visible = result.badges.slice(0, 15);

  const still = await renderRngdleDiscordStill(result, playerName, rank, playerCount, stats);
  const base = await render(
    resultCardImage(result, playerName, rank, playerCount, stats, panelViewForFrame(result, frames[0]), []),
    RNGDLE_DISCORD_WIDTH,
    RNGDLE_DISCORD_HEIGHT,
  );

  const rects = resultBadgeRects(visible);
  const chipCrops: Buffer[] = [];
  for (const rect of rects) {
    chipCrops.push(await sharp(still).extract(rect).png().toBuffer());
  }
  // A crop is opaque (chip over backdrop), and the base holds the identical
  // backdrop pixels, so scaling the crop's alpha blends into exactly the
  // chip-at-that-opacity fade the old full-frame render produced.
  const fadedChips = new Map<string, Buffer>();
  const fadedChip = async (chip: number, opacity: number) => {
    const key = `${chip}:${opacity}`;
    let faded = fadedChips.get(key);
    if (!faded) {
      faded = await sharp(chipCrops[chip]).ensureAlpha().linear([1, 1, 1, opacity], [0, 0, 0, 0]).png().toBuffer();
      fadedChips.set(key, faded);
    }
    return faded;
  };

  // Panel patches are deduplicated: the two frames of each badge reveal share
  // identical panel content, only the chip fade differs.
  const viewKey = (view: RngdlePanelView) => JSON.stringify(view);
  const panelPatches = new Map<string, Buffer>();
  const uniqueViews = new Map<string, RngdlePanelView>();
  for (const frame of frames) {
    const view = panelViewForFrame(result, frame);
    uniqueViews.set(viewKey(view), view);
  }
  await mapLimit([...uniqueViews.values()], RENDER_CONCURRENCY, async (view) => {
    panelPatches.set(viewKey(view), await render(panelPatchImage(result, stats, view), PANEL_RECT.width, PANEL_RECT.height));
  });

  const frameBytes = RNGDLE_DISCORD_WIDTH * RNGDLE_DISCORD_HEIGHT * 4;
  const stacked = Buffer.allocUnsafe(frameBytes * frames.length);
  await mapLimit(frames, RENDER_CONCURRENCY, async (frame, index) => {
    const overlays: Array<{ input: Buffer; left: number; top: number }> = [
      { input: panelPatches.get(viewKey(panelViewForFrame(result, frame)))!, left: PANEL_RECT.left, top: PANEL_RECT.top },
    ];
    const revealedChips = Math.min(frame.badgeIndex, rects.length);
    for (let chip = 0; chip < revealedChips; chip += 1) {
      const fading = frame.badge !== null && chip === revealedChips - 1 && frame.revealProgress < 1;
      overlays.push({
        input: fading ? await fadedChip(chip, frame.revealProgress) : chipCrops[chip],
        left: rects[chip].left,
        top: rects[chip].top,
      });
    }
    const { data, info } = await sharp(base).composite(overlays).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== RNGDLE_DISCORD_WIDTH || info.height !== RNGDLE_DISCORD_HEIGHT || info.channels !== 4) {
      throw new Error("RNGDLE frame rendered at an unexpected size.");
    }
    data.copy(stacked, index * frameBytes);
  });

  const animation = await sharp(stacked, {
    raw: {
      width: RNGDLE_DISCORD_WIDTH,
      height: RNGDLE_DISCORD_HEIGHT * frames.length,
      channels: 4,
      pageHeight: RNGDLE_DISCORD_HEIGHT,
    },
  }).gif({ loop: 1, delay: frames.map((frame) => frame.delay), colours: 128, effort: 4 }).toBuffer();
  return {
    animation,
    still,
    durationMs: frames.reduce((total, frame) => total + frame.delay, 0),
  };
}

export async function renderRngdleDiscordAssets(
  result: RngdleResult,
  playerName: string,
  rank: number,
  playerCount: number,
  stats: RngdleResultCardStats,
): Promise<RngdleDiscordAssets> {
  const { animation, still, durationMs } = await renderRngdleDiscordAnimation(result, playerName, rank, playerCount, stats);
  return { animation, still, durationMs };
}
