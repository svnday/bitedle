import { NextResponse, type NextRequest } from "next/server";
import { getStore } from "@/lib/store";
import { todayStr } from "@/lib/game";
import { renderSummaryImage, sortTodayRows, postImageToChannel } from "@/lib/discord-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // side-effecting (posts to Discord); never statically cache

interface GuildResult {
  guildId: string;
  status: "posted" | "skipped" | "failed" | "error";
  players?: number;
  error?: string;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    console.error("daily-summary: missing DISCORD_BOT_TOKEN");
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  const date = todayStr();
  const store = getStore();
  const guildChannels = await store.allGuildChannels();
  const results: GuildResult[] = [];

  // Each server's summary is independent — one failing/errored server must
  // never stop the rest from posting.
  for (const { guildId, channelId } of guildChannels) {
    try {
      const rows = await store.finishedGamesOn(date, guildId);
      if (rows.length === 0) {
        results.push({ guildId, status: "skipped" });
        continue;
      }

      const sorted = sortTodayRows(rows);

      const pngBuffer = await renderSummaryImage(sorted, date).arrayBuffer();
      const posted = await postImageToChannel({
        channelId,
        botToken,
        pngBuffer,
        content: "Here are today's results so far!",
      });
      if (!posted.ok) {
        console.error(`daily-summary: Discord POST failed for guild ${guildId} (${posted.status}): ${posted.body}`);
        results.push({ guildId, status: "failed", error: `Discord ${posted.status}` });
        continue;
      }

      results.push({ guildId, status: "posted", players: sorted.length });
    } catch (e) {
      console.error(`daily-summary: error processing guild ${guildId}`, e);
      results.push({ guildId, status: "error", error: String(e) });
    }
  }

  return NextResponse.json({ results });
}
