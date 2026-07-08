import { puzzleNumber, todayStr } from "./game";
import {
  patchImageMessage,
  postImageToChannel,
  renderLivePreviewImage,
} from "./discord-summary";
import { getStore, type LivePreviewRow } from "./store";

export const LIVE_PREVIEW_COOLDOWN_MS = 5 * 60 * 1000;

function sortLivePreviewRows(rows: LivePreviewRow[]): LivePreviewRow[] {
  return [...rows].sort((a, b) => {
    if (a.status !== b.status) return a.status === "playing" ? -1 : 1;
    if (a.clicks.length !== b.clicks.length) return b.clicks.length - a.clicks.length;
    return (a.finishedAt ?? Number.MAX_SAFE_INTEGER) - (b.finishedAt ?? Number.MAX_SAFE_INTEGER);
  });
}

export async function updateLivePreviewMessage(opts: {
  guildId: string;
  channelId?: string | null;
}): Promise<boolean> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return false;

  const store = getStore();
  const date = todayStr();
  const rows = sortLivePreviewRows(await store.livePreviewGamesOn(date, opts.guildId));
  if (rows.length === 0) return false;

  const existing = await store.getLivePreviewMessage(opts.guildId, date);
  const fallbackChannel = opts.channelId
    ? { guildId: opts.guildId, channelId: opts.channelId }
    : await store.getGuildChannel(opts.guildId);
  const channelId = existing?.channelId ?? fallbackChannel?.channelId;
  if (!channelId) return false;

  const pngBuffer = await renderLivePreviewImage(rows, date).arrayBuffer();
  const content = `Bitedle #${puzzleNumber(date)} is live — current server progress`;
  const now = Date.now();

  if (existing) {
    const patched = await patchImageMessage({
      channelId: existing.channelId,
      messageId: existing.messageId,
      botToken,
      pngBuffer,
      content,
    });

    if (patched.ok) {
      await store.setLivePreviewMessage({ ...existing, updatedAt: now });
      return true;
    }

    if (patched.status !== 404 && patched.status !== 403) {
      console.error(
        `live-preview: PATCH failed for guild ${opts.guildId} (${patched.status}): ${patched.body}`,
      );
      return false;
    }
  }

  const postChannelId = opts.channelId ?? channelId;
  const posted = await postImageToChannel({
    channelId: postChannelId,
    botToken,
    pngBuffer,
    content,
    filename: "preview.png",
  });
  if (!posted.ok || !posted.messageId) {
    console.error(
      `live-preview: POST failed for guild ${opts.guildId} (${posted.status}): ${posted.body}`,
    );
    return false;
  }

  await store.setLivePreviewMessage({
    guildId: opts.guildId,
    date,
    channelId: postChannelId,
    messageId: posted.messageId,
    updatedAt: now,
  });
  return true;
}

export async function updateLivePreviewMessageWithCooldown(opts: {
  guildId: string;
  channelId?: string | null;
}): Promise<void> {
  let last = 0;
  try {
    const store = getStore();
    const now = Date.now();
    last = await store.getLastPreviewAt(opts.guildId);
    if (now - last < LIVE_PREVIEW_COOLDOWN_MS) return;

    await store.setLastPreviewAt(opts.guildId, now);
    const updated = await updateLivePreviewMessage(opts);
    if (!updated) await store.setLastPreviewAt(opts.guildId, last);
  } catch (e) {
    console.error(`live-preview: update error for guild ${opts.guildId}`, e);
    await getStore().setLastPreviewAt(opts.guildId, last).catch(() => {});
  }
}
