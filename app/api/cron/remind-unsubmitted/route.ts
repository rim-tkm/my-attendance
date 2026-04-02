import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-verify";
import { slackSendFailureHttpStatus } from "@/lib/slack-webhook";
import { runRemindUnsubmittedShiftReminder } from "@/lib/remind-unsubmitted-shifts";

/**
 * 来週シフト未入力者への Slack 催促（JST）
 * 金曜・土曜 20:00 → vercel.json: `0 11 * * 5` / `0 11 * * 6`（UTC）
 * 未入力者がいる場合のみ Webhook 送信。
 *
 * 翌週（月〜日）の未入力者抽出・本文組み立ては `lib/remind-unsubmitted-shifts.ts`
 * （管理者の即時テスト `remindUnsubmittedShiftTestAction` と同一処理）。
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const denied = verifyCronSecret(request);
  if (denied) return denied;

  const result = await runRemindUnsubmittedShiftReminder();
  if (!result.ok) {
    console.error("[cron remind-unsubmitted]", result.error, result.detail ?? "");
    return NextResponse.json(
      { ok: false, error: result.error, detail: result.detail },
      { status: slackSendFailureHttpStatus(result.error) }
    );
  }

  return NextResponse.json({
    ok: true,
    sent: result.sent,
    count: result.count,
    rangeStart: result.rangeStart,
    rangeEnd: result.rangeEnd,
  });
}
