import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { bitebluffDeck } from "./bitebluff-cards";
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

function hmacUint32(secret: string, entrantId: string, counter: number): number {
  return createHmac("sha256", secret)
    .update(`bitebluff-deck:v1:${entrantId}:${counter}`)
    .digest()
    .readUInt32BE(0);
}

/**
 * A deterministic, unbiased Fisher-Yates shuffle. Every entrant gets their
 * own logical 52-card deck, derived from the committed round secret.
 */
export function dealCommittedBitebluffHand(
  secret: string,
  entrantId: string,
): BitebluffCard[] {
  const deck = bitebluffDeck();
  let counter = 0;
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const range = index + 1;
    const limit = Math.floor(0x1_0000_0000 / range) * range;
    let sample = hmacUint32(secret, entrantId, counter);
    counter += 1;
    while (sample >= limit) {
      sample = hmacUint32(secret, entrantId, counter);
      counter += 1;
    }
    const swapIndex = sample % range;
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return deck.slice(0, 5);
}
