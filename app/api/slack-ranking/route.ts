/**
 * 定期 ROI ランキングを Slack へ通知。
 * - 認証: `Authorization: Bearer ${CRON_SECRET}`
 * - Cron: vercel.json `0 0 1,15 * *`（UTC 0:00 = JST 9:00）
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-verify";
import { slackSendFailureHttpStatus } from "@/lib/slack-webhook";
import { getTodayJstDateString, sendSlackRanking } from "@/lib/slack-ranking";

export async function GET(request: NextRequest) {
  const denied = verifyCronSecret(request);
  if (denied) return denied;

  const today = getTodayJstDateString();
  const result = await sendSlackRanking(today);
  if (!result.ok) {
    const status = result.error.includes("集計対象日")
      ? 400
      : slackSendFailureHttpStatus(result.error);
    return NextResponse.json(
      { error: result.error, detail: "detail" in result ? result.detail : undefined, ok: false },
      { status }
    );
  }
  return NextResponse.json({
    ok: true,
    anchor: result.anchor,
    start: result.start,
    end: result.end,
  });
}

/** 手動: POST + Bearer CRON_SECRET、body `{ "anchorDate": "YYYY-MM-DD" }`（JSTで1日または15日） */
export async function POST(request: NextRequest) {
  const denied = verifyCronSecret(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const override = typeof body?.anchorDate === "string" ? body.anchorDate : null;
  const anchor =
    override && /^\d{4}-\d{2}-\d{2}$/.test(override) ? override : getTodayJstDateString();

  const result = await sendSlackRanking(anchor);
  if (!result.ok) {
    const status = result.error.includes("集計対象日")
      ? 400
      : slackSendFailureHttpStatus(result.error);
    return NextResponse.json(
      { error: result.error, detail: "detail" in result ? result.detail : undefined, ok: false },
      { status }
    );
  }
  return NextResponse.json({
    ok: true,
    anchor: result.anchor,
    start: result.start,
    end: result.end,
  });
}
