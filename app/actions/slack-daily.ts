"use server";

import { getTodayJstDateString, sendSlackDailyForDate } from "@/lib/slack-daily";

/** 管理画面からのテスト送信（サーバー側のみで実行。Webhook URL はクライアントに出さない） */
export async function slackDailyTestAction(dateStr?: string): Promise<{ ok: boolean; error?: string; detail?: string; date?: string }> {
  const target = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : getTodayJstDateString();
  const result = await sendSlackDailyForDate(target);
  if (result.ok) {
    return { ok: true, date: result.date };
  }
  return { ok: false, error: result.error, detail: result.detail };
}
