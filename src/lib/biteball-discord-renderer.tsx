import { ImageResponse } from "next/og";
import sharp from "sharp";
import type { BiteballAnswer } from "./biteball";

export const BITEBALL_DISCORD_WIDTH = 720;
export const BITEBALL_DISCORD_HEIGHT = 405;
export const BITEBALL_DISCORD_GIF_FILENAME = "biteball-reveal.gif";
export const BITEBALL_DISCORD_PNG_FILENAME = "biteball-answer.png";

interface BiteballFrame {
  delay: number;
  x: number;
  y: number;
  rotation: number;
  reveal: number;
}

const FRAMES: readonly BiteballFrame[] = [
  { delay: 240, x: 0, y: 0, rotation: 0, reveal: 0 },
  { delay: 110, x: -13, y: -2, rotation: -7, reveal: 0 },
  { delay: 110, x: 14, y: 3, rotation: 8, reveal: 0 },
  { delay: 110, x: -11, y: 5, rotation: -6, reveal: 0 },
  { delay: 110, x: 12, y: -4, rotation: 7, reveal: 0 },
  { delay: 110, x: -8, y: -3, rotation: -4, reveal: 0 },
  { delay: 110, x: 8, y: 3, rotation: 4, reveal: 0 },
  { delay: 110, x: -4, y: 1, rotation: -2, reveal: 0 },
  { delay: 110, x: 3, y: 0, rotation: 1, reveal: 0 },
  { delay: 250, x: 0, y: 0, rotation: 0, reveal: 0 },
  { delay: 240, x: 0, y: 0, rotation: 0, reveal: 0.55 },
  { delay: 950, x: 0, y: 0, rotation: 0, reveal: 1 },
] as const;

export const BITEBALL_DISCORD_ANIMATION_MS = FRAMES.reduce(
  (total, frame) => total + frame.delay,
  0,
);

export interface BiteballDiscordAssets {
  animation: Buffer;
  still: Buffer;
  durationMs: number;
}

function imageQuestion(question: string): string {
  const normalized = question.replace(/\s+/g, " ").trim();
  return normalized.length <= 105 ? normalized : `${normalized.slice(0, 104)}…`;
}

function answerLines(answer: string): string[] {
  const words = answer.toUpperCase().split(/\s+/);
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (current && `${current} ${word}`.length <= 10) {
      lines[lines.length - 1] = `${current} ${word}`;
    } else {
      lines.push(word);
    }
  }
  return lines.slice(0, 3);
}

