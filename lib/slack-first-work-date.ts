import { postSlackIncomingWebhook } from "@/lib/slack-webhook";

const MENTION = "<@U0ACA6NNJH3>";

function slackWebhookUrlFromEnv(): string | undefined {
  const v = process.env.SLACK_WEBHOOK_URL?.trim();
  return v && v.length > 0 ? v : undefined;
}

/**
 * 初回稼働日が新規設定されたときの Slack 通知（SLACK_WEBHOOK_URL のみ使用）
 */
export async function notifyFirstWorkDateSetSlack(params: {
  memberName: string;
  dateYmd: string;
  editUrl: string;
}): Promise<void> {
  const url = slackWebhookUrlFromEnv();
  if (!url) {
    console.warn("[first-work-date] SLACK_WEBHOOK_URL が未設定のため通知をスキップしました");
    return;
  }
  const text = `${MENTION}
🔔 【重要】新メンバーの初回稼働日が決定しました
・氏名：${params.memberName}
・初回稼働日：${params.dateYmd}
・管理画面リンク：${params.editUrl}`;
  const result = await postSlackIncomingWebhook(url, { text });
  if (!result.ok) {
    console.error("[first-work-date] Slack 送信失敗:", result.error, result.detail);
  }
}
