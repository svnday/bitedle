import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import {
  bitebluffCardKey,
  bitebluffDeck,
  normalizeBitebluffBurnPositions,
  normalizeBitebluffRedrawCount,
} from "./bitebluff-cards";
import { BITEBLUFF_HAND_SIZE } from "./bitebluff-constants";
import type { BitebluffCard } from "./bitebluff-constants";

const ENCRYPTION_VERSION = "v1";

function encryptionKey(): Buffer {
  const configured = process.env.BITEBLUFF_ENCRYPTION_KEY?.trim();
  if (configured) {
    const decoded = /^[0-9a-f]{64}$/i.test(configured)
      ? Buffer.from(configured, "hex")
      : Buffer.from(configured, "base64");
    if (decoded.length !== 32) {
      throw new Error("BITEBLUFF_ENCRYPTION_KEY must decode to exactly 32 bytes.");
    }
    return decoded;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("BITEBLUFF_ENCRYPTION_KEY is required in production.");
  }
  return createHash("sha256")
    .update(process.env.BITEDLE_SECRET || "bitebluff-local-development-only")
    .digest();
}

export function createBitebluffRoundSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function bitebluffSecretCommitment(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function encryptBitebluffValue(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    ENCRYPTION_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptBitebluffValue<T>(encrypted: string): T {
  const [version, ivText, tagText, ciphertextText] = encrypted.split(".");
  if (
    version !== ENCRYPTION_VERSION ||
    !ivText ||
    !tagText ||
    !ciphertextText
  ) {
    throw new Error("Invalid Bitebluff encrypted payload.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivText, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

function hmacUint32(secret: string, context: string, counter: number): number {
  return createHmac("sha256", secret)
    .update(`${context}:${counter}`)
    .digest()
    .readUInt32BE(0);
}

function unbiasedIndex(
  secret: string,
  context: string,
  range: number,
  counter: { value: number },
): number {
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  let sample = hmacUint32(secret, context, counter.value);
  counter.value += 1;
  while (sample >= limit) {
    sample = hmacUint32(secret, context, counter.value);
    counter.value += 1;
  }
  return sample % range;
}

/**
 * A deterministic, unbiased Fisher-Yates shuffle. Every entrant gets their
 * own logical 52-card deck, derived from the committed round secret.
 */
export function committedBitebluffDeck(
  secret: string,
  entrantId: string,
): BitebluffCard[] {
  const deck = bitebluffDeck();
  const counter = { value: 0 };
  const context = `bitebluff-deck:v1:${entrantId}`;
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = unbiasedIndex(secret, context, index + 1, counter);
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return deck;
}

export function dealCommittedBitebluffHand(
  secret: string,
  entrantId: string,
): BitebluffCard[] {
  return committedBitebluffDeck(secret, entrantId).slice(0, BITEBLUFF_HAND_SIZE);
}

export function redrawCommittedBitebluffHand(input: {
  secret: string;
  entrantId: string;
  hand: readonly BitebluffCard[];
  positions: readonly number[];
}): {
  hand: BitebluffCard[];
  burned: BitebluffCard[];
  positions: number[];
} {
  const burnedPositions = normalizeBitebluffBurnPositions(input.positions);
  const deck = committedBitebluffDeck(input.secret, input.entrantId);
  const originalHand = deck.slice(0, BITEBLUFF_HAND_SIZE);
  if (
    input.hand.length !== BITEBLUFF_HAND_SIZE ||
    input.hand.some(
      (card, index) => bitebluffCardKey(card) !== bitebluffCardKey(originalHand[index]),
    )
  ) {
    throw new Error("The committed Bitebluff hand does not match the round deck.");
  }

  const replacements = deck.slice(
    BITEBLUFF_HAND_SIZE,
    BITEBLUFF_HAND_SIZE + burnedPositions.length,
  );
  const hand = [...input.hand];
  const burned = burnedPositions.map((position) => hand[position]);
  burnedPositions.forEach((position, index) => {
    hand[position] = replacements[index];
  });
  return { hand, burned, positions: burnedPositions };
}

export function redrawRandomCommittedBitebluffHand(input: {
  secret: string;
  entrantId: string;
  hand: readonly BitebluffCard[];
  count: number;
}): {
  hand: BitebluffCard[];
  burned: BitebluffCard[];
  positions: number[];
} {
  const count = normalizeBitebluffRedrawCount(input.count);
  const deck = committedBitebluffDeck(input.secret, input.entrantId);
  const originalHand = deck.slice(0, BITEBLUFF_HAND_SIZE);
  if (
    input.hand.length !== BITEBLUFF_HAND_SIZE ||
    input.hand.some(
      (card, index) =>
        bitebluffCardKey(card) !== bitebluffCardKey(originalHand[index]),
    )
  ) {
    throw new Error("The committed Bitebluff hand does not match the round deck.");
  }

  const positions = Array.from(
    { length: BITEBLUFF_HAND_SIZE },
    (_, index) => index,
  );
  const counter = { value: 0 };
  const context = `bitebluff-redraw:v1:${input.entrantId}:${count}:positions`;
  for (let index = positions.length - 1; index > 0; index -= 1) {
    const swapIndex = unbiasedIndex(
      input.secret,
      context,
      index + 1,
      counter,
    );
    [positions[index], positions[swapIndex]] = [
      positions[swapIndex],
      positions[index],
    ];
  }
  const burnedPositions = positions.slice(0, count).sort((a, b) => a - b);
  const replacements = deck.slice(
    BITEBLUFF_HAND_SIZE,
    BITEBLUFF_HAND_SIZE + count,
  );
  const hand = [...input.hand];
  const burned = burnedPositions.map((position) => hand[position]);
  burnedPositions.forEach((position, index) => {
    hand[position] = replacements[index];
  });
  return { hand, burned, positions: burnedPositions };
}
