/**
 * 毎日の Slack 通知（当日の業務委託の稼働予定者・日次の締め前）。
 * - データ: Supabase `shifts`（当日・日本時間）＋有効ユーザー `users`
 * - 認証: `Authorization` が `Bearer ${CRON_SECRET}` と完全一致する場合のみ実行
 * - Cron: vercel.json で 0 23 * * *（UTC 23:00 ＝日本時間 翌日 8:00）に GET 本エンドポイント
 * - 土曜・日曜（JST の対象日）は既定で Webhook 送信しない（200 + skipped）
 * - GET ?test=true または POST body `{ "test": true }` のときは土日でも送信する（手動検証用・Cron では付けない）
 * - Webhook: SLACK_WEBHOOK_DAILY_URL があれば優先、なければ SLACK_WEBHOOK_URL
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-verify";
import { getTodayJstDateString, sendSlackDailyForDate } from "@/lib/slack-daily";
import { slackSendFailureHttpStatus } from "@/lib/slack-webhook";

/** Vercel Cron: GET /api/slack-daily + Authorization: Bearer CRON_SECRET */
export async function GET(request: NextRequest) {
  const denied = verifyCronSecret(request);
  if (denied) return denied;
  const test = request.nextUrl.searchParams.get("test") === "true";
  const result = await sendSlackDailyForDate(getTodayJstDateString(), { bypassWeekendSkip: test });
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

/** 手動実行（curl 等）: POST + Authorization: Bearer CRON_SECRET、body: { "date": "YYYY-MM-DD" } 省略可 */
export async function POST(request: NextRequest) {
  const denied = verifyCronSecret(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const dateOverride = typeof body?.date === "string" ? body.date : null;
  const targetDate =
    dateOverride && /^\d{4}-\d{2}-\d{2}$/.test(dateOverride) ? dateOverride : getTodayJstDateString();
  const bypassWeekend = body?.test === true;
  const result = await sendSlackDailyForDate(targetDate, { bypassWeekendSkip: bypassWeekend });
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
