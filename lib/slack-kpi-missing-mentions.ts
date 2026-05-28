const SLACK_USER_ID_RE = /^U[A-Z0-9]+$/i;

function nonemptyTrim(v: string | undefined): string | undefined {
  if (v === undefined || v === null) return undefined;
  const t = String(v).trim();
  return t.length > 0 ? t : undefined;
}

/**
 * KPI 未入力（終了打刻後）アラートの先頭メンション行。
 * - `SLACK_KPI_MISSING_AT_HERE=1` または `true` のとき `<!here>` のみ
 * - それ以外は `SLACK_KPI_MISSING_NOTIFY_USER_ID`（単一の U…）
 * - 未設定なら `SLACK_PRODUCTIVITY_NOTIFY_USER_IDS` の先頭 1 件のみ
 * - それもなければ既定 1 名のみ
 */
export function getSlackKpiMissingNotifyMentionLine(): string {
  const atHere = nonemptyTrim(process.env.SLACK_KPI_MISSING_AT_HERE);
  if (atHere === "1" || atHere?.toLowerCase() === "true") {
    return "<!here>";
  }
  const single = nonemptyTrim(process.env.SLACK_KPI_MISSING_NOTIFY_USER_ID);
  if (single && SLACK_USER_ID_RE.test(single)) {
    return `<@${single}>`;
  }
  const prod = process.env.SLACK_PRODUCTIVITY_NOTIFY_USER_IDS?.split(/[\s,]+/).map((s) => s.trim()).find((s) => SLACK_USER_ID_RE.test(s));
  if (prod) return `<@${prod}>`;
  return "<@U0ACA6NNJH3>";
}
