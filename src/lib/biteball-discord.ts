import type { BiteballAnswer } from "./biteball";
import {
  BITEBALL_DISCORD_GIF_FILENAME,
  BITEBALL_DISCORD_PNG_FILENAME,
  renderBiteballDiscordAssets,
} from "./biteball-discord-renderer";

const DEFAULT_ATTACHMENT_LIMIT = 8 * 1024 * 1024;
const FINAL_EDIT_MARGIN_MS = 180;
const FINAL_EDIT_RETRY_MS = 250;

interface BiteballDeliveryInput {
  applicationId: string;
  token: string;
  question: string;
  answer: BiteballAnswer;
  attachmentSizeLimit?: number;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

function safeAttachmentLimit(limit: number | undefined): number {
  return Number.isSafeInteger(limit) && limit! > 0 ? limit! : DEFAULT_ATTACHMENT_LIMIT;
}

export function escapeDiscordText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/([*_~`|>])/g, "\\$1")
    .replace(/@/g, "@\u200b");
}

export function biteballQuestionContent(question: string): string {
  return `🎱 **Biteball is consulting the oracle…**\n> ${escapeDiscordText(question)}`;
}

export function biteballAnswerContent(question: string, answer: BiteballAnswer): string {
  return [
    `🎱 **${escapeDiscordText(question)}**`,
    `**Biteball says:** ${escapeDiscordText(answer.text)}`,
  ].join("\n");
}

function webhookUrl(applicationId: string, token: string): string {
  const apiBase = process.env.BITEDLE_DISCORD_API_BASE_URL || "https://discord.com/api/v10";
  return `${apiBase}/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(token)}/messages/@original`;
}

async function patchMultipart(
  url: string,
  payload: Record<string, unknown>,
  file: Buffer,
  filename: string,
  contentType: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const form = new FormData();
  form.append("payload_json", JSON.stringify(payload));
  form.append(
    "files[0]",
    new Blob([new Uint8Array(file)], { type: contentType }),
    filename,
  );
  return fetchImpl(url, { method: "PATCH", body: form });
}

async function patchText(
  url: string,
  content: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  return fetchImpl(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      allowed_mentions: { parse: [] },
      components: [],
      attachments: [],
    }),
  });
}

async function responseError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  return `${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`;
}

export async function deliverBiteballResponse({
  applicationId,
  token,
  question,
  answer,
  attachmentSizeLimit,
  fetchImpl = fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}: BiteballDeliveryInput): Promise<void> {
  const url = webhookUrl(applicationId, token);
  const finalContent = biteballAnswerContent(question, answer);
  const limit = safeAttachmentLimit(attachmentSizeLimit);
  let assets: Awaited<ReturnType<typeof renderBiteballDiscordAssets>>;

  try {
    assets = await renderBiteballDiscordAssets(question, answer);
  } catch (error) {
    console.error("biteball: image rendering failed", error);
    const fallback = await patchText(url, finalContent, fetchImpl);
    if (!fallback.ok) {
      throw new Error(`Biteball text fallback failed (${await responseError(fallback)})`);
    }
    return;
  }

  let animationPosted = false;
  if (assets.animation.byteLength <= limit) {
    const animationResponse = await patchMultipart(
      url,
      {
        content: biteballQuestionContent(question),
        allowed_mentions: { parse: [] },
        components: [],
        attachments: [
          {
            id: 0,
            filename: BITEBALL_DISCORD_GIF_FILENAME,
            description: "Biteball shaking before revealing its answer",
          },
        ],
      },
      assets.animation,
      BITEBALL_DISCORD_GIF_FILENAME,
      "image/gif",
      fetchImpl,
    );
    animationPosted = animationResponse.ok;
    if (!animationResponse.ok) {
      console.warn(`biteball: animation edit failed (${await responseError(animationResponse)})`);
    }
  } else {
    console.warn(`biteball: animation exceeded the interaction attachment limit (${limit} bytes)`);
  }

  if (animationPosted) {
    const testDelay = process.env.BITEDLE_BITEBALL_FINAL_EDIT_DELAY_MS;
    const delay =
      process.env.NODE_ENV !== "production" && testDelay !== undefined
        ? Math.max(0, Number(testDelay) || 0)
        : assets.durationMs + FINAL_EDIT_MARGIN_MS;
    await sleep(delay);
  }

  if (assets.still.byteLength <= limit) {
    const finalPayload = {
      content: finalContent,
      allowed_mentions: { parse: [] },
      components: [],
      attachments: [
        {
          id: 0,
          filename: BITEBALL_DISCORD_PNG_FILENAME,
          description: `Biteball's answer: ${answer.text}`,
        },
      ],
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const finalResponse = await patchMultipart(
        url,
        finalPayload,
        assets.still,
        BITEBALL_DISCORD_PNG_FILENAME,
        "image/png",
        fetchImpl,
      );
      if (finalResponse.ok) return;
      console.warn(`biteball: still-image edit failed (${await responseError(finalResponse)})`);
      if (attempt === 0) await sleep(FINAL_EDIT_RETRY_MS);
    }
  }

  const fallback = await patchText(url, finalContent, fetchImpl);
  if (!fallback.ok) {
    throw new Error(`Biteball final text edit failed (${await responseError(fallback)})`);
  }
}
