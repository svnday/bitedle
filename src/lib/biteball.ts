export const BITEBALL_SHAKE_MS = 1_600;
export const BITEBALL_SETTLE_MS = 350;
export const BITEBALL_REVEAL_MS = 650;
export const BITEBALL_MAX_QUESTION_LENGTH = 200;

export type BiteballAnswerCategory = "affirmative" | "non-committal" | "negative";

export interface BiteballAnswer {
  id: string;
  text: string;
  category: BiteballAnswerCategory;
}

export const BITEBALL_ANSWERS: readonly BiteballAnswer[] = [
  { id: "it-is-certain", text: "It is certain", category: "affirmative" },
  { id: "decidedly-so", text: "It is decidedly so", category: "affirmative" },
  { id: "without-a-doubt", text: "Without a doubt", category: "affirmative" },
  { id: "yes-definitely", text: "Yes, definitely", category: "affirmative" },
  { id: "rely-on-it", text: "You may rely on it", category: "affirmative" },
  { id: "as-i-see-it", text: "As I see it, yes", category: "affirmative" },
  { id: "most-likely", text: "Most likely", category: "affirmative" },
  { id: "outlook-good", text: "Outlook good", category: "affirmative" },
  { id: "yes", text: "Yes", category: "affirmative" },
  { id: "signs-point-to-yes", text: "Signs point to yes", category: "affirmative" },
  { id: "reply-hazy", text: "Reply hazy, try again", category: "non-committal" },
  { id: "ask-again-later", text: "Ask again later", category: "non-committal" },
  { id: "better-not-tell", text: "Better not tell you now", category: "non-committal" },
  { id: "cannot-predict", text: "Cannot predict now", category: "non-committal" },
  {
    id: "concentrate-and-ask",
    text: "Concentrate and ask again",
    category: "non-committal",
  },
  { id: "dont-count-on-it", text: "Don't count on it", category: "negative" },
  { id: "reply-is-no", text: "My reply is no", category: "negative" },
  { id: "sources-say-no", text: "My sources say no", category: "negative" },
  { id: "outlook-not-good", text: "Outlook not so good", category: "negative" },
  { id: "very-doubtful", text: "Very doubtful", category: "negative" },
] as const;

export type BiteballRandomIndex = (upperExclusive: number) => number;

const BITEBALL_AFFIRMATIVE_ANSWERS = BITEBALL_ANSWERS.filter(
  (answer) => answer.category === "affirmative",
);

function secureRandomIndex(upperExclusive: number): number {
  if (!Number.isSafeInteger(upperExclusive) || upperExclusive <= 0) {
    throw new RangeError("Biteball answer count must be a positive integer.");
  }

  const range = 0x1_0000_0000;
  const limit = Math.floor(range / upperExclusive) * upperExclusive;
  const values = new Uint32Array(1);
  let value: number;

  do {
    globalThis.crypto.getRandomValues(values);
    value = values[0];
  } while (value >= limit);

  return value % upperExclusive;
}

export function selectBiteballAnswer(
  randomIndex: BiteballRandomIndex = secureRandomIndex,
): BiteballAnswer {
  return selectFromAnswers(BITEBALL_ANSWERS, randomIndex);
}

export function selectAffirmativeBiteballAnswer(
  randomIndex: BiteballRandomIndex = secureRandomIndex,
): BiteballAnswer {
  return selectFromAnswers(BITEBALL_AFFIRMATIVE_ANSWERS, randomIndex);
}

export function shouldForceAffirmativeBiteballAnswer(
  requesterUsername: string | undefined,
  question: string,
): boolean {
  return (
    requesterUsername?.toLocaleLowerCase("en-US") === "sundei" &&
    /(^|[^a-z0-9_])kizb([^a-z0-9_]|$)/i.test(question)
  );
}

function selectFromAnswers(
  answers: readonly BiteballAnswer[],
  randomIndex: BiteballRandomIndex,
): BiteballAnswer {
  const index = randomIndex(answers.length);
  if (!Number.isSafeInteger(index) || index < 0 || index >= answers.length) {
    throw new RangeError(`Invalid Biteball answer index: ${index}`);
  }

  return answers[index];
}
