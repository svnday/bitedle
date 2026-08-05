"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  BITEBALL_MAX_QUESTION_LENGTH,
  BITEBALL_REVEAL_MS,
  BITEBALL_SETTLE_MS,
  BITEBALL_SHAKE_MS,
  selectBiteballAnswer,
  type BiteballAnswer,
} from "@/lib/biteball";
import type { GameMode } from "@/lib/types";
import Biteball, { type BiteballVisualState } from "./Biteball";
import GameNav from "./GameNav";

const REDUCED_SHAKE_MS = 120;
const REDUCED_REVEAL_MS = 220;

export default function BiteballDemo({
  onModeChange,
}: {
  onModeChange: (mode: GameMode) => void;
}) {
  const [question, setQuestion] = useState("");
  const [submittedQuestion, setSubmittedQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState<BiteballAnswer | null>(null);
  const [status, setStatus] = useState<BiteballVisualState>("idle");
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    if (status !== "revealed" || !answer || !submittedQuestion) return;
    resultRef.current?.focus();
  }, [answer, status, submittedQuestion]);

  const askBiteball = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === "shaking" || status === "revealing") return;

    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) {
      setError("Enter a question before asking Biteball.");
      inputRef.current?.focus();
      return;
    }

    clearTimers();
    const selectedAnswer = selectBiteballAnswer();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const shakeDuration = reducedMotion ? REDUCED_SHAKE_MS : BITEBALL_SHAKE_MS;
    const revealDuration = reducedMotion
      ? REDUCED_REVEAL_MS
      : BITEBALL_SETTLE_MS + BITEBALL_REVEAL_MS;

    setError(null);
    setSubmittedQuestion(normalizedQuestion);
    setAnswer(selectedAnswer);
    setStatus("shaking");

    timers.current.push(
      setTimeout(() => setStatus("revealing"), shakeDuration),
      setTimeout(() => setStatus("revealed"), shakeDuration + revealDuration),
    );
  };

  const reset = () => {
    clearTimers();
    setQuestion("");
    setSubmittedQuestion(null);
    setAnswer(null);
    setStatus("idle");
    setError(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const isAnimating = status === "shaking" || status === "revealing";
  const showCount = question.length >= BITEBALL_MAX_QUESTION_LENGTH - 30;

  return (
    <div className="biteball-lab flex min-h-screen flex-col">
      <GameNav mode="biteball" onModeChange={onModeChange} />
      <main className="biteball-lab-main">
        <div className="biteball-lab-shell">
          <header className="biteball-lab-header">
            <p className="biteball-eyebrow">Website divination lab</p>
            <h1>BITEBALL</h1>
            <p>
              Ask what&apos;s on your mind. Biteball will consult its twenty-sided answer die.
            </p>
          </header>

          <div className="biteball-lab-grid">
            <section className="biteball-question-card" aria-labelledby="biteball-question-title">
              <div>
                <span className="biteball-card-number">01</span>
                <p className="biteball-card-kicker">Form your question</p>
              </div>
              <h2 id="biteball-question-title">What do you need to know?</h2>

              <form onSubmit={askBiteball} noValidate>
                <label htmlFor="biteball-question">Your question</label>
                <div className={`biteball-input-shell${error ? " biteball-input-shell--error" : ""}`}>
                  <input
                    ref={inputRef}
                    id="biteball-question"
                    name="question"
                    type="text"
                    value={question}
                    maxLength={BITEBALL_MAX_QUESTION_LENGTH}
                    onChange={(event) => {
                      setQuestion(event.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="Will today surprise me?"
                    aria-describedby={error ? "biteball-question-error" : undefined}
                    aria-invalid={error ? true : undefined}
                    disabled={isAnimating}
                    autoComplete="off"
                  />
                  {showCount ? (
                    <span className="biteball-character-count" aria-live="polite">
                      {question.length}/{BITEBALL_MAX_QUESTION_LENGTH}
                    </span>
                  ) : null}
                </div>
                <p id="biteball-question-error" className="biteball-form-error" role="alert">
                  {error ?? "\u00a0"}
                </p>

                {status === "revealed" ? (
                  <button
                    type="button"
                    className="biteball-submit biteball-submit--again"
                    onClick={(event) => {
                      event.preventDefault();
                      reset();
                    }}
                  >
                    Ask another question
                  </button>
                ) : (
                  <button type="submit" className="biteball-submit" disabled={isAnimating}>
                    <span>{isAnimating ? "Consulting Biteball" : "Ask Biteball"}</span>
                    <span aria-hidden="true">{isAnimating ? "···" : "→"}</span>
                  </button>
                )}
              </form>

              <p className="biteball-privacy-note">
                <span aria-hidden="true">◌</span>
                Questions stay in this browser and are never saved.
              </p>
            </section>

            <section className="biteball-oracle-card" aria-labelledby="biteball-reading-title">
              <div className="biteball-reading-heading">
                <span className="biteball-card-number">02</span>
                <div>
                  <p className="biteball-card-kicker">The reading</p>
                  <h2 id="biteball-reading-title">
                    {status === "idle" ? "The ball is listening" : "Your answer is forming"}
                  </h2>
                </div>
              </div>

              <Biteball state={status} answer={answer} />

              <div
                ref={resultRef}
                className={`biteball-result biteball-result--${status}`}
                tabIndex={status === "revealed" ? -1 : undefined}
              >
                {submittedQuestion ? (
                  <p className="biteball-submitted-question">“{submittedQuestion}”</p>
                ) : (
                  <p className="biteball-result-placeholder">Your question will appear here.</p>
                )}
                <p className="biteball-result-answer">
                  {status === "shaking"
                    ? "Considering..."
                    : status === "revealing"
                      ? "The answer surfaces..."
                      : status === "revealed" && answer
                        ? answer.text
                        : "Ask when you are ready."}
                </p>
              </div>
            </section>
          </div>

          <footer className="biteball-lab-footer">
            <span>20 classic answers</span>
            <span aria-hidden="true">◆</span>
            <span>One honest random draw</span>
            <span aria-hidden="true">◆</span>
            <span>Discord edition comes after approval</span>
          </footer>
        </div>
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {status === "revealed" && answer && submittedQuestion
            ? `You asked: “${submittedQuestion}” Biteball says: ${answer.text}.`
            : ""}
        </p>
      </main>
    </div>
  );
}
