import { adminMemberEditUrl } from "@/lib/app-base-url";
import { postSlackIncomingWebhook } from "@/lib/slack-webhook";

const MENTION = "<@U0ACA6NNJH3>";

function slackWebhookUrlFromEnv(): string | undefined {
  const v = process.env.SLACK_WEBHOOK_URL?.trim();
  return v && v.length > 0 ? v : undefined;
}

/**
 * 初回の「稼働時間あり」シフト確定時の Slack（SLACK_WEBHOOK_URL のみ）。
 * @returns 送達成功時 true（未設定・失敗は false。呼び出し元はフラグ更新しないこと）
 */
export async function notifyFirstShiftSubmittedSlack(params: {
  memberName: string;
  /** 例: 2026年04月10日（金） */
  firstWorkDateLabel: string;
  /** 例: 09:00 〜 18:00 */
  timeRangeLabel: string;
  memberId: string;
}): Promise<boolean> {
  const url = slackWebhookUrlFromEnv();
  if (!url) {
    console.log("[first-shift-submit] skip: SLACK_WEBHOOK_URL が未設定");
    return false;
  }
  const detailUrl = adminMemberEditUrl(params.memberId);
  const text = `${MENTION}

🔔 新メンバーの初回稼働日が確定しました！
・氏名：${params.memberName}
・初回稼働日：${params.firstWorkDateLabel}
・時間：${params.timeRangeLabel}
・管理画面：${detailUrl}`;
  const result = await postSlackIncomingWebhook(url, { text });
  if (!result.ok) {
    console.log("[first-shift-submit] Slack 送信失敗", {
      error: result.error,
      detail: result.detail,
    });
    return false;
  }
  console.log("[first-shift-submit] Slack 送信成功 userId=", params.memberId);
  return true;
}
