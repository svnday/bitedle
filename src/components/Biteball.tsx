import type { BiteballAnswer } from "@/lib/biteball";

export type BiteballVisualState = "idle" | "shaking" | "revealing" | "revealed";

export default function Biteball({
  state,
  answer,
}: {
  state: BiteballVisualState;
  answer: BiteballAnswer | null;
}) {
  const showingAnswer = state === "revealing" || state === "revealed";
  const accessibleLabel =
    state === "shaking"
      ? "Biteball is considering your question"
      : showingAnswer && answer
        ? `Biteball answered: ${answer.text}`
        : "Biteball is ready for a question";

  return (
    <div className={`biteball-oracle biteball-oracle--${state}`} role="img" aria-label={accessibleLabel}>
      <div className="biteball-orbit" aria-hidden="true" />
      <div className="biteball-sphere-wrap">
        <div className="biteball-shadow" aria-hidden="true" />
        <div className="biteball-sphere" aria-hidden="true">
          <div className="biteball-gloss" />
          <div className="biteball-face biteball-eight-face">
            <span>8</span>
          </div>
          <div className={`biteball-face biteball-answer-face biteball-answer--${answer?.category ?? "none"}`}>
            <div className="biteball-answer-well">
              <div className="biteball-answer-triangle" />
              <span className="biteball-answer-text">{answer?.text ?? ""}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="biteball-stage-line" aria-hidden="true" />
    </div>
  );
}
