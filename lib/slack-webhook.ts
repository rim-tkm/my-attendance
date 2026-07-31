import { withNetworkRetry } from "@/lib/network-retry";

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
  | "weekly_schedule"
  | "productivity"
  | "missed_punch_start"
  | "kpi_missing_after_punch";

const PURPOSE_ENV: Record<SlackWebhookPurpose, string> = {
  daily: "SLACK_WEBHOOK_DAILY_URL",
  report: "SLACK_WEBHOOK_REPORT_URL",
  ranking: "SLACK_WEBHOOK_RANKING_URL",
  manual_report: "SLACK_WEBHOOK_MANUAL_REPORT_URL",
  remind_unsubmitted: "SLACK_WEBHOOK_REMIND_URL",
  weekly_schedule: "SLACK_WEBHOOK_WEEKLY_SCHEDULE_URL",
  productivity: "SLACK_WEBHOOK_PRODUCTIVITY_URL",
  missed_punch_start: "SLACK_WEBHOOK_MISSED_PUNCH_URL",
  kpi_missing_after_punch: "SLACK_WEBHOOK_KPI_MISSING_URL",
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
    case "productivity":
      primary = nonemptyTrim(process.env.SLACK_WEBHOOK_PRODUCTIVITY_URL);
      break;
    case "missed_punch_start":
      primary = nonemptyTrim(process.env.SLACK_WEBHOOK_MISSED_PUNCH_URL);
      break;
    case "kpi_missing_after_punch":
      primary = nonemptyTrim(process.env.SLACK_WEBHOOK_KPI_MISSING_URL);
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

type SlackPostFailure = { ok: false; error: string; detail: string };
type SlackPostAttempt = { ok: true } | (SlackPostFailure & { retryable: boolean });

/** Incoming Webhook への 1 回分の送信。再試行してよい失敗かを retryable で返す。 */
async function attemptSlackIncomingWebhook(
  webhookUrl: string,
  payload: Record<string, unknown>
): Promise<SlackPostAttempt> {
  let res: Response;
  try {
    res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    // ネットワーク例外は一時的な可能性が高いので再試行する
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[Slack webhook] fetch failed:", msg);
    return { ok: false, error: "Slack への接続に失敗しました", detail: msg, retryable: true };
  }

  const raw = await res.text();
  const bodyText = raw.trim();

  if (!res.ok) {
    // 429（レート制限）と 5xx（サーバ側一時障害）だけ再試行。4xx は設定不備等なので即失敗。
    const retryable = res.status === 429 || res.status >= 500;
    console.error("[Slack webhook] HTTP", res.status, bodyText, retryable ? "(retry)" : "");
    return {
      ok: false,
      error: "Slack がエラーを返しました",
      detail: bodyText || `HTTP ${res.status}`,
      retryable,
    };
  }

  if (!slackIncomingWebhookBodyIsSuccess(bodyText)) {
    // 200 だが本文が ok でない＝ペイロード/設定の問題が多く、再試行しても変わらないため即失敗
    console.error("[Slack webhook] 送達未確認（応答本文）:", bodyText || "(空)");
    return {
      ok: false,
      error: "Slack が送信成功を返しませんでした",
      detail: bodyText || "応答が空です。Webhook URL・チャンネル・ワークスペースを確認してください。",
      retryable: false,
    };
  }

  return { ok: true };
}

/**
 * Incoming Webhook へ POST し、HTTP と応答本文で成功を検証する。
 * 200 でも本文が ok でない場合は失敗（未送達を成功扱いしない）。
 * 一時障害（ネットワーク例外・429・5xx）は最大3回まで自動再試行する（4xx等は即失敗）。
 */
export async function postSlackIncomingWebhook(
  webhookUrl: string,
  payload: Record<string, unknown>
): Promise<{ ok: true } | SlackPostFailure> {
  let lastFailure: SlackPostFailure = {
    ok: false,
    error: "Slack 送信に失敗しました",
    detail: "",
  };
  try {
    return await withNetworkRetry(
      async () => {
        const r = await attemptSlackIncomingWebhook(webhookUrl, payload);
        if (r.ok) return { ok: true } as const;
        lastFailure = { ok: false, error: r.error, detail: r.detail };
        // 再試行可なら例外を投げて withNetworkRetry に再試行させる。不可ならそのまま返す。
        if (r.retryable) throw new Error(r.detail || r.error);
        return lastFailure;
      },
      { maxAttempts: 3, baseDelayMs: 500, perAttemptTimeoutMs: 10_000 }
    );
  } catch {
    // 再試行を使い切っても回復しなかった一時障害
    return lastFailure;
  }
}

/** API ルート用: 設定不備は 500、Slack 側・ネットワーク不調は 502 */
export function slackSendFailureHttpStatus(error: string): number {
  if (error === "Slack webhook is not configured") return 500;
  if (error === "Supabase is not configured") return 500;
  return 502;
}
