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
  { delay: 360, x: 0, y: 0, rotation: 0, reveal: 0 },
  { delay: 130, x: -14, y: -3, rotation: -7, reveal: 0 },
  { delay: 130, x: 15, y: 4, rotation: 8, reveal: 0 },
  { delay: 130, x: -13, y: 6, rotation: -7, reveal: 0 },
  { delay: 130, x: 14, y: -5, rotation: 7, reveal: 0 },
  { delay: 130, x: -11, y: -4, rotation: -5, reveal: 0 },
  { delay: 130, x: 11, y: 4, rotation: 5, reveal: 0 },
  { delay: 130, x: -9, y: 3, rotation: -4, reveal: 0 },
  { delay: 130, x: 9, y: -3, rotation: 4, reveal: 0 },
  { delay: 130, x: -7, y: -2, rotation: -3, reveal: 0 },
  { delay: 130, x: 6, y: 2, rotation: 3, reveal: 0 },
  { delay: 130, x: -4, y: 1, rotation: -2, reveal: 0 },
  { delay: 130, x: 3, y: 0, rotation: 1, reveal: 0 },
  { delay: 320, x: 0, y: 0, rotation: 0, reveal: 0 },
  { delay: 180, x: 0, y: 0, rotation: 0, reveal: 0.18 },
  { delay: 200, x: 0, y: 0, rotation: 0, reveal: 0.42 },
  { delay: 220, x: 0, y: 0, rotation: 0, reveal: 0.68 },
  { delay: 240, x: 0, y: 0, rotation: 0, reveal: 0.88 },
  { delay: 1_250, x: 0, y: 0, rotation: 0, reveal: 1 },
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

function wrappedLines(value: string, maxCharacters: number, maxLines: number): string[] {
  const words = value.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];

  for (const originalWord of words) {
    const chunks: string[] = [];
    let word = originalWord;
    while (word.length > maxCharacters) {
      chunks.push(word.slice(0, maxCharacters));
      word = word.slice(maxCharacters);
    }
    if (word) chunks.push(word);

    for (const chunk of chunks) {
      const current = lines.at(-1);
      if (current && `${current} ${chunk}`.length <= maxCharacters) {
        lines[lines.length - 1] = `${current} ${chunk}`;
      } else {
        lines.push(chunk);
      }
    }
  }

  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, maxLines);
  visible[maxLines - 1] = `${visible[maxLines - 1].slice(0, maxCharacters - 1).trimEnd()}…`;
  return visible;
}

function answerLines(answer: string): string[] {
  return wrappedLines(answer.toUpperCase(), 11, 3);
}

