import type { NextRequest } from "next/server";
import { activityInstanceIdFromRequest } from "./discord";
import type { Store } from "./store";

export async function recordBitesweeperPresence(
  request: NextRequest,
  store: Store,
  userId: string,
  date: string,
): Promise<string | null> {
  const instanceId = activityInstanceIdFromRequest(request);
  if (!instanceId) return null;
  const user = await store.getUser(userId);
  if (!user?.discordUserId) return null;
  await store.recordBitesweeperPresence(instanceId, date, userId, Date.now());
  return instanceId;
}
