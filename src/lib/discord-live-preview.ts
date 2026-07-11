import { channelStatsFromGames, puzzleNumber, todayStr } from "./game";
import {
  patchImageWebhookMessage,
  postImageWebhookFollowup,
  renderLivePreviewImage,
  renderSummaryImage,
  sortTodayRows,
} from "./discord-summary";
import { hourInTz } from "./time";
import {
  getStore,
  LIVE_PREVIEW_POSTING,
  type LivePreviewMessage,
  type LivePreviewRow,
  type TodayRow,
} from "./store";

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
 *
 * The daily recap rides the same tokens: the first qualifying activity after
 * DAILY_RECAP_HOUR posts a one-off results-so-far followup (see
 * maybePostDailyRecap) — the only way a token-less wall clock could never
 * deliver.
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

/** Wall-clock hour in the game timezone from which the day's recap may post. */
const DAILY_RECAP_HOUR = 17; // 5PM

/** Content budget with headroom under Discord's 2000-char message limit. */
const RECAP_CONTENT_BUDGET = 1900;

/**
 * Wordle-style recap text: results grouped by score, best group crowned,
 * losses as one boom line. Linked players are real @mentions (rendered blue;
 * the caller suppresses notifications via allowed_mentions), unlinked-but-
 * named players fall back to bold plain text. Truncates to the budget with a
 * "+N more" tail.
 */
export function buildRecapContent(sorted: TodayRow[], date: string, serverStreak: number): string {
  const lines = [`📊 Bitedle #${puzzleNumber(date)} — today's results so far`];
  if (serverStreak > 1) lines.push(`🔥 Your server is on a ${serverStreak}-day streak!`);

  const groups: { label: string; players: TodayRow[] }[] = [];
  for (const row of sorted) {
    // sorted = wins by score asc, then losses — so groups form in order.
    const label =
      row.status === "won"
        ? `${row.score} click${row.score === 1 ? "" : "s"}:`
        : "💥 boom:";
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.players.push(row);
    else groups.push({ label, players: [row] });
  }
  if (groups.length > 0 && groups[0].label !== "💥 boom:") {
    groups[0].label = `👑 ${groups[0].label}`;
  }

  let used = lines.join("\n").length;
  let truncated = 0;
  for (const group of groups) {
    if (truncated > 0) {
      truncated += group.players.length;
      continue;
    }
    let line = group.label;
    let added = 0;
    for (let i = 0; i < group.players.length; i++) {
      const r = group.players[i];
      const token = r.discordUserId ? `<@${r.discordUserId}>` : `**${r.name}**`;
      if (used + line.length + token.length + 1 > RECAP_CONTENT_BUDGET) {
        truncated = group.players.length - i;
        break;
      }
      line += ` ${token}`;
      added++;
    }
    if (added > 0) {
      lines.push(line);
      used += line.length + 1;
    }
  }
  if (truncated > 0) lines.push(`…and ${truncated} more`);
  return lines.join("\n");
}

/**
 * The first qualifying activity after DAILY_RECAP_HOUR (server timezone)
 * posts the day's results-so-far recap through the in-hand webhook token —
 * Wordle's own pattern, and the only bot-less option since tokens outlive an
 * interaction by just 15 minutes. Claim races resolve atomically in the
 * store; a failed POST releases the claim so a later activity retries. Never
 * throws: the live preview must always still run. Accepted residuals: a
 * serverless kill between claim and POST skips that guild's day (same risk
 * class as LIVE_PREVIEW_POSTING), and post-recap finishers aren't re-posted
 * (/results covers on demand).
 */
async function maybePostDailyRecap(record: LivePreviewMessage, today: string): Promise<void> {
  try {
    if (hourInTz() < DAILY_RECAP_HOUR) return;
    if (record.recapPostedDate === today) return; // free fast-path from getLivePreviewMessage
    const store = getStore();
    const rows = await store.finishedGamesOn(today, record.guildId);
    if (rows.length === 0) return;
    if (!(await store.claimDailyRecap(record.guildId, today))) return; // claim before the expensive render
    try {
      const sorted = sortTodayRows(rows);
      const streak = channelStatsFromGames(
        await store.allFinishedGames(record.guildId),
        today,
      ).currentStreak;
      const pngBuffer = await renderSummaryImage(sorted, today).arrayBuffer();
      const posted = await postImageWebhookFollowup({
        applicationId: record.applicationId,
        webhookToken: record.webhookToken,
        pngBuffer,
        content: buildRecapContent(sorted, today, streak),
        filename: "results.png",
        components: LAUNCH_BUTTON_COMPONENTS,
        allowedMentions: { parse: [] }, // blue tags, zero pings
      });
      if (posted.ok) return;
      console.error(
        `daily-recap: webhook POST failed for guild ${record.guildId} (${posted.status}): ${posted.body}`,
      );
      await store.releaseDailyRecap(record.guildId, today);
    } catch (e) {
      console.error(`daily-recap: render/post error for guild ${record.guildId}`, e);
      await store.releaseDailyRecap(record.guildId, today);
    }
  } catch (e) {
    console.error(`daily-recap: error for guild ${record.guildId}`, e);
  }
}

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
  /** The acting player's local day, for the caption's puzzle number. The
   *  message *record* is still keyed by the server day (below) so a launch
   *  and the player's follow-up state call always target the same record,
   *  even when their local day differs. */
  date?: string;
  /** Credentials of a just-received interaction (launch or button click),
   *  when there is one — click/state refreshes have none and can only reuse
   *  the stored token. */
  interaction?: { applicationId: string; token: string };
}): Promise<void> {
  const store = getStore();
  const date = todayStr(); // server day — the per-guild record key
  const captionDate = opts.date ?? date; // acting player's day — caption only
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

  // First qualifying activity after the recap hour posts the day's recap,
  // riding the same fresh token. Runs before the POSTING-sentinel check so a
  // concurrent preview post can't starve it, and before the preview followup
  // so the recap lands above it in the channel. `date` here is the server
  // day (the record key), matching /results.
  await maybePostDailyRecap(record, date);

  // Another invocation is mid-POST — it will render the same data anyway.
  if (record.messageId === LIVE_PREVIEW_POSTING) return;

  // Scope to this launch window: everyone who opened the Activity since the
  // current message's token was minted, regardless of their local day (a
  // recent launched_at can only be on the player's current board). The store
  // returns them launcher-first, which the image and previewContent rely on.
  const rows = await store.livePreviewGamesOn(opts.guildId, record.tokenCreatedAt);
  if (rows.length === 0) return;

  const pngBuffer = await renderLivePreviewImage(rows, captionDate).arrayBuffer();
  const content = previewContent(rows, captionDate);

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