function frameImage(question: string, answer: BiteballAnswer, frame: BiteballFrame) {
  const showingAnswer = frame.reveal > 0;
  const questionLines = wrappedLines(question, 28, 3);
  const lines = answerLines(answer.text);
  const categoryLabel =
    answer.category === "affirmative"
      ? "YES"
      : answer.category === "negative"
        ? "NO"
        : "MAYBE";
  const categoryColor =
    answer.category === "affirmative"
      ? "#7ec99a"
      : answer.category === "negative"
        ? "#e28578"
        : "#e8c764";

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
          left: 360,
          top: 28,
          width: 1,
          height: 349,
          background: "linear-gradient(180deg, transparent 0%, #2c3a36 20%, #2c3a36 80%, transparent 100%)",
          opacity: 0.7,
          display: "flex",
        }}
      />
      {[
        { left: 341, top: 66, size: 3, opacity: 0.7 },
        { left: 355, top: 92, size: 2, opacity: 0.45 },
        { left: 345, top: 312, size: 2, opacity: 0.5 },
      ].map((spark) => (
        <div
          key={`${spark.left}-${spark.top}`}
          style={{
            position: "absolute",
            left: spark.left,
            top: spark.top,
            width: spark.size,
            height: spark.size,
            borderRadius: 9999,
            backgroundColor: "#e8c764",
            opacity: spark.opacity,
            display: "flex",
          }}
        />
      ))}
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "#71807b",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 1.7,
            marginTop: 3,
          }}
        >
          <div style={{ width: 24, height: 1, backgroundColor: "#53635e", display: "flex" }} />
          20 CLASSIC RESPONSES
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 38,
          top: 139,
          width: 304,
          height: 144,
          padding: "18px 22px 16px",
          border: "1px solid #34413d",
          borderRadius: 20,
          background: "linear-gradient(145deg, #121c19 0%, #0d1513 100%)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.025), 0 12px 30px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "#879792",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 2,
            }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: 9999,
                backgroundColor: "#e8c764",
                boxShadow: "0 0 10px rgba(232,199,100,0.55)",
                display: "flex",
              }}
            />
            YOUR QUESTION
          </div>
          <div style={{ color: "#52615c", fontSize: 9, fontWeight: 700, letterSpacing: 1.5 }}>
            QUERY 01
          </div>
        </div>
        <div
          style={{
            color: "#f7f3e8",
            fontSize: questionLines.length === 3 ? 18 : 20,
            fontWeight: 650,
            lineHeight: 1.2,
            marginTop: 10,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {questionLines.map((line, index) => (
            <div key={`${line}-${index}`} style={{ display: "flex" }}>
              {line}
            </div>
          ))}
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
        <div
          style={{
            width: 7,
            height: 7,
            marginRight: 9,
            borderRadius: 9999,
            backgroundColor: showingAnswer ? categoryColor : "#53625d",
            boxShadow: showingAnswer ? `0 0 12px ${categoryColor}` : "none",
            display: "flex",
          }}
        />
        {showingAnswer ? `${categoryLabel} · THE BALL HAS SPOKEN` : "SHAKING · ANSWER FORMING"}
      </div>

      <div
        style={{
          position: "absolute",
          right: 46,
          top: 28,
          display: "flex",
          alignItems: "center",
          gap: 7,
          color: "#7f918b",
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: 1.8,
        }}
      >
        <div
          style={{
            width: 5,
            height: 5,
            borderRadius: 9999,
            backgroundColor: showingAnswer ? categoryColor : "#6a7a75",
            display: "flex",
          }}
        />
        ORACLE ONLINE
      </div>

      <div
        style={{
          position: "absolute",
          right: 48,
          bottom: 33,
          width: 284,
          height: 34,
          borderRadius: 9999,
          background: "radial-gradient(ellipse at center, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0) 72%)",
          opacity: 0.7,
          display: "flex",
        }}
      />

      <div
        style={{
          position: "absolute",
          right: 37,
          top: 52,
          width: 300,
          height: 300,
          borderRadius: 9999,
          background: "radial-gradient(circle at 35% 25%, #414846 0%, #1b211f 27%, #080b0a 58%, #020303 78%)",
          border: "2px solid #2c3532",
          boxShadow: "0 26px 42px rgba(0, 0, 0, 0.58)",
          transform: `translate(${frame.x}px, ${frame.y}px) rotate(${frame.rotation}deg)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {[
          { left: 147, top: 13, width: 6, height: 2 },
          { left: 13, top: 149, width: 2, height: 6 },
          { left: 285, top: 149, width: 2, height: 6 },
          { left: 147, top: 285, width: 6, height: 2 },
        ].map((tick) => (
          <div
            key={`${tick.left}-${tick.top}`}
            style={{
              position: "absolute",
              left: tick.left,
              top: tick.top,
              width: tick.width,
              height: tick.height,
              borderRadius: 9999,
              backgroundColor: "rgba(184,201,194,0.28)",
              display: "flex",
            }}
          />
        ))}
        <div
          style={{
            position: "absolute",
            width: 270,
            height: 270,
            borderRadius: 9999,
            border: "1px solid rgba(116,135,128,0.18)",
            boxShadow: "inset 0 0 26px rgba(255,255,255,0.025)",
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 50,
            top: 34,
            width: 88,
            height: 30,
            borderRadius: 9999,
            background: "linear-gradient(90deg, rgba(255,255,255,0.16), rgba(255,255,255,0.035))",
            transform: "rotate(-30deg)",
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 43,
            bottom: 66,
            width: 45,
            height: 10,
            borderRadius: 9999,
            backgroundColor: "rgba(255,255,255,0.035)",
            transform: "rotate(-47deg)",
            display: "flex",
          }}
        />
        <div
          style={{
            width: 188,
            height: 188,
            borderRadius: 9999,
            background: showingAnswer
              ? `radial-gradient(circle at 50% 54%, rgba(43,91,199,${0.18 * frame.reveal}) 0%, #090c0d 59%, #050707 100%)`
              : "radial-gradient(circle at 48% 45%, #121716 0%, #080a0a 63%, #040505 100%)",
            border: "1px solid #39433f",
            boxShadow: showingAnswer
              ? `inset 0 0 28px rgba(55,109,224,${0.18 * frame.reveal}), 0 0 18px rgba(48,98,206,${0.12 * frame.reveal})`
              : "inset 0 0 24px rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {!showingAnswer ? (
            <div
              style={{
                width: 116,
                height: 116,
                borderRadius: 9999,
                background: "radial-gradient(circle at 38% 30%, #ffffff 0%, #f2efe7 58%, #d8d3c8 100%)",
                color: "#090b0b",
                fontSize: 72,
                lineHeight: 1,
                fontWeight: 900,
                border: "2px solid #c9c4b9",
                boxShadow: "0 0 0 5px rgba(255,255,255,0.035), 0 8px 16px rgba(0,0,0,0.45)",
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
                width: 168,
                height: 146,
                opacity: frame.reveal,
                transform: `scale(${0.86 + frame.reveal * 0.14})`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                width="168"
                height="146"
                viewBox="0 0 168 146"
                style={{ position: "absolute", left: 0, top: 0 }}
              >
                <defs>
                  <linearGradient id="biteball-blue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#3169dc" />
                    <stop offset="1" stopColor="#17388f" />
                  </linearGradient>
                </defs>
                <polygon
                  points="84,3 165,141 3,141"
                  fill="url(#biteball-blue)"
                  stroke="#5e8af0"
                  strokeWidth="1.25"
                />
                <polygon
                  points="84,10 157,136 11,136"
                  fill="none"
                  stroke="rgba(191,211,255,0.16)"
                  strokeWidth="1"
                />
                <circle cx="84" cy="22" r="2.5" fill="rgba(226,236,255,0.5)" />
                <circle cx="34" cy="124" r="1.5" fill="rgba(226,236,255,0.3)" />
                <circle cx="137" cy="125" r="1" fill="rgba(226,236,255,0.25)" />
              </svg>
              <div
                style={{
                  position: "absolute",
                  left: 20,
                  top: lines.length === 3 ? 77 : lines.length === 2 ? 81 : 88,
                  width: 128,
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

export function renderBiteballDiscordStill(
  question: string,
  answer: BiteballAnswer,
): Promise<Buffer> {
  return renderFrame(question, answer, FRAMES.at(-1)!);
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