function frameImage(question: string, answer: BiteballAnswer, frame: BiteballFrame) {
  const showingAnswer = frame.reveal > 0;
  const lines = answerLines(answer.text);
  const categoryLabel =
    answer.category === "affirmative"
      ? "YES"
      : answer.category === "negative"
        ? "NO"
        : "MAYBE";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        overflow: "hidden",
        color: "#f7f3e8",
        background: "linear-gradient(145deg, #08100f 0%, #101817 54%, #070b0b 100%)",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 330,
          height: 330,
          right: -115,
          top: -155,
          borderRadius: 9999,
          backgroundColor: "#192522",
          opacity: 0.55,
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 260,
          height: 260,
          left: -120,
          bottom: -150,
          borderRadius: 9999,
          backgroundColor: "#17211f",
          opacity: 0.7,
          display: "flex",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 38,
          top: 31,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ color: "#e8c764", fontSize: 13, fontWeight: 800, letterSpacing: 4 }}>
          ASK THE ORACLE
        </div>
        <div style={{ fontSize: 42, fontWeight: 900, letterSpacing: -2, marginTop: 2 }}>
          BITEBALL
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 38,
          top: 135,
          width: 300,
          minHeight: 132,
          padding: "20px 22px",
          border: "1px solid #34413d",
          borderRadius: 20,
          backgroundColor: "#111917",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ color: "#879792", fontSize: 12, fontWeight: 800, letterSpacing: 2 }}>
          YOUR QUESTION
        </div>
        <div style={{ color: "#f7f3e8", fontSize: 21, fontWeight: 650, lineHeight: 1.25, marginTop: 10 }}>
          {imageQuestion(question)}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 60,
          bottom: 37,
          display: "flex",
          alignItems: "center",
          color: showingAnswer ? "#d7e6e1" : "#71807b",
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 1.4,
        }}
      >
        {showingAnswer ? `${categoryLabel} · THE BALL HAS SPOKEN` : "SHAKING · ANSWER FORMING"}
      </div>

      <div
        style={{
          position: "absolute",
          right: 53,
          top: 65,
          width: 286,
          height: 286,
          borderRadius: 9999,
          background: "radial-gradient(circle at 36% 27%, #353b3a 0%, #111514 34%, #030404 73%)",
          border: "2px solid #242b29",
          boxShadow: "0 26px 42px rgba(0, 0, 0, 0.58)",
          transform: `translate(${frame.x}px, ${frame.y}px) rotate(${frame.rotation}deg)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 48,
            top: 34,
            width: 82,
            height: 28,
            borderRadius: 9999,
            backgroundColor: "rgba(255, 255, 255, 0.11)",
            transform: "rotate(-30deg)",
            display: "flex",
          }}
        />
        <div
          style={{
            width: 174,
            height: 174,
            borderRadius: 9999,
            backgroundColor: "#090b0b",
            border: "1px solid #303735",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {!showingAnswer ? (
            <div
              style={{
                width: 112,
                height: 112,
                borderRadius: 9999,
                backgroundColor: "#f2efe7",
                color: "#090b0b",
                fontSize: 72,
                lineHeight: 1,
                fontWeight: 900,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              8
            </div>
          ) : (
            <div
              style={{
                position: "relative",
                width: 150,
                height: 130,
                opacity: frame.reveal,
                transform: `scale(${0.86 + frame.reveal * 0.14})`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                width="150"
                height="130"
                viewBox="0 0 150 130"
                style={{ position: "absolute", left: 0, top: 0 }}
              >
                <defs>
                  <linearGradient id="biteball-blue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#3169dc" />
                    <stop offset="1" stopColor="#17388f" />
                  </linearGradient>
                </defs>
                <polygon
                  points="75,3 147,125 3,125"
                  fill="url(#biteball-blue)"
                  stroke="#4d7be0"
                  strokeWidth="1"
                />
              </svg>
              <div
                style={{
                  position: "absolute",
                  left: 18,
                  top: lines.length === 3 ? 70 : lines.length === 2 ? 72 : 77,
                  width: 114,
                  color: "#f3f6ff",
                  fontSize:
                    lines.length === 1
                      ? 19
                      : lines.length === 2
                        ? lines.some((line) => line.length > 10)
                          ? 12
                          : 15
                        : lines.some((line) => line.length > 10)
                          ? 11
                          : 13,
                  fontWeight: 850,
                  lineHeight: 1.15,
                  textAlign: "center",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                {lines.map((line) => (
                  <div key={line} style={{ display: "flex" }}>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

async function renderFrame(
  question: string,
  answer: BiteballAnswer,
  frame: BiteballFrame,
): Promise<Buffer> {
  const response = new ImageResponse(frameImage(question, answer, frame), {
    width: BITEBALL_DISCORD_WIDTH,
    height: BITEBALL_DISCORD_HEIGHT,
  });
  return Buffer.from(await response.arrayBuffer());
}

export async function renderBiteballDiscordAssets(
  question: string,
  answer: BiteballAnswer,
): Promise<BiteballDiscordAssets> {
  const framePngs = await Promise.all(
    FRAMES.map((frame) => renderFrame(question, answer, frame)),
  );
  const rawFrames = await Promise.all(
    framePngs.map(async (png) => {
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (
        info.width !== BITEBALL_DISCORD_WIDTH ||
        info.height !== BITEBALL_DISCORD_HEIGHT ||
        info.channels !== 4
      ) {
        throw new Error("Biteball frame rendered at an unexpected size.");
      }
      return data;
    }),
  );

  const animation = await sharp(Buffer.concat(rawFrames), {
    raw: {
      width: BITEBALL_DISCORD_WIDTH,
      height: BITEBALL_DISCORD_HEIGHT * FRAMES.length,
      channels: 4,
      pageHeight: BITEBALL_DISCORD_HEIGHT,
    },
  })
    .gif({ loop: 1, delay: FRAMES.map((frame) => frame.delay), colours: 128, effort: 4 })
    .toBuffer();

  return {
    animation,
    still: framePngs.at(-1)!,
    durationMs: BITEBALL_DISCORD_ANIMATION_MS,
  };
}
