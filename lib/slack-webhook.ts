/**
 * Slack Incoming Webhook の URL を用途ごとに解決する。
 * 用途専用の環境変数に**有効な文字列**があるときだけそれを使い、
 * 未設定・空文字・空白のみのときは必ず SLACK_WEBHOOK_URL にフォールバックする。
 * （Next のビルドで動的キー参照が欠けるのを避けるため、process.env は静的に読む）
 */
export type SlackWebhookPurpose =
  | "daily"
  | "report"
  | "ranking"
  | "manual_report"
  | "remind_unsubmitted"
  | "weekly_schedule";

const PURPOSE_ENV: Record<SlackWebhookPurpose, string> = {
  daily: "SLACK_WEBHOOK_DAILY_URL",
  report: "SLACK_WEBHOOK_REPORT_URL",
  ranking: "SLACK_WEBHOOK_RANKING_URL",
  manual_report: "SLACK_WEBHOOK_MANUAL_REPORT_URL",
  remind_unsubmitted: "SLACK_WEBHOOK_REMIND_URL",
  weekly_schedule: "SLACK_WEBHOOK_WEEKLY_SCHEDULE_URL",
};

function nonemptyTrim(v: string | undefined): string | undefined {
  if (v === undefined || v === null) return undefined;
  const t = String(v).trim();
  return t.length > 0 ? t : undefined;
}

export function resolveSlackWebhookUrl(purpose: SlackWebhookPurpose): string | undefined {
  let primary: string | undefined;
  switch (purpose) {
    case "daily":
      primary = nonemptyTrim(process.env.SLACK_WEBHOOK_DAILY_URL);
      break;
    case "report":
      primary = nonemptyTrim(process.env.SLACK_WEBHOOK_REPORT_URL);
      break;
    case "ranking":
      primary = nonemptyTrim(process.env.SLACK_WEBHOOK_RANKING_URL);
      break;
    case "manual_report":
      primary = nonemptyTrim(process.env.SLACK_WEBHOOK_MANUAL_REPORT_URL);
      break;
    case "remind_unsubmitted":
      primary = nonemptyTrim(process.env.SLACK_WEBHOOK_REMIND_URL);
      break;
    case "weekly_schedule":
      primary = nonemptyTrim(process.env.SLACK_WEBHOOK_WEEKLY_SCHEDULE_URL);
      break;
    default:
      primary = undefined;
  }
  if (primary) return primary;
  return nonemptyTrim(process.env.SLACK_WEBHOOK_URL);
}

export function slackWebhookMissingMessage(purpose: SlackWebhookPurpose): string {
  const key = PURPOSE_ENV[purpose];
  return `${key} が空または未設定のときは SLACK_WEBHOOK_URL が使われます。いずれも未設定の場合は送信できません。Vercel の Environment Variables を確認してください。`;
}

/** Slack Incoming Webhook が成功時に返す本文（公式: 200 + 本文 ok） */
function slackIncomingWebhookBodyIsSuccess(text: string): boolean {
  const t = text.trim();
  if (/^ok$/i.test(t)) return true;
  try {
    const j = JSON.parse(t) as { ok?: boolean };
    return j.ok === true;
  } catch {
    return false;
  }
}

/**
 * Incoming Webhook へ POST し、HTTP と応答本文で成功を検証する。
 * 200 でも本文が ok でない場合は失敗（未送達を成功扱いしない）。
 */
export async function postSlackIncomingWebhook(
  webhookUrl: string,
  payload: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; error: string; detail: string }> {
  let res: Response;
  try {
    res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[Slack webhook] fetch failed:", msg);
    return { ok: false, error: "Slack への接続に失敗しました", detail: msg };
  }

  const raw = await res.text();
  const bodyText = raw.trim();

  if (!res.ok) {
    console.error("[Slack webhook] HTTP", res.status, bodyText);
    return {
      ok: false,
      error: "Slack がエラーを返しました",
      detail: bodyText || `HTTP ${res.status}`,
    };
  }

  if (!slackIncomingWebhookBodyIsSuccess(bodyText)) {
    console.error("[Slack webhook] 送達未確認（応答本文）:", bodyText || "(空)");
    return {
      ok: false,
      error: "Slack が送信成功を返しませんでした",
      detail: bodyText || "応答が空です。Webhook URL・チャンネル・ワークスペースを確認してください。",
    };
  }

  return { ok: true };
}

/** API ルート用: 設定不備は 500、Slack 側・ネットワーク不調は 502 */
export function slackSendFailureHttpStatus(error: string): number {
  if (error === "Slack webhook is not configured") return 500;
  if (error === "Supabase is not configured") return 500;
  return 502;
}
