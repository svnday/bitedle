import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import type {
  RngdleDailyStanding,
  RngdleLeaderboardEntry,
  RngdleRegretEntry,
  RngdleRegretTotals,
  RngdleUserProfile,
} from "./rngdle-discord-store";
import { classifyRngdleScore } from "./rngdle/scoring";
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
export const RNGDLE_DISCORD_REGRETS_FILENAME = "rngdle-hall-of-shame.png";
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

/**
 * Worn by the card until the number finishes landing. Every themed surface —
 * backdrop, panel, locked digits — would otherwise announce the roll's rarity
 * from the first frame and spoil the reveal. Deliberately a muted slate that
 * matches no rarity, so the switch always reads as new information.
 */
const PENDING_ROLL_THEME = {
  primary: "#8b93a7",
  from: "#0c0e14",
  to: "#242832",
  panelFrom: "#08090f",
  panelTo: "#14161e",
};

/** The rarity's theme once the roll has settled, the pending theme before. */
function cardTheme(result: RngdleResult, settled: boolean) {
  return settled ? ROLL_THEMES[result.rarity] : PENDING_ROLL_THEME;
}

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
  /** Where the dot sits on the track, 0 (far left) to 1 (far right). */
  position: number;
  /** Always derived from `position`, so the readout can never disagree with it. */
  percent: number;
  locked: boolean;
}

export interface RngdleDiscordAssets {
  animation: Buffer;
  still: Buffer;
  durationMs: number;
  loops: number;
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
  // Each distinct digit string costs a panel rasterisation, and spinning
  // digits read as random either way — so the spin cycles a small set of
  // strings rather than minting a new one per frame.
  const SPIN_STRINGS = 4;
  for (let index = 0; index < 10; index += 1) {
    frames.push({
      delay: 120,
      digits: pseudoDigits(result.number, index % SPIN_STRINGS),
      lockedDigits: 0,
      badge: null,
      badgeIndex: 0,
      badgeCount: result.badges.length,
      earnedEp: 0,
      revealProgress: 0,
      phase: "rolling",
    });
  }

