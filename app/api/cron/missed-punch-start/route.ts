import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-verify";
import { getTodayJstDateString } from "@/lib/export-schedule";
import { runMissedPunchSlotReminders } from "@/lib/missed-punch-start-reminder";
import { slackSendFailureHttpStatus } from "@/lib/slack-webhook";

/**
 * 稼働予定の未打刻アラート（開始・終了）。
 * - 【開始】予定開始＋猶予（既定 15 分）経過後も、当日の業務開始（open_records）がなく該当枠に活動記録もない場合。
 * - 【終了】予定終了＋猶予経過後も、未終了打刻が枠と重なっている（終了報告未完了）場合。
 * - 同一ユーザー×日×枠（primary/secondary）は `punch_start_reminder_sent` / `punch_end_reminder_sent` で各 1 回のみ。
 * - 認証: `Authorization: Bearer ${CRON_SECRET}`
 * - Cron: vercel.json で 5 分間隔（crontab の分欄を 5 刻み）を推奨
 * - GET `?date=YYYY-MM-DD` で対象日を上書き（手動検証用）
 * - POST body `{ "date": "YYYY-MM-DD" }` も可
 * - Webhook: `SLACK_WEBHOOK_MISSED_PUNCH_URL` があれば優先、なければ `SLACK_WEBHOOK_URL`
 * - 猶予: `MISSED_PUNCH_START_GRACE_MINUTES`（省略時 15）※開始・終了の両方に適用
 * - DB: `punch_start_reminder_sent` / `punch_end_reminder_sent`（マイグレーション参照）
 */
export async function GET(request: NextRequest) {
  const denied = verifyCronSecret(request);
  if (denied) return denied;
  const dateQ = request.nextUrl.searchParams.get("date")?.trim();
  const dateYmd = dateQ && /^\d{4}-\d{2}-\d{2}$/.test(dateQ) ? dateQ : undefined;
  const result = await runMissedPunchSlotReminders({ dateYmd });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, detail: result.detail },
      { status: slackSendFailureHttpStatus(result.error) }
    );
  }
  return NextResponse.json({
    ok: true,
    dateYmd: result.dateYmd,
    start: result.start,
    end: result.end,
    sent: result.start.sent || result.end.sent,
    count: result.start.count + result.end.count,
  });
}

export async function POST(request: NextRequest) {
  const denied = verifyCronSecret(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const dateRaw = typeof body?.date === "string" ? body.date.trim() : "";
  const dateYmd = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : getTodayJstDateString();
  const result = await runMissedPunchSlotReminders({ dateYmd });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, detail: result.detail },
      { status: slackSendFailureHttpStatus(result.error) }
    );
  }
  return NextResponse.json({
    ok: true,
    dateYmd: result.dateYmd,
    start: result.start,
    end: result.end,
    sent: result.start.sent || result.end.sent,
    count: result.start.count + result.end.count,
  });
}
