import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-verify";
import { getTodayJstDateString } from "@/lib/export-schedule";
import { runMissedPunchSlotReminders } from "@/lib/missed-punch-start-reminder";
import { postSlackIncomingWebhook, resolveSlackWebhookUrl, slackSendFailureHttpStatus } from "@/lib/slack-webhook";

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
 * - 失敗時通知: `{ ok:false }` になった場合・想定外の例外が起きた場合は Slack（`missed_punch_start` 用
 *   Webhook）に通知する。この Cron は 5 分おき＝1日288回動くため、通知は1時間に1回までに絞る
 *   （下記 `notifyCronFailureThrottled` 参照）。押し忘れ記録が止まると月3回ロックの判定に影響する。
 */

const NOTIFY_THROTTLE_MS = 60 * 60 * 1000; // 1時間に1回まで

// 障害通知の直近送信時刻（モジュール変数）。
// ⚠ サーバーレスのウォームインスタンスごとに保持される状態のため、DBテーブルは新設しない代わりに
// 「実態としては1時間に1回まで／インスタンスごと」という制約になる（複数インスタンスが並行動作
// していれば、その数だけ通知が増えうる）。それでも 288回/日 の通知洪水や、障害が完全に無言になる
// よりは大幅にマシなため、この簡易スロットルで許容する。
let lastFailureNotifiedAtMs = 0;

async function notifyCronFailureThrottled(detailText: string): Promise<void> {
  const now = Date.now();
  if (now - lastFailureNotifiedAtMs < NOTIFY_THROTTLE_MS) return;
  const url = resolveSlackWebhookUrl("missed_punch_start");
  if (!url) return;
  lastFailureNotifiedAtMs = now;
  const text =
    `⚠️ 未打刻チェックCron（/api/cron/missed-punch-start）が失敗しています: ${detailText}\n` +
    `稼働開始・稼働終了の押し忘れ記録が止まっている可能性があります（この記録は月3回ロックの判定に使われます）。DB・Supabaseの状態を確認してください。\n` +
    `（この通知は1時間に1回までに絞っています）`;
  await postSlackIncomingWebhook(url, { text });
}

async function runAndRespond(dateYmd: string | undefined) {
  let result: Awaited<ReturnType<typeof runMissedPunchSlotReminders>>;
  try {
    result = await runMissedPunchSlotReminders({ dateYmd });
  } catch (e) {
    // 想定外の例外でも必ず Slack 通知に乗せる（未捕捉のまま落ちると誰も気付けない。freee同期Cronと同じ形）
    const msg = e instanceof Error ? e.message : String(e);
    await notifyCronFailureThrottled(`想定外のエラー: ${msg}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
  if (!result.ok) {
    await notifyCronFailureThrottled(result.detail ? `${result.error} / ${result.detail}` : result.error);
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

export async function GET(request: NextRequest) {
  const denied = verifyCronSecret(request);
  if (denied) return denied;
  const dateQ = request.nextUrl.searchParams.get("date")?.trim();
  const dateYmd = dateQ && /^\d{4}-\d{2}-\d{2}$/.test(dateQ) ? dateQ : undefined;
  return runAndRespond(dateYmd);
}

export async function POST(request: NextRequest) {
  const denied = verifyCronSecret(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const dateRaw = typeof body?.date === "string" ? body.date.trim() : "";
  const dateYmd = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : getTodayJstDateString();
  return runAndRespond(dateYmd);
}
