/**
 * 毎日 JST 0:00（UTC 15:00）に前日のチーム実績を Slack へ通知。
 * - 認証: `Authorization: Bearer ${CRON_SECRET}`（slack-daily と共通）
 * - Cron: vercel.json `0 15 * * *`
 */
import { slackSendFailureHttpStatus } from "@/lib/slack-webhook";
import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-verify";
import { getYesterdayJstDateString, sendSlackReportForDate } from "@/lib/slack-report";

export async function GET(request: NextRequest) {
  const denied = verifyCronSecret(request);
  if (denied) return denied;
  const result = await sendSlackReportForDate(getYesterdayJstDateString());
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail, ok: false },
      { status: slackSendFailureHttpStatus(result.error) }
    );
  }
  return NextResponse.json({
    ok: true,
    date: result.date,
    ...(result.sent ? {} : { skipped: true, skipReason: result.skipReason }),
  });
}

/** 手動: POST + Bearer CRON_SECRET、body `{ "date": "YYYY-MM-DD", "test": true }`。test:true で土日でも送信 */
export async function POST(request: NextRequest) {
  const denied = verifyCronSecret(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const dateOverride = typeof body?.date === "string" ? body.date : null;
  const targetDate =
    dateOverride && /^\d{4}-\d{2}-\d{2}$/.test(dateOverride) ? dateOverride : getYesterdayJstDateString();
  const result = await sendSlackReportForDate(targetDate, { bypassWeekendSkip: body?.test === true });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail, ok: false },
      { status: slackSendFailureHttpStatus(result.error) }
    );
  }
  return NextResponse.json({
    ok: true,
    date: result.date,
    ...(result.sent ? {} : { skipped: true, skipReason: result.skipReason }),
  });
}