  // One jitter frame per digit instead of two, at their combined delay, so
  // the cadence is unchanged but a third fewer panels need rendering.
  const finalDigits = numberDigits(result.number);
  for (let index = 0; index < finalDigits.length; index += 1) {
    frames.push({
      delay: 180,
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
  // One frame per badge rather than a fade-in pair. The fade held for 70ms,
  // which is under the threshold where it reads as motion, and each extra
  // frame is paid for twice over in compositing and GIF encoding. The pair's
  // delays are merged so the pacing is unchanged.
  let earnedEp = 0;
  revealBadges.forEach((badge, index) => {
    earnedEp += badge.ep;
    frames.push({
      // GIF delays are encoded in centiseconds, so every value here stays a
      // multiple of 10 to keep the reported duration exact.
      delay: index === revealBadges.length - 1 ? 590 : 290,
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

const RISK_SWEEP_FRAMES = 88;
const RISK_SWEEP_FRAME_MS = 60;
const RISK_SWEEP_CYCLES = 3.5;
const RISK_SWEEP_SPREAD = 0.5;
// Delays grow as the dot eases onto its value, so the settle is felt rather
// than just seen. Every delay stays a multiple of 10: GIF delays are stored in
// centiseconds, and anything else desynchronises the reported duration.
const RISK_SETTLE_DELAYS = [80, 100, 130, 170, 220];
const RISK_LOCK_HOLD_MS = 1_500;

function riskPercentAt(position: number): number {
  return Math.min(99, Math.max(1, Math.round(1 + position * 98)));
}

/**
 * The dot sweeps inside a window that starts as the whole track and closes onto
 * the answer: wide fast passes that narrow and slow, the way someone works a
 * volume slider before letting go. Oscillating around the final position
 * instead would clamp at the track edge whenever the answer sat near 1% or 99%,
 * pinning the dot for long stretches; a closing window always keeps it moving
 * and still lands exactly.
 */
function riskPositionAt(finalPosition: number, t: number): number {
  const centre = 0.5 + (finalPosition - 0.5) * Math.pow(t, 1.2);
  const halfWidth = RISK_SWEEP_SPREAD * Math.pow(1 - t, 1.6);
  const phase = 2 * Math.PI * RISK_SWEEP_CYCLES * Math.pow(t, 0.8) - Math.PI / 2;
  return Math.min(1, Math.max(0, centre + halfWidth * Math.sin(phase)));
}

function riskAnimationFrames(finalPercent: number): RngdleRiskFrame[] {
  const finalPosition = (finalPercent - 1) / 98;
  const frames: RngdleRiskFrame[] = [];
  for (let index = 0; index < RISK_SWEEP_FRAMES; index += 1) {
    const position = riskPositionAt(finalPosition, index / RISK_SWEEP_FRAMES);
    frames.push({ delay: RISK_SWEEP_FRAME_MS, position, percent: riskPercentAt(position), locked: false });
  }

  // Ease whatever wobble is left straight onto the answer.
  const from = frames[frames.length - 1].position;
  RISK_SETTLE_DELAYS.forEach((delay, index) => {
    const k = (index + 1) / RISK_SETTLE_DELAYS.length;
    const position = from + (finalPosition - from) * (1 - Math.pow(1 - k, 3));
    frames.push({ delay, position, percent: riskPercentAt(position), locked: false });
  });

  // Pinned rather than trusted to the maths, so the readout always matches the
  // penalty the result card reports.
  frames.push({ delay: RISK_LOCK_HOLD_MS, position: finalPosition, percent: finalPercent, locked: true });
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

/** The number's bloom, which only the landed roll wears. */
// Both GIFs are mostly still: the risk animation moves a dot along a fixed
// shell, and the roll animation changes one panel on a fixed card. Letting cgif
// carry near-identical pixels over as transparency costs no encode time - that
// is pinned by dithered quantisation and does not move - but it takes the risk
// GIF from 520 KiB to 282 KiB, which every viewer in the channel downloads.
// 8 was measured: it shifts 0.08% of pixels, where 32 shifts 10%.
const GIF_INTER_FRAME_MAX_ERROR = 8;

// How many times the reveal plays before it settles on the final card. Looping
// is the one way to put more animation on screen for free: the GIF is byte for
// byte the same, so nothing is added to render time - which is the only latency
// a player actually waits on - or to what every viewer downloads. Adding frames
// would cost both. The last pass ends on the settled card and stays there, so
// the still that replaces it is still a seamless swap.
const ROLL_REVEAL_LOOPS = 2;

const DIGIT_GLOW = (color: string) => `0 0 34px ${color}55, 0 0 120px ${color}3a`;

/**
 * The glow is by far the most expensive thing on the card — a 126px glyph with
 * these two shadows rasterises in ~123ms against ~9ms without them, and the
 * spin needs a fresh render for every distinct digit string. Withholding it
 * until the roll settles cuts the animation's render cost by more than half,
 * and it costs nothing visually: the pending digits are deliberately dim, so a
 * 33%-alpha bloom on dim slate is barely there. It also gives the reveal one
 * more thing to do, since the bloom now arrives with the rarity colour.
 */
function animationDigits(digits: string, lockedDigits: number, color: string, glow: boolean) {
  return (
    <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 126, fontWeight: 700, lineHeight: 1, ...(glow ? { textShadow: DIGIT_GLOW(color) } : {}) }}>
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

function panelBoxStyle(result: RngdleResult, settled: boolean): Record<string, unknown> {
  const theme = cardTheme(result, settled);
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

/**
 * Which parts of the panel a render paints. Every layer keeps the identical
 * layout — hidden elements are drawn in `transparent` rather than removed — so
 * "base" and "ep" composite back into exactly what "full" would have produced,
 * and both can be placed at the panel's origin without measuring anything.
 *
 * This exists because settled frames differ only in their EP total, and the
 * glowing 126px number costs ~123ms to rasterise against ~7ms for the EP line.
 * Rendering the glow once and varying only the cheap layer turns fourteen
 * expensive panels into one plus fourteen cheap ones.
 */
type RngdlePanelLayer = "full" | "base" | "ep" | "empty";

/**
 * The "was -> is" arrow. Drawn rather than typed: a missing U+2192 in the
 * bundled font would render as tofu in the middle of the card.
 */
function DowngradeArrow({ color, size }: { color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "flex" }}>
      <path d="M4 12h14M12 5.5 18.5 12 12 18.5" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Returned as a keyed array, not a fragment: satori treats a fragment child as
// one flex-row box, which would flatten the panel's column stack sideways.
function resultPanelBody(
  result: RngdleResult,
  stats: RngdleResultCardStats,
  view: RngdlePanelView,
  layer: RngdlePanelLayer = "full",
) {
  const themeColor = cardTheme(result, view.settled).primary;
  const blank = layer === "empty";
  const color = blank || layer === "ep" ? "transparent" : themeColor;
  const epColor = blank || layer === "base" ? "transparent" : undefined;
  const chrome = blank || layer === "ep" ? "transparent" : undefined;
  const faded = "#7b8399";

  // After a reroll the card carries two readings of the same roll: what it was
  // worth before the risk, and what it is worth now. Showing them either side
  // of an arrow says what the penalty actually cost far more directly than a
  // percentage does - and it puts the tier drop, which is the part players feel,
  // where the tier already is. The base tier comes from the pre-penalty EP; the
  // one on `result` is already the post-penalty tier.
  const penalised = view.showPenalty && result.penaltyPercent !== null;
  const baseRarityLabel = penalised ? classifyRngdleScore(result.rawEp).label : null;
  const tierDropped = baseRarityLabel !== null && baseRarityLabel !== result.rarityLabel;
  return [
    view.lockedDigits === null
      ? <div key="digits" style={{ color, fontFamily: "Geist Mono", fontSize: 126, fontWeight: 700, lineHeight: 1, ...(layer === "ep" || layer === "empty" ? {} : { textShadow: DIGIT_GLOW(themeColor) }), display: "flex" }}>{view.digitsText}</div>
      : <div key="digits" style={{ display: "flex" }}>{animationDigits(view.digitsText, view.lockedDigits, color, view.settled && layer === "full")}</div>,
    <div key="pill" style={{ marginTop: 18, padding: "7px 20px", borderRadius: 999, border: `1px solid ${chrome ?? (view.settled ? themeColor : "#3d465c")}`, color: chrome ?? (view.settled ? themeColor : "#68718a"), backgroundColor: chrome ?? (view.settled ? `${themeColor}14` : "rgba(255,255,255,.02)"), fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 9 }}>
      {view.settled && tierDropped
        ? [
          <div key="was" style={{ color: chrome ?? faded, display: "flex" }}>{baseRarityLabel}</div>,
          <DowngradeArrow key="arrow" color={chrome ?? faded} size={14} />,
          <div key="now" style={{ display: "flex" }}>{result.rarityLabel}</div>,
        ]
        : (view.settled ? result.rarityLabel : "ROLLING")}
    </div>,
    <div key="points" style={{ marginTop: 12, fontFamily: "Geist Mono", fontSize: 34, fontWeight: 700, display: "flex", alignItems: "center", gap: 13 }}>
      {penalised
        ? [
          <div key="was" style={{ color: epColor ?? faded, display: "flex" }}>{formatEp(result.rawEp)}</div>,
          <DowngradeArrow key="arrow" color={epColor ?? faded} size={26} />,
        ]
        : null}
      <div key="now" style={{ color: epColor ?? (view.settled ? "#f6f5fa" : "#5c6479"), display: "flex" }}>{formatEp(view.pointsEp)} EP</div>
    </div>,
    view.showPenalty && result.penaltyPercent !== null ? (
      // Two different figures live here and used to sit unlabelled one above the
      // other, which read as "-8% of 3,824 = -593". It isn't: the top line is the
      // net swing against the roll that was given up, the bottom is the penalty
      // taken off this one. Both now say which is which, and the penalty carries
      // its EP cost so the percentage does not have to be worked out by hand.
      <div key="penalty" style={{ marginTop: 5, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ color: chrome ?? "#e2e5eb", fontFamily: "Geist Mono", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}>
          <svg width="15" height="15" viewBox="0 0 15 15"><path d="M12.4 5.2A5.2 5.2 0 1 0 12 10.4" fill="none" stroke={chrome ?? "#e2e5eb"} strokeWidth="1.7" strokeLinecap="round" /><path d="M10.1 3.9h2.8v2.8" fill="none" stroke={chrome ?? "#e2e5eb"} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <div style={{ display: "flex" }}>{stats.rerollDeltaEp !== null && stats.rerollDeltaEp >= 0 ? "+" : ""}{formatEp(stats.rerollDeltaEp ?? result.creditedEp - result.rawEp)} EP</div>
          <div style={{ color: chrome ?? "#8b93a7", fontSize: 10, fontWeight: 700, letterSpacing: 1.2, display: "flex" }}>VS FIRST ROLL</div>
        </div>
        <div style={{ marginTop: 6, color, fontFamily: "Geist Mono", fontSize: 11, fontWeight: 700, display: "flex" }}>REROLL&nbsp;&nbsp;•&nbsp;&nbsp;RISK -{result.penaltyPercent}%&nbsp;&nbsp;•&nbsp;&nbsp;-{formatEp(result.rawEp - result.creditedEp)} EP</div>
      </div>
    ) : null,
  ];
}

function panelPatchImage(
  result: RngdleResult,
  stats: RngdleResultCardStats,
  view: RngdlePanelView,
  layer: RngdlePanelLayer = "full",
) {
  // The EP layer carries no ground of its own; it lands on the base's.
  const box = layer === "ep" ? { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" } : panelBoxStyle(result, view.settled);
  return (
    <div style={{ width: PANEL_RECT.width, height: PANEL_RECT.height, fontFamily: "Geist", color: "#f6f5fa", ...box }}>
      {resultPanelBody(result, stats, view, layer)}
    </div>
  );
}

// The risk frame is split into a static shell and three small moving pieces,
// so a frame is a few composites instead of a full rasterisation. Positions are
// absolute constants rather than flex-derived, because compositing needs to know
// exactly where each piece lands.
const RISK_TRACK = { left: 100, top: 430, width: 700, height: 18 } as const;
const RISK_FILL_HEIGHT = 16;
const RISK_NUMBER_RECT = { left: 200, top: 175, width: 500, height: 170 } as const;
const RISK_DOT_BOX = 84;
const RISK_SWEEP_ACCENT = "#ff6b46";
const RISK_LOCKED_ACCENT = "#ff4d5e";

function riskAccent(locked: boolean): string {
  return locked ? RISK_LOCKED_ACCENT : RISK_SWEEP_ACCENT;
}

/** Everything that never moves. Two variants exist: sweeping and locked. */
function riskShellImage(locked: boolean) {
  const accent = riskAccent(locked);
  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", color: "#f7f7fa", background: "linear-gradient(145deg, #10090d 0%, #171016 52%, #09080d 100%)", fontFamily: "Geist", display: "flex" }}>
      <GridBackdrop from="#16080c" to="#351014" />
      <Header subtitle={locked ? "RISK LOCKED" : "ROLLING REROLL RISK"} />
      <div style={{ position: "absolute", left: 0, top: 150, width: RNGDLE_DISCORD_RISK_WIDTH, display: "flex", justifyContent: "center" }}>
        <div style={{ color: "#96909b", fontSize: 13, fontWeight: 700, letterSpacing: 2.2, display: "flex" }}>
          {locked ? "FINAL SCORE REDUCTION" : "CALCULATING SCORE REDUCTION"}
        </div>
      </div>
      <div style={{ position: "absolute", left: RISK_TRACK.left, top: RISK_TRACK.top, width: RISK_TRACK.width, height: RISK_TRACK.height, borderRadius: 999, border: "1px solid #453137", backgroundColor: "#21161a", display: "flex" }} />
      <div style={{ position: "absolute", left: 0, top: 486, width: RNGDLE_DISCORD_RISK_WIDTH, display: "flex", justifyContent: "center" }}>
        <div style={{ color: locked ? accent : "#847b84", fontSize: 14, fontWeight: 700, letterSpacing: 1.3, display: "flex" }}>
          {locked ? "THIS WILL BE SUBTRACTED FROM THE NEW ROLL" : "RISK CAN LAND ANYWHERE FROM 1% TO 99%"}
        </div>
      </div>
      <div style={{ position: "absolute", left: 48, width: 804, bottom: 31, display: "flex", justifyContent: "space-between", color: "#66585e", fontSize: 10, fontWeight: 700, letterSpacing: 1.5 }}>
        <div>ONE REROLL PER DAY</div><div>1-99% RISK</div>
      </div>
    </div>
  );
}

/**
 * The readout, on a transparent ground so its glow composites over the shell
 * the same way it would have painted there. Only 99 of these exist per accent,
 * so they are worth caching for the lifetime of the instance.
 */
function riskNumberImage(percent: number, locked: boolean) {
  const accent = riskAccent(locked);
  return (
    <div style={{ width: RISK_NUMBER_RECT.width, height: RISK_NUMBER_RECT.height, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Geist Mono" }}>
      <div style={{ color: accent, fontSize: 112, fontWeight: 700, lineHeight: 1, textShadow: `0 0 34px ${accent}55`, display: "flex" }}>{percent}%</div>
    </div>
  );
}

/** Full-width fill, cropped per frame — the gradient is revealed, not restretched. */
function riskFillImage(locked: boolean) {
  return (
    <div style={{ width: RISK_TRACK.width, height: RISK_FILL_HEIGHT, borderRadius: 999, background: `linear-gradient(90deg, #682530, ${riskAccent(locked)})`, display: "flex" }} />
  );
}

/** The dot, boxed with room for its glow so the sprite can be placed by centre. */
function riskDotImage(locked: boolean) {
  const accent = riskAccent(locked);
  return (
    <div style={{ width: RISK_DOT_BOX, height: RISK_DOT_BOX, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 28, height: 28, borderRadius: 99, border: "4px solid #fff", backgroundColor: accent, boxShadow: `0 0 22px ${accent}`, display: "flex" }} />
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

function chipEpText(badge: RngdleBadge): string {
  return `+${formatEp(badge.ep)} EP`;
}

// Chip widths stay integers so the crop rectangles computed in
// resultBadgeRects line up exactly with where yoga lays the chips out. The
// width covers whichever row is wider — the label plus its EP value, or the
// description — using rough per-glyph widths for each font size, since a row
// that overflows gets clipped rather than wrapped.
function chipWidth(badge: RngdleBadge): number {
  const topRow = 22 + clipped(badge.label, 20).length * 6.6 + 10 + chipEpText(badge).length * 5.2;
  const descRow = 22 + clipped(badge.desc, 38).length * 4.4;
  // Measured across all 230 badges: the widest is "4 Consecutive Numbers"
  // carrying "+25,000,025 EP" at 237px, so this ceiling never clips.
  return Math.round(Math.min(260, Math.max(160, topRow, descRow)));
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
        <div style={{ color, fontFamily: "Geist Mono", fontSize: 8.5, fontWeight: 700, whiteSpace: "nowrap", display: "flex" }}>{chipEpText(badge)}</div>
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
  layer: RngdlePanelLayer = "full",
) {
  const theme = cardTheme(result, view.settled);
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
      <div style={{ position: "absolute", left: PANEL_RECT.left, top: PANEL_RECT.top, width: PANEL_RECT.width, height: PANEL_RECT.height, ...panelBoxStyle(result, view.settled) }}>
        {resultPanelBody(result, stats, view, layer)}
      </div>
      <div style={{ position: "absolute", left: 62, top: 478, width: 1076, display: "flex", flexWrap: "wrap", gap: 7 }}>
        {badges.map((badge) => compactResultBadge(badge, color))}
      </div>
      <div style={{ position: "absolute", left: 62, bottom: 25, width: 1076, display: "flex", justifyContent: "space-between" }}>
        {[
          [clipped(playerName, 24), "TODAY'S ROLLER"],
          [`#${rank} / ${playerCount}`, "TODAY"],
          [`${stats.currentStreak} ${stats.currentStreak === 1 ? "DAY" : "DAYS"}`, "STREAK"],
          [formatEp(stats.careerEp), "CAREER EP"],
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

const BADGE_GRID = { left: 62, top: 478, width: 1076, height: 160 } as const;

/**
 * Chip positions within the badge grid. Returned relative to the grid so the
 * same numbers crop a chip out of the strip and place it on a frame.
 */
function resultBadgeRects(badges: RngdleBadge[]): Array<{ left: number; top: number; width: number; height: number }> {
  const rects: Array<{ left: number; top: number; width: number; height: number }> = [];
  let x = 0;
  let row = 0;
  for (const badge of badges) {
    const width = chipWidth(badge);
    if (x > 0 && x + width > BADGE_GRID.width) {
      x = 0;
      row += 1;
    }
    rects.push({
      left: Math.max(0, x - CHIP_CROP_MARGIN),
      top: Math.max(0, row * 49 - CHIP_CROP_MARGIN),
      width: width + CHIP_CROP_MARGIN * 2,
      height: 42 + CHIP_CROP_MARGIN * 2,
    });
    x += width + 7;
  }
  return rects;
}

/**
 * The badge grid alone, on a transparent ground. Cutting chips from here
 * rather than from the finished card breaks the animation's dependency on the
 * still, which lets the still be rendered later — after the GIF is already on
 * screen — instead of blocking it.
 */
function badgeStripImage(badges: RngdleBadge[], color: string) {
  return (
    <div style={{ width: BADGE_GRID.width, height: BADGE_GRID.height, display: "flex", flexWrap: "wrap", gap: 7, alignContent: "flex-start", fontFamily: "Geist", color: "#f6f5fa" }}>
      {badges.map((badge) => compactResultBadge(badge, color))}
    </div>
  );
}

// Only the top roll is emphasised with a full-strength border and glow; the
// other two sit back with a dim tint of their own rarity colour, so the card
// row reads as "this is your best" at a glance.
function profileRollCard(
  title: string,
  roll: RngdleUserProfile["top"] | null,
  accent: string,
  footer: string,
  highlight = false,
) {
  return (
    <div style={{ width: 350, height: 270, padding: "22px 24px", borderRadius: 24, border: highlight ? `2px solid ${accent}` : `1px solid ${accent}3d`, background: highlight ? "rgba(12,10,8,.72)" : "rgba(10,10,17,.62)", ...(highlight ? { boxShadow: `0 0 34px ${accent}26` } : {}), display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ width: 300, color: "#8090aa", fontSize: 13, fontWeight: 850, display: "flex" }}>{title}</div>
      {roll ? (
        <div style={{ width: 300, height: 210, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ width: 300, marginTop: 38, color: accent, fontFamily: "Geist Mono", fontSize: 56, fontWeight: 700, lineHeight: 1, textShadow: `0 0 26px ${accent}4a`, display: "flex", justifyContent: "center" }}>{roll.result.number}</div>
          <div style={{ width: 300, marginTop: 17, fontFamily: "Geist Mono", fontSize: 19, fontWeight: 700, display: "flex", justifyContent: "center" }}>{formatEp(roll.result.creditedEp)} EP</div>
          <div style={{ width: 300, marginTop: 11, color: accent, fontSize: 12, fontWeight: 900, display: "flex", justifyContent: "center" }}>{roll.result.rarityLabel}</div>
          {roll.result.penaltyPercent !== null ? <div style={{ width: 300, marginTop: 7, color: "#c3cad8", fontFamily: "Geist Mono", fontSize: 8.5, fontWeight: 700, display: "flex", justifyContent: "center" }}>REROLL {formatEp(roll.result.creditedEp - roll.result.rawEp)} EP&nbsp;&nbsp;•&nbsp;&nbsp;-{roll.result.penaltyPercent}%</div> : null}
          <div style={{ width: 300, marginTop: "auto", color: "#65718a", fontSize: 9.5, fontFamily: "monospace", display: "flex", justifyContent: "center" }}>{footer}</div>
        </div>
      ) : (
        <div style={{ marginTop: 88, color: "#596277", fontSize: 20, fontWeight: 850, display: "flex" }}>NO ROLL TODAY</div>
      )}
    </div>
  );
}

function profileImage(profile: RngdleUserProfile) {
  const profileTheme = ROLL_THEMES[profile.top.result.rarity];
  return referenceShell(
    <>
      {/* Broad wash of the top roll's colour, layered over referenceShell's
          corner bloom so the whole canvas carries the rarity, not just a corner. */}
      <div style={{ position: "absolute", left: 0, top: 0, width: RNGDLE_DISCORD_PROFILE_WIDTH, height: RNGDLE_DISCORD_PROFILE_HEIGHT, background: `radial-gradient(circle at 74% -6%, ${profileTheme.primary}3a 0%, rgba(0,0,0,0) 66%)`, display: "flex" }} />
      <div style={{ position: "absolute", left: 0, top: 0, width: RNGDLE_DISCORD_PROFILE_WIDTH, height: RNGDLE_DISCORD_PROFILE_HEIGHT, background: `linear-gradient(118deg, rgba(0,0,0,0) 34%, ${profileTheme.primary}1c 100%)`, display: "flex" }} />
      {/* Flat tint so the far corners stay in the rarity's family rather than
          falling back to the shared backdrop's cool mid-tone. */}
      <div style={{ position: "absolute", left: 0, top: 0, width: RNGDLE_DISCORD_PROFILE_WIDTH, height: RNGDLE_DISCORD_PROFILE_HEIGHT, background: `${profileTheme.primary}0f`, display: "flex" }} />
      <div style={{ position: "absolute", left: 58, top: 40, display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 25, fontWeight: 950, display: "flex" }}>RNGDLE</div>
        <div style={{ marginTop: 10, color: "#8090aa", fontSize: 15, fontWeight: 850, display: "flex" }}>PLAYER PROFILE</div>
      </div>
      {/* No avatar: satori has to rasterise the fetched image itself, and it
          renders Discord's PNGs distorted inside the circle. The name alone
          reads cleanly and saves a CDN round trip per profile. */}
      <div style={{ position: "absolute", left: 700, top: 44, width: 446, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
        <div style={{ fontSize: 31, fontWeight: 950, whiteSpace: "nowrap", display: "flex" }}>{clipped(profile.displayName, 28)}</div>
      </div>
      <div style={{ position: "absolute", left: 51, top: 124, width: 1098, display: "flex", gap: 22 }}>
        {profileRollCard("TODAY'S ROLL", profile.today, profile.today ? ROLL_THEMES[profile.today.result.rarity].primary : "#45506a", "TODAY'S RESULT")}
        {profileRollCard("TOP ROLL", profile.top, ROLL_THEMES[profile.top.result.rarity].primary, `ROLLED ${profile.top.gameDay}`, true)}
        {profileRollCard("WORST ROLL", profile.worst, ROLL_THEMES[profile.worst.result.rarity].primary, `ROLLED ${profile.worst.gameDay}`)}
      </div>
      <div style={{ position: "absolute", left: 51, top: 417, width: 1098, display: "flex", gap: 9 }}>
        {[
          [`#${profile.allTimeRank} / ${profile.totalPlayers}`, "ALL-TIME RANK"],
          [String(profile.games), "GAMES"],
          [formatEp(profile.careerEp), "CAREER EP"],
          [String(profile.currentStreak), "CURRENT STREAK"],
          [`${profile.uniqueBadges} / ${profile.totalBadges}`, "UNIQUE PATTERNS"],
          [`${profile.rerollDeltaEp >= 0 ? "+" : ""}${formatEp(profile.rerollDeltaEp)}`, "REROLL P&L"],
        ].map(([value, label]) => (
          <div key={label} style={{ width: 175, height: 96, borderRadius: 18, border: "1px solid rgba(148,155,186,.24)", background: "rgba(255,255,255,.03)", padding: "19px 17px", display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: "Geist Mono", fontSize: 20, fontWeight: 700, display: "flex" }}>{value}</div>
            <div style={{ marginTop: 15, color: "#7b879f", fontSize: 11, display: "flex" }}>{label}</div>
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 58, top: 548, color: "#8190a7", fontSize: 13, fontWeight: 850, display: "flex" }}>RAREST FINDS</div>
      <div style={{ position: "absolute", left: 57, top: 577, width: 1086, display: "flex", gap: 9 }}>
        {profile.rarestBadges.map((badge) => (
          <div key={badge.id} style={{ width: 208, height: 76, borderRadius: 17, border: "1px solid rgba(238,241,252,.30)", background: "rgba(255,255,255,.04)", padding: "10px 16px", display: "flex", flexDirection: "column" }}>
            <div style={{ color: "#f3f4f9", fontSize: 15, fontWeight: 900, whiteSpace: "nowrap", display: "flex" }}>{clipped(badge.label, 22)}</div>
            <div style={{ marginTop: 7, color: "#8a90a2", fontSize: 9.5, whiteSpace: "nowrap", display: "flex" }}>{clipped(badge.desc, 31)}</div>
            <div style={{ marginTop: "auto", color: profileTheme.primary, fontFamily: "Geist Mono", fontSize: 9, fontWeight: 700, display: "flex" }}>+{formatEp(badge.ep)} EP</div>
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 58, top: 665, color: "#6f7a91", fontSize: 12, display: "flex" }}>
        {profile.uniqueBadges} of {profile.totalBadges} unique patterns discovered
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

/**
 * One board, two datasets. The daily standings render through the very same
 * component as the all-time table rather than a copy of it, so the two cannot
 * drift apart: only the heading, the captions and what each column says change.
 */
/** Two lines and a reroll marker - the shape every score column is drawn in. */
interface RngdleBoardScore {
  top: string;
  bottom: string;
  penaltyPercent: number | null;
}

interface RngdleBoardRow {
  key: string;
  rank: number;
  name: string;
  /** Middle column: the score, with the reroll marker attached to it. */
  score: RngdleBoardScore;
  /** The all-time table's second score column. Null on a board without one. */
  worst: RngdleBoardScore | null;
  /** Right of the score: the rarest badge behind it, and what it paid. */
  badge: RngdleBoardBadge;
  total: string;
}

/**
 * The fourth column. A badge board fills it with a label and what the badge
 * paid; the Hall of Shame fills it with the tier a reroll fell through, which
 * is why the second label and its arrow are part of the shape rather than
 * punctuation inside the first.
 */
interface RngdleBoardBadge {
  label: string;
  /** Drawn after the label where a board states a downgrade; null otherwise. */
  arrowTo: string | null;
  /** Trailing figure, e.g. what the badge paid. Empty renders nothing. */
  ep: string;
  /** The second line: the badge's own wording, or the day it went wrong. */
  desc: string;
}

interface RngdleBoard {
  heading: string;
  caption: string;
  layout: RngdleBoardLayout;
  /** Column headings. Each board names its own, since the score differs. */
  columns: { player: string; score: string; worst: string | null; badge: string; total: string };
  footerLeft: string;
  footerRight: string;
  rows: RngdleBoardRow[];
}

/**
 * Column widths, each set summing to the 1098-wide row, plus the character
 * budgets that keep a cell's text inside its own column. The badge column was
 * widened from 250 at the name column's expense, to give the badge's own
 * wording a line of its own without wrapping it.
 */
interface RngdleBoardLayout {
  rank: number;
  name: number;
  score: number;
  /** 0 on a board with no worst-EP column, which then renders no such cell. */
  worst: number;
  badge: number;
  total: number;
  nameLimit: number;
  badgeLabelLimit: number;
  badgeDescLimit: number;
}

// The all-time table pays for its worst-EP column out of the name, score and
// badge columns. The daily board has no such column - a day is a single roll,
// whose worst is its best - so it keeps the widths it already had.
const ALL_TIME_LAYOUT: RngdleBoardLayout = {
  rank: 92, name: 235, score: 150, worst: 150, badge: 290, total: 181,
  nameLimit: 20, badgeLabelLimit: 22, badgeDescLimit: 54,
};
const DAILY_LAYOUT: RngdleBoardLayout = {
  rank: 92, name: 295, score: 220, worst: 0, badge: 310, total: 181,
  nameLimit: 26, badgeLabelLimit: 24, badgeDescLimit: 58,
};
// Two score columns of equal weight: the Hall of Shame is a before-and-after,
// and sizing "kept" above "gave up" would editorialise the comparison.
const REGRETS_LAYOUT: RngdleBoardLayout = {
  rank: 92, name: 235, score: 185, worst: 185, badge: 220, total: 181,
  nameLimit: 20, badgeLabelLimit: 10, badgeDescLimit: 30,
};

function allTimeBoard(entries: RngdleLeaderboardEntry[], totalPlayers: number): RngdleBoard {
  return {
    heading: "ALL-TIME LEADERBOARD",
    caption: `${totalPlayers} PLAYERS`,
    layout: ALL_TIME_LAYOUT,
    columns: { player: "PLAYER", score: "BEST ROLL", worst: "WORST EP", badge: "RAREST BADGE EVER", total: "CAREER EP" },
    footerLeft: "Ranked by total career EP",
    footerRight: "Daily play builds your all-time total",
    rows: entries.slice(0, 10).map((entry, index) => ({
      key: entry.userId,
      rank: index + 1,
      name: entry.displayName,
      score: {
        top: `BEST ${entry.bestNumber}`,
        bottom: `${formatEp(entry.bestEp)} EP`,
        penaltyPercent: entry.bestPenaltyPercent,
      },
      // The EP leads in this column, since that is what it is named by; the
      // roll that earned so little sits underneath it.
      worst: {
        top: `${formatEp(entry.worstEp)} EP`,
        bottom: `ROLL ${entry.worstNumber}`,
        penaltyPercent: entry.worstPenaltyPercent,
      },
      badge: {
        label: entry.rarestBadgeLabel ? clipped(entry.rarestBadgeLabel.toUpperCase(), ALL_TIME_LAYOUT.badgeLabelLimit) : "NO BADGES",
        arrowTo: null,
        ep: entry.rarestBadgeEp ? `+${formatEp(entry.rarestBadgeEp)} EP` : "",
        desc: clipped(entry.rarestBadgeDesc ?? "", ALL_TIME_LAYOUT.badgeDescLimit),
      },
      total: `${formatEp(entry.totalEp)} EP`,
    })),
  };
}

function dailyBoard(standings: RngdleDailyStanding[], gameDay: string, totalPlayers: number): RngdleBoard {
  const rolled = standings.length;
  return {
    heading: "TODAY'S LEADERBOARD",
    caption: `${gameDay}  •  ${rolled} OF ${totalPlayers} ROLLED`,
    layout: DAILY_LAYOUT,
    columns: { player: "PLAYER", score: "TODAY'S ROLL", worst: null, badge: "RAREST BADGE", total: "TODAY'S EP" },
    footerLeft: "Ranked by today's credited EP",
    footerRight: "Resets with the next drop",
    // The computed rank, not the row index: tied scores genuinely share a place.
    rows: standings.slice(0, 10).map((entry) => ({
      key: entry.userId,
      rank: entry.rank,
      name: entry.displayName,
      score: {
        top: `ROLL ${entry.number}`,
        bottom: entry.rarityLabel,
        penaltyPercent: entry.penaltyPercent,
      },
      // A day is one roll per player, whose worst would only restate its best.
      worst: null,
      badge: {
        label: entry.rarestBadgeLabel ? clipped(entry.rarestBadgeLabel.toUpperCase(), DAILY_LAYOUT.badgeLabelLimit) : "NO BADGES",
        arrowTo: null,
        ep: entry.rarestBadgeEp ? `+${formatEp(entry.rarestBadgeEp)} EP` : "",
        desc: clipped(entry.rarestBadgeDesc ?? "", DAILY_LAYOUT.badgeDescLimit),
      },
      total: `${formatEp(entry.creditedEp)} EP`,
    })),
  };
}

/**
 * The Hall of Shame. Every row is one reroll that came out behind, read left to
 * right as the trade it was: what they kept, what they gave up, the tier it
 * fell through, and the damage. Ranked by that damage, which is why EP LOST
 * sits in the rightmost column - the same place the other two boards keep the
 * figure they are ranked by.
 */
function regretsBoard(entries: RngdleRegretEntry[], totals: RngdleRegretTotals): RngdleBoard {
  return {
    heading: "HALL OF SHAME",
    caption: `${totals.regrets} ${totals.regrets === 1 ? "REGRET" : "REGRETS"}  •  ${formatEp(totals.epBurned)} EP BURNED`,
    layout: REGRETS_LAYOUT,
    columns: { player: "PLAYER", score: "KEPT", worst: "GAVE UP", badge: "TIER LOST", total: "EP LOST" },
    footerLeft: "Ranked by EP given up to a reroll",
    footerRight: "One reroll a day. No takebacks.",
    rows: entries.slice(0, 10).map((entry, index) => ({
      // A player can hold several rows, so the day is part of the identity.
      key: `${entry.userId}:${entry.gameDay}`,
      rank: index + 1,
      name: entry.displayName,
      // The penalty rides on what they kept, since that is the number it was
      // taken off - the roll they gave up never had one.
      score: {
        top: `${formatEp(entry.keptEp)} EP`,
        bottom: `ROLL ${entry.keptNumber}`,
        penaltyPercent: entry.penaltyPercent,
      },
      worst: {
        top: `${formatEp(entry.gaveUpEp)} EP`,
        bottom: `ROLL ${entry.gaveUpNumber}`,
        penaltyPercent: null,
      },
      badge: {
        label: entry.gaveUpRarityLabel,
        // A reroll can lose EP without losing a tier. Naming the same tier
        // twice either side of an arrow would invent a fall that never
        // happened, so it is stated once.
        arrowTo: entry.gaveUpRarityLabel === entry.keptRarityLabel ? null : entry.keptRarityLabel,
        ep: "",
        desc: entry.gameDay,
      },
      total: `-${formatEp(entry.epLost)} EP`,
    })),
  };
}

/**
 * A score column. The best and worst cells share it, so the two ends of a
 * career cannot drift into different type or lose the reroll marker apart.
 */
function BoardScoreCell({ width, score, topColor, subColor }: {
  width: number;
  score: RngdleBoardScore;
  topColor: string;
  subColor: string;
}) {
  return (
    <div style={{ width, display: "flex", flexDirection: "column" }}>
      <div style={{ color: topColor, fontFamily: "Geist Mono", fontSize: 13, fontWeight: 700, display: "flex" }}>{score.top}</div>
      <div style={{ marginTop: 3, color: subColor, fontFamily: "Geist Mono", fontSize: 8.5, display: "flex", alignItems: "center", gap: 3 }}>
        <div style={{ display: "flex" }}>{score.bottom}</div>
        {score.penaltyPercent === null ? null : (
          <svg width="9" height="9" viewBox="0 0 15 15"><path d="M12.4 5.2A5.2 5.2 0 1 0 12 10.4" fill="none" stroke={subColor} strokeWidth="2" strokeLinecap="round" /><path d="M10.1 3.9h2.8v2.8" fill="none" stroke={subColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        )}
        {score.penaltyPercent === null ? null : <div style={{ display: "flex" }}>-{score.penaltyPercent}%</div>}
      </div>
    </div>
  );
}

/**
 * The badge column. The arrow is the card's DowngradeArrow rather than a typed
 * U+2192, which the bundled font would render as tofu.
 */
function BoardBadgeCell({ width, badge, labelColor, epColor }: {
  width: number;
  badge: RngdleBoardBadge;
  labelColor: string;
  epColor: string;
}) {
  const labelStyle = { color: labelColor, fontFamily: "Geist Mono", fontSize: 11, fontWeight: 700, display: "flex" } as const;
  return (
    <div style={{ width, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={labelStyle}>{badge.label}</div>
        {badge.arrowTo === null ? null : <DowngradeArrow color={epColor} size={11} />}
        {badge.arrowTo === null ? null : <div style={labelStyle}>{badge.arrowTo}</div>}
        {badge.ep === "" ? null : (
          <div style={{ color: epColor, fontFamily: "Geist Mono", fontSize: 8.5, fontWeight: 700, display: "flex" }}>{badge.ep}</div>
        )}
      </div>
      <div style={{ marginTop: 3, color: "#8a8fa0", fontSize: 8.5, display: "flex" }}>{badge.desc}</div>
    </div>
  );
}

function leaderboardImage(board: RngdleBoard) {
  const layout = board.layout;
  return referenceShell(
    <>
      <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 790, background: "linear-gradient(90deg, rgba(0,112,150,.20), rgba(28,24,58,.05) 46%, rgba(103,43,178,.34))", display: "flex" }} />
      <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 790, background: "radial-gradient(circle at 62% 8%, rgba(124,58,205,.40) 0%, rgba(0,0,0,0) 52%)", display: "flex" }} />
      <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 790, background: "radial-gradient(circle at 6% 94%, rgba(0,140,180,.22) 0%, rgba(0,0,0,0) 46%)", display: "flex" }} />
      <LeaderboardOrbitBackdrop />
      <div style={{ position: "absolute", left: 58, top: 42, display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 27, fontWeight: 950, display: "flex" }}>RNGDLE</div>
        <div style={{ marginTop: 17, fontSize: 37, fontWeight: 950, display: "flex" }}>{board.heading}</div>
        <div style={{ marginTop: 8, color: "#7f8ca5", fontSize: 15, display: "flex" }}>{board.caption}</div>
      </div>
      <div style={{ position: "absolute", left: 51, top: 173, width: 1098, height: 14, display: "flex", alignItems: "center", color: "#6d7a91", fontSize: 10, fontWeight: 700, letterSpacing: 1.4 }}>
        <div style={{ width: layout.rank, paddingLeft: 19, display: "flex" }}>#</div>
        <div style={{ width: layout.name, display: "flex" }}>{board.columns.player}</div>
        <div style={{ width: layout.score, display: "flex" }}>{board.columns.score}</div>
        {board.columns.worst === null ? null : <div style={{ width: layout.worst, display: "flex" }}>{board.columns.worst}</div>}
        <div style={{ width: layout.badge, display: "flex" }}>{board.columns.badge}</div>
        <div style={{ width: layout.total, paddingRight: 15, justifyContent: "flex-end", display: "flex" }}>{board.columns.total}</div>
      </div>
      <div style={{ position: "absolute", left: 51, top: 193, width: 1098, display: "flex", flexDirection: "column", gap: 7 }}>
        {board.rows.map((entry, index) => {
          const accent = index === 0 ? "#24d8ff" : index <= 6 ? "#f0a300" : "#ff4caf";
          const borderColor = index === 0 ? "#24d8ff" : index <= 6 ? "#b87900" : "#26303f";
          const gamesColor = index === 0 ? "#24d8ff" : index <= 6 ? "#ffad00" : "#ff55b6";
          const bestColor = index >= 7 ? "#ff55b6" : "#f2f0f7";
          const rankColor = index === 0 ? "#ffd02e" : index === 1 ? "#dce5ef" : index === 2 ? "#ff8735" : "#718098";
          return (
            <div key={entry.key} style={{ width: 1098, height: 47, borderRadius: 14, border: `1px solid ${borderColor}`, background: index <= 6 ? "linear-gradient(90deg, rgba(28,35,40,.88), rgba(65,43,81,.65))" : "linear-gradient(90deg, rgba(18,25,34,.82), rgba(28,25,45,.64))", display: "flex", alignItems: "center" }}>
              <div style={{ width: layout.rank, paddingLeft: 19, color: rankColor, fontFamily: "Geist Mono", fontSize: 17, fontWeight: 700, display: "flex" }}>#{entry.rank}</div>
              <div style={{ width: layout.name, fontSize: 17, fontWeight: 700, display: "flex" }}>{clipped(entry.name, layout.nameLimit)}</div>
              <BoardScoreCell width={layout.score} score={entry.score} topColor={gamesColor} subColor={index >= 7 ? accent : "#b7b5c5"} />
              {/* Unranked colouring on purpose: the worst column stays the dim
                  twin of the best one on every row, so the top three do not
                  light up the number they would rather not be shown by. */}
              {entry.worst === null ? null : (
                <BoardScoreCell width={layout.worst} score={entry.worst} topColor="#b7b5c5" subColor="#8a8fa0" />
              )}
              <BoardBadgeCell
                width={layout.badge}
                badge={entry.badge}
                labelColor={bestColor}
                epColor={index >= 7 ? accent : "#b7b5c5"}
              />
              <div style={{ width: layout.total, paddingRight: 15, justifyContent: "flex-end", whiteSpace: "nowrap", fontFamily: "Geist Mono", fontSize: 15, fontWeight: 700, letterSpacing: -.25, display: "flex" }}>{entry.total}</div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 58, bottom: 37, color: "#718098", fontSize: 13, display: "flex" }}>{board.footerLeft}</div>
      <div style={{ position: "absolute", left: 900, width: 242, bottom: 37, color: "#718098", fontSize: 13, justifyContent: "flex-end", display: "flex" }}>{board.footerRight}</div>
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

/**
 * The roll animation's canvas. Rasterising it smaller would roughly halve
 * render time, but it cannot be done by scaling the full-size card: satori
 * does not apply a CSS transform to absolutely-positioned descendants on the
 * same terms as their static parents, so composited chips land in the wrong
 * place and the header and footer vanish. Doing it properly means laying the
 * animation out at a smaller size directly, which is a real refactor rather
 * than a constant.
 */
export const GIF_WIDTH = RNGDLE_DISCORD_WIDTH;
export const GIF_HEIGHT = RNGDLE_DISCORD_HEIGHT;

// Per-phase render timings, for diagnosing slow rolls on deployed instances
// where the CPU is far slower than a dev machine. Off unless explicitly set.
const RENDER_TIMING = process.env.BITEDLE_RNGDLE_TIMING === "1";

function phaseTimer() {
  let last = Date.now();
  const marks: string[] = [];
  return {
    mark(label: string) {
      if (!RENDER_TIMING) return;
      marks.push(`${label} ${Date.now() - last}ms`);
      last = Date.now();
    },
    log(prefix: string) {
      if (RENDER_TIMING) console.log(`${prefix}: ${marks.join(" | ")}`);
    },
  };
}

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

/**
 * Risk chrome and readouts, cached for the life of the instance. Nothing here
 * depends on which roll is being rerolled — the shell, fill, and dot have two
 * variants each, and a given percentage always draws the same way — so these
 * are reused by every reroll from every player on the instance.
 */
const riskPieceCache = new Map<string, Promise<Buffer>>();

function cachedRiskPiece(key: string, make: () => Promise<Buffer>): Promise<Buffer> {
  let piece = riskPieceCache.get(key);
  if (!piece) {
    piece = make();
    riskPieceCache.set(key, piece);
    piece.catch(() => riskPieceCache.delete(key));
  }
  return piece;
}

/** Exposes the sweep to the verifier, which checks the dot/readout coupling. */
export function rngdleRiskSweepForTest(finalPercent: number): RngdleRiskFrame[] {
  return riskAnimationFrames(finalPercent);
}

export async function renderRngdleRiskAnimation(finalPercent: number): Promise<RngdleRiskAnimation> {
  const timer = phaseTimer();
  const frames = riskAnimationFrames(finalPercent);
  const states = [false, true];

  const [shells, fills, dots] = await Promise.all([
    Promise.all(states.map((locked) => cachedRiskPiece(`shell:${locked}`, () => render(
      riskShellImage(locked), RNGDLE_DISCORD_RISK_WIDTH, RNGDLE_DISCORD_RISK_HEIGHT,
    )))),
    Promise.all(states.map((locked) => cachedRiskPiece(`fill:${locked}`, () => render(
      riskFillImage(locked), RISK_TRACK.width, RISK_FILL_HEIGHT,
    )))),
    Promise.all(states.map((locked) => cachedRiskPiece(`dot:${locked}`, () => render(
      riskDotImage(locked), RISK_DOT_BOX, RISK_DOT_BOX,
    )))),
  ]);
  const pieceFor = (list: Buffer[], locked: boolean) => list[locked ? 1 : 0];
  timer.mark("chrome");

  const wanted = new Map<string, RngdleRiskFrame>();
  for (const frame of frames) wanted.set(`${frame.percent}:${frame.locked}`, frame);
  const numbers = new Map<string, Buffer>();
  await mapLimit([...wanted.entries()], RENDER_CONCURRENCY, async ([key, frame]) => {
    numbers.set(key, await cachedRiskPiece(`number:${key}`, () => render(
      riskNumberImage(frame.percent, frame.locked), RISK_NUMBER_RECT.width, RISK_NUMBER_RECT.height,
    )));
  });
  timer.mark(`numbers(${wanted.size})`);

  const frameBytes = RNGDLE_DISCORD_RISK_WIDTH * RNGDLE_DISCORD_RISK_HEIGHT * 4;
  const stacked = Buffer.allocUnsafe(frameBytes * frames.length);
  const trackCentreY = RISK_TRACK.top + Math.round(RISK_TRACK.height / 2);
  await mapLimit(frames, RENDER_CONCURRENCY, async (frame, index) => {
    const overlays: Array<{ input: Buffer; left: number; top: number }> = [];

    const fillWidth = Math.round(frame.position * RISK_TRACK.width);
    if (fillWidth > 0) {
      overlays.push({
        input: await sharp(pieceFor(fills, frame.locked))
          .extract({ left: 0, top: 0, width: fillWidth, height: RISK_FILL_HEIGHT })
          .png()
          .toBuffer(),
        left: RISK_TRACK.left + 1,
        top: RISK_TRACK.top + 1,
      });
    }

    overlays.push({
      input: numbers.get(`${frame.percent}:${frame.locked}`)!,
      left: RISK_NUMBER_RECT.left,
      top: RISK_NUMBER_RECT.top,
    });

    // The dot is placed by its centre; the sprite carries its own glow margin.
    const centreX = RISK_TRACK.left + Math.round(frame.position * RISK_TRACK.width);
    overlays.push({
      input: pieceFor(dots, frame.locked),
      left: centreX - RISK_DOT_BOX / 2,
      top: trackCentreY - RISK_DOT_BOX / 2,
    });

    const { data, info } = await sharp(pieceFor(shells, frame.locked))
      .composite(overlays)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.width !== RNGDLE_DISCORD_RISK_WIDTH || info.height !== RNGDLE_DISCORD_RISK_HEIGHT || info.channels !== 4) {
      throw new Error("RNGDLE risk frame rendered at an unexpected size.");
    }
    data.copy(stacked, index * frameBytes);
  });
  timer.mark(`composite(${frames.length})`);

  const animation = await sharp(stacked, {
    raw: {
      width: RNGDLE_DISCORD_RISK_WIDTH,
      height: RNGDLE_DISCORD_RISK_HEIGHT * frames.length,
      channels: 4,
      pageHeight: RNGDLE_DISCORD_RISK_HEIGHT,
    },
  }).gif({ loop: 1, delay: frames.map((frame) => frame.delay), colours: 64, effort: 1, interFrameMaxError: GIF_INTER_FRAME_MAX_ERROR }).toBuffer();
  timer.mark("gif-encode");
  timer.log(`rngdle: risk ${finalPercent}%`);

  return { animation, durationMs: frames.reduce((total, frame) => total + frame.delay, 0) };
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

export function renderRngdleDiscordProfile(profile: RngdleUserProfile): Promise<Buffer> {
  return render(
    profileImage(profile),
    RNGDLE_DISCORD_PROFILE_WIDTH,
    RNGDLE_DISCORD_PROFILE_HEIGHT,
  );
}

export function renderRngdleDiscordLeaderboard(entries: RngdleLeaderboardEntry[], totalPlayers = entries.length): Promise<Buffer> {
  return render(
    leaderboardImage(allTimeBoard(entries, totalPlayers)),
    RNGDLE_DISCORD_LEADERBOARD_WIDTH,
    RNGDLE_DISCORD_LEADERBOARD_HEIGHT,
  );
}

export function renderRngdleDiscordRegrets(
  entries: RngdleRegretEntry[],
  totals: RngdleRegretTotals = { regrets: entries.length, epBurned: entries.reduce((sum, entry) => sum + entry.epLost, 0) },
): Promise<Buffer> {
  return render(
    leaderboardImage(regretsBoard(entries, totals)),
    RNGDLE_DISCORD_LEADERBOARD_WIDTH,
    RNGDLE_DISCORD_LEADERBOARD_HEIGHT,
  );
}

export function renderRngdleDiscordDailyLeaderboard(
  standings: RngdleDailyStanding[],
  gameDay: string,
  totalPlayers = standings.length,
): Promise<Buffer> {
  return render(
    leaderboardImage(dailyBoard(standings, gameDay, totalPlayers)),
    RNGDLE_DISCORD_LEADERBOARD_WIDTH,
    RNGDLE_DISCORD_LEADERBOARD_HEIGHT,
  );
}

export interface RngdleAnimationAssets {
  animation: Buffer;
  /** One pass through the frames. Multiply by `loops` for total playback. */
  durationMs: number;
  loops: number;
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
  const timer = phaseTimer();
  const frames = animationFrames(result);
  const visible = result.badges.slice(0, 15);

  // Two base cards, because the backdrop itself is part of the reveal: frames
  // before the number lands wear the pending theme, and everything after wears
  // the rarity's. Each frame's panel patch is drawn over the matching base.
  const [basePending, baseSettled, badgeStrip] = await Promise.all([
    render(
      resultCardImage(result, playerName, rank, playerCount, stats, panelViewForFrame(result, frames[0]), [], "empty"),
      GIF_WIDTH,
      GIF_HEIGHT,
    ),
    render(
      resultCardImage(result, playerName, rank, playerCount, stats, stillPanelView(result), [], "empty"),
      GIF_WIDTH,
      GIF_HEIGHT,
    ),
    render(badgeStripImage(visible, cardTheme(result, true).primary), BADGE_GRID.width, BADGE_GRID.height),
  ]);
  timer.mark("bases+strip");

  // Chips carry a transparent margin, so they blend onto whichever backdrop
  // the frame beneath them is wearing.
  const rects = resultBadgeRects(visible);
  const chipCrops: Buffer[] = [];
  for (const rect of rects) {
    chipCrops.push(await sharp(badgeStrip).extract(rect).png().toBuffer());
  }
  // Panel patches are deduplicated: the two frames of each badge reveal share
  // identical panel content, only the chip fade differs.
  const viewKey = (view: RngdlePanelView) => JSON.stringify(view);
  const panelPatches = new Map<string, Buffer>();
  const uniqueViews = new Map<string, RngdlePanelView>();
  for (const frame of frames) {
    const view = panelViewForFrame(result, frame);
    uniqueViews.set(viewKey(view), view);
  }
  // Pending panels carry no glow, so they are cheap to render outright.
  // Settled panels all share one glowing base and differ only in their EP
  // total, so that base is rendered once and each frame composites a cheap
  // EP layer onto it.
  const views = [...uniqueViews.values()];
  const pending = views.filter((view) => !view.settled);
  const settled = views.filter((view) => view.settled);
  const baseKey = (view: RngdlePanelView) => String(view.showPenalty);
  const settledBases = new Map<string, Buffer>();

  await Promise.all([
    mapLimit(pending, RENDER_CONCURRENCY, async (view) => {
      panelPatches.set(viewKey(view), await render(
        panelPatchImage(result, stats, view),
        PANEL_RECT.width,
        PANEL_RECT.height,
      ));
    }),
    mapLimit([...new Map(settled.map((view) => [baseKey(view), view])).values()], RENDER_CONCURRENCY, async (view) => {
      settledBases.set(baseKey(view), await render(
        panelPatchImage(result, stats, view, "base"),
        PANEL_RECT.width,
        PANEL_RECT.height,
      ));
    }),
  ]);

  await mapLimit(settled, RENDER_CONCURRENCY, async (view) => {
    const epLayer = await render(
      panelPatchImage(result, stats, view, "ep"),
      PANEL_RECT.width,
      PANEL_RECT.height,
    );
    panelPatches.set(viewKey(view), await sharp(settledBases.get(baseKey(view))!)
      .composite([{ input: epLayer, left: 0, top: 0 }])
      .png()
      .toBuffer());
  });
  timer.mark(`panels(${uniqueViews.size}:${settledBases.size}base+${settled.length}ep+${pending.length}plain)`);

  const frameBytes = GIF_WIDTH * GIF_HEIGHT * 4;
  const stacked = Buffer.allocUnsafe(frameBytes * frames.length);
  await mapLimit(frames, RENDER_CONCURRENCY, async (frame, index) => {
    const overlays: Array<{ input: Buffer; left: number; top: number }> = [
      { input: panelPatches.get(viewKey(panelViewForFrame(result, frame)))!, left: PANEL_RECT.left, top: PANEL_RECT.top },
    ];
    const revealedChips = Math.min(frame.badgeIndex, rects.length);
    for (let chip = 0; chip < revealedChips; chip += 1) {
      overlays.push({
        input: chipCrops[chip],
        left: BADGE_GRID.left + rects[chip].left,
        top: BADGE_GRID.top + rects[chip].top,
      });
    }
    const frameBase = panelViewForFrame(result, frame).settled ? baseSettled : basePending;
    const { data, info } = await sharp(frameBase).composite(overlays).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== GIF_WIDTH || info.height !== GIF_HEIGHT || info.channels !== 4) {
      throw new Error("RNGDLE frame rendered at an unexpected size.");
    }
    data.copy(stacked, index * frameBytes);
  });
  timer.mark(`composite(${frames.length})`);

  const animation = await sharp(stacked, {
    raw: {
      width: GIF_WIDTH,
      height: GIF_HEIGHT * frames.length,
      channels: 4,
      pageHeight: GIF_HEIGHT,
    },
  }).gif({ loop: ROLL_REVEAL_LOOPS, delay: frames.map((frame) => frame.delay), colours: 128, effort: 1, interFrameMaxError: GIF_INTER_FRAME_MAX_ERROR }).toBuffer();
  timer.mark("gif-encode");
  timer.log(`rngdle: roll ${result.number}`);
  return {
    animation,
    durationMs: frames.reduce((total, frame) => total + frame.delay, 0),
    loops: ROLL_REVEAL_LOOPS,
  };
}

export async function renderRngdleDiscordAssets(
  result: RngdleResult,
  playerName: string,
  rank: number,
  playerCount: number,
  stats: RngdleResultCardStats,
): Promise<RngdleDiscordAssets> {
  const { animation, durationMs, loops } = await renderRngdleDiscordAnimation(result, playerName, rank, playerCount, stats);
  return {
    animation,
    still: await renderRngdleDiscordStill(result, playerName, rank, playerCount, stats),
    durationMs,
    loops,
  };
}
