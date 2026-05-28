"use server";

import { isWeekendYmd } from "@/lib/attendance";
import { getTodayJstDateString, sendSlackDailyForDate } from "@/lib/slack-daily";

/**
 * 管理画面からのテスト送信（サーバー側のみで実行。Webhook URL はクライアントに出さない）。
 * `dateStr` に `YYYY-MM-DD` を渡すとその日の稼働予定一覧を送信。省略時は JST の今日。土日も必ず送信試行する。
 */
export async function slackDailyTestAction(dateStr?: string): Promise<{
  ok: boolean;
  error?: string;
  detail?: string;
  date?: string;
  skipped?: boolean;
  skipReason?: "weekend";
  /** テストで土日を回避せず送った場合 true（画面上の説明用） */
  weekendTestSend?: boolean;
}> {
  const target = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : getTodayJstDateString();
  const weekend = isWeekendYmd(target);
  const result = await sendSlackDailyForDate(target, { bypassWeekendSkip: true });
  if (!result.ok) {
    return { ok: false, error: result.error, detail: result.detail, date: target };
  }
  if (!result.sent) {
    return { ok: true, date: result.date, skipped: true, skipReason: result.skipReason };
  }
  return { ok: true, date: result.date, weekendTestSend: weekend };
}
