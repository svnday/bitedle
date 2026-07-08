import { puzzleNumber, todayStr } from "./game";
import {
  patchImageWebhookMessage,
  postImageWebhookFollowup,
  renderLivePreviewImage,
} from "./discord-summary";
import { getStore, LIVE_PREVIEW_POSTING, type LivePreviewRow } from "./store";

/**
 * The live preview is posted and edited through *interaction webhooks*
 * (`/webhooks/{application_id}/{interaction_token}`), never through a bot
 * channel post — Bitedle is installed via the Activities launcher with only
 * the `applications.commands` scope, so there is no bot member to post as.
 * Every launch (entry-point command or the message's "Play now!" button)
 * hands us a token that can post followups and edit them for 15 minutes.
 * While the stored token is fresh we keep editing one message; once it goes
 * stale the next launch starts a new message. Between launches, clicks reuse
 * the stored token, so the image updates live for the length of a session.
 */

/** Interaction tokens are valid for 15 minutes; stop using one with margin. */
export const WEBHOOK_TOKEN_TTL_MS = 13 * 60 * 1000;

/** custom_id of the preview message's launch button (interaction type 3). */
export const LAUNCH_BUTTON_ID = "bitedle-launch";

/** ACTION_ROW with one PRIMARY button; clicking it sends our app a
 *  MESSAGE_COMPONENT interaction, answered with LAUNCH_ACTIVITY. */
const LAUNCH_BUTTON_COMPONENTS = [
  {
    type: 1,
    components: [{ type: 2, style: 1, label: "Play now!", custom_id: LAUNCH_BUTTON_ID }],
  },
];

function previewContent(rows: LivePreviewRow[], date: string): string {
  const others = rows.length - 1;
  const who =
    others === 0
      ? `**${rows[0].name}** is playing`
      : `**${rows[0].name}** and ${others} other${others === 1 ? "" : "s"} are playing`;
  return `🎮 ${who} Bitedle #${puzzleNumber(date)}`;
}

export async function updateLivePreviewMessage(opts: {
  guildId: string;
  /** Credentials of a just-received interaction (launch or button click),
   *  when there is one — click/state refreshes have none and can only reuse
   *  the stored token. */
  interaction?: { applicationId: string; token: string };
}): Promise<void> {
  const store = getStore();
  const date = todayStr();
  const now = Date.now();

  let record = await store.getLivePreviewMessage(opts.guildId, date);
  if (!record || now - record.tokenCreatedAt >= WEBHOOK_TOKEN_TTL_MS) {
    // Stored token stale (or none yet today): only a fresh interaction can
    // start a new message. Persist the token even before any game rows exist
    // — the launcher's /api/state call arrives moments later and posts with it.
    if (!opts.interaction) return;
    record = {
      guildId: opts.guildId,
      date,
      applicationId: opts.interaction.applicationId,
      webhookToken: opts.interaction.token,
      tokenCreatedAt: now,
      messageId: null,
      updatedAt: now,
    };
    await store.setLivePreviewMessage(record);
  }

  // Another invocation is mid-POST — it will render the same data anyway.
  if (record.messageId === LIVE_PREVIEW_POSTING) return;

  // Scope to this launch window: only players who opened the Activity since
  // the current message's token was minted. The store returns them
  // launcher-first, which both the image and previewContent rely on.
  const rows = await store.livePreviewGamesOn(date, opts.guildId, record.tokenCreatedAt);
  if (rows.length === 0) return;

  const pngBuffer = await renderLivePreviewImage(rows, date).arrayBuffer();
  const content = previewContent(rows, date);

  if (record.messageId) {
    const patched = await patchImageWebhookMessage({
      applicationId: record.applicationId,
      webhookToken: record.webhookToken,
      messageId: record.messageId,
      pngBuffer,
      content,
      components: LAUNCH_BUTTON_COMPONENTS,
    });
    if (patched.ok) return;
    if (patched.status !== 404) {
      console.error(
        `live-preview: webhook PATCH failed for guild ${opts.guildId} (${patched.status}): ${patched.body}`,
      );
      return;
    }
    // 404: someone deleted the message. The token still works, so forget the
    // dead id and fall through to posting a replacement.
    await store.clearLivePreviewMessageId(opts.guildId, date, record.messageId);
  }

  // launch, state, identify and click invocations race here — exactly one
  // may POST, or a burst of launches turns into a burst of duplicate messages.
  if (!(await store.claimLivePreviewPost(opts.guildId, date))) return;

  const posted = await postImageWebhookFollowup({
    applicationId: record.applicationId,
    webhookToken: record.webhookToken,
    pngBuffer,
    content,
    filename: "preview.png",
    components: LAUNCH_BUTTON_COMPONENTS,
  });
  if (!posted.ok || !posted.messageId) {
    console.error(
      `live-preview: webhook POST failed for guild ${opts.guildId} (${posted.status}): ${posted.body}`,
    );
    await store.releaseLivePreviewPost(opts.guildId, date);
    return;
  }

  await store.setLivePreviewMessage({ ...record, messageId: posted.messageId, updatedAt: now });
}
