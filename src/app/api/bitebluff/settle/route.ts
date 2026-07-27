import { NextResponse, type NextRequest } from "next/server";
import { settleOverdueBitebluffRounds } from "@/lib/bitebluff-service";
import {
  deliverBitebluffFinalResults,
  retryPendingBitebluffFinalResults,
} from "@/lib/bitebluff-discord-preview";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const settled = await settleOverdueBitebluffRounds();
  const errors: string[] = [];
  for (const result of settled) {
    await deliverBitebluffFinalResults(result.round.id).catch((error) => {
      console.error(`bitebluff/settle: final delivery failed for ${result.round.id}`, error);
      errors.push(result.round.id);
    });
  }
  await retryPendingBitebluffFinalResults().catch((error) => {
    console.error("bitebluff/settle: pending final delivery retry failed", error);
    errors.push("pending");
  });
  return NextResponse.json(
    {
      ok: errors.length === 0,
      settledRoundIds: settled.map((result) => result.round.id),
      deliveryErrors: errors,
    },
    { status: errors.length === 0 ? 200 : 500 },
  );
}
