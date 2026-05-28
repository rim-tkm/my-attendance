/**
 * 生産性低下アラート（KPI 保存時）でメンションする Slack ユーザー ID。
 * 上書き: 環境変数 SLACK_PRODUCTIVITY_NOTIFY_USER_IDS（カンマ区切り、例: Uxxx,Uyyy）
 */
const DEFAULT_SLACK_PRODUCTIVITY_NOTIFY_USER_IDS = [
  "U0ACA6NNJH3",
  "U0A98DDP5GX",
  "U0ACSF67PPB",
  "U0A9THZBNLU",
] as const;

const SLACK_USER_ID_RE = /^U[A-Z0-9]+$/i;

function parseSlackUserIdsFromEnv(raw: string | undefined): string[] | null {
  if (raw == null || raw.trim() === "") return null;
  const ids = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => SLACK_USER_ID_RE.test(s));
  return ids.length > 0 ? ids : null;
}

/** Incoming Webhook の text 先頭に付けるメンション行（例: `<@Uxxx> <@Uyyy>`） */
export function getSlackProductivityNotifyMentionLine(): string {
  const fromEnv =
    typeof process !== "undefined" && process.env.SLACK_PRODUCTIVITY_NOTIFY_USER_IDS
      ? parseSlackUserIdsFromEnv(process.env.SLACK_PRODUCTIVITY_NOTIFY_USER_IDS)
      : null;
  const ids = fromEnv ?? [...DEFAULT_SLACK_PRODUCTIVITY_NOTIFY_USER_IDS];
  return ids.map((id) => `<@${id}>`).join(" ");
}
