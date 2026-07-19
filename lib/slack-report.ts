import { getSupabase } from "@/lib/supabase";
import { postSlackIncomingWebhook, resolveSlackWebhookUrl, slackWebhookMissingMessage } from "@/lib/slack-webhook";
import {
  calcMonthlyPay,
  DEFAULT_HOURLY_RATE,
  formatDuration,
  getKpiTotalsFromRecords,
  isWeekendYmd,
  safeRatePercent,
  type KpiRecord,
} from "@/lib/attendance";

/** 日本時間で「昨日」の YYYY-MM-DD（JST 0:00 ちょうどの Cron 実行時＝前日カレンダー） */
export function getYesterdayJstDateString(): string {
  const now = new Date();
  const jst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  jst.setDate(jst.getDate() - 1);
  const y = jst.getFullYear();
  const m = String(jst.getMonth() + 1).padStart(2, "0");
  const d = String(jst.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** 例: 2026年3月22日(日) */
function formatDateWithWeekdayJa(dateStr: string): string {
  const [y, mo, da] = dateStr.split("-").map(Number);
  const d = new Date(y, mo - 1, da);
  const datePart = d.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
  const weekday = WEEKDAY_JA[d.getDay()] ?? "";
  return `${datePart}(${weekday})`;
}

function pctDisplay(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "-";
  return `${v}%`;
}

function yenDisplay(n: number): string {
  return `¥${Math.floor(n).toLocaleString("ja-JP")}`;
}

type DbKpiRow = {
  id: string;
  user_id: string;
  date: string;
  total_calls: number | null;
  valid_calls: number | null;
  kc_count: number | null;
  follow_up_created: number | null;
  decision_maker_apo: number | null;
  non_decision_maker_apo: number | null;
};

type DbAttendanceRow = {
  user_id: string;
  duration_minutes: number | null;
};

function rowToKpi(r: DbKpiRow): KpiRecord {
  return {
    id: r.id,
    userId: r.user_id,
    date: r.date,
    totalCalls: Number(r.total_calls) || 0,
    validCalls: Number(r.valid_calls) || 0,
    kcCount: Number(r.kc_count) || 0,
    followUpCreated: Number(r.follow_up_created) || 0,
    decisionMakerApo: Number(r.decision_maker_apo) || 0,
    nonDecisionMakerApo: Number(r.non_decision_maker_apo) || 0,
  };
}

export type SlackReportResult =
  | { ok: true; date: string; sent: true }
  | { ok: true; date: string; sent: false; skipReason: "weekend" }
  | { ok: false; error: string; detail?: string };

export type SendSlackReportOptions = {
  /** 土日（対象日の暦）でも送信する（手動検証用）。既定は土日スキップ。 */
  bypassWeekendSkip?: boolean;
};

/**
 * 指定日（チーム全体）の KPI・稼働・概算委託料を集計し Slack に送信する。
 */
export async function sendSlackReportForDate(
  dateStr: string,
  options?: SendSlackReportOptions
): Promise<SlackReportResult> {
  // 対象日（レポート対象の日）が土日なら、稼働がない前提で送信しない。
  if (!options?.bypassWeekendSkip && isWeekendYmd(dateStr)) {
    return { ok: true, date: dateStr, sent: false, skipReason: "weekend" };
  }
  const webhookUrl = resolveSlackWebhookUrl("report");
  if (!webhookUrl) {
    return { ok: false, error: "Slack webhook is not configured", detail: slackWebhookMissingMessage("report") };
  }

  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: "Supabase is not configured" };
  }

  const [{ data: kpiRows }, { data: attRows }, { data: userRows }] = await Promise.all([
    supabase.from("kpis").select("*").eq("date", dateStr),
    supabase.from("attendance").select("user_id, duration_minutes").eq("date", dateStr),
    supabase.from("users").select("id, hourly_rate, is_active"),
  ]);

  const kpis = (kpiRows as DbKpiRow[] | null)?.map(rowToKpi) ?? [];
  const totals = getKpiTotalsFromRecords(kpis);

  const userRate = new Map<string, number>();
  for (const u of userRows ?? []) {
    const id = u.id as string;
    const hr = u.hourly_rate;
    const rate = typeof hr === "number" && hr >= 0 ? hr : DEFAULT_HOURLY_RATE;
    userRate.set(id, rate);
  }

  const minutesByUser = new Map<string, number>();
  for (const row of (attRows as DbAttendanceRow[] | null) ?? []) {
    const uid = row.user_id;
    const m = Number(row.duration_minutes) || 0;
    minutesByUser.set(uid, (minutesByUser.get(uid) ?? 0) + m);
  }

  let totalMinutes = 0;
  let totalPay = 0;
  for (const [uid, mins] of Array.from(minutesByUser.entries())) {
    totalMinutes += mins;
    const rate = userRate.get(uid) ?? DEFAULT_HOURLY_RATE;
    totalPay += calcMonthlyPay(mins, rate);
  }

  const validRate = safeRatePercent(totals.validCalls, totals.totalCalls);
  const kcRate = safeRatePercent(totals.kcCount, totals.validCalls);
  const apoFromKcRate = safeRatePercent(totals.totalApo, totals.kcCount);

  const apoUnit =
    totals.totalApo > 0 && Number.isFinite(totalPay) ? totalPay / totals.totalApo : null;
  const decisionMakerApoUnit =
    totals.decisionMakerApo > 0 && Number.isFinite(totalPay) ? totalPay / totals.decisionMakerApo : null;

  const dateLine = formatDateWithWeekdayJa(dateStr);
  const apoDetailBlock = `💰 【アポ単価詳細】
・通常アポ単価：${apoUnit != null && Number.isFinite(apoUnit) ? yenDisplay(apoUnit) : "—"}
・決済者アポ単価：${decisionMakerApoUnit != null && Number.isFinite(decisionMakerApoUnit) ? yenDisplay(decisionMakerApoUnit) : "—"}`;

  const text = `【業務委託稼働報告】
${dateLine}
----------------------------
⓪総コール数：${totals.totalCalls}
①総有効コール数：${totals.validCalls}
②KC数：${totals.kcCount}
③追いかけ作成：${totals.followUpCreated}
④決裁者アポ：${totals.decisionMakerApo}
⑤非決裁者アポ：${totals.nonDecisionMakerApo}
⑥合計アポ数：${totals.totalApo}
⑦有効コール率（①÷⓪）：${pctDisplay(validRate)}
⑧KC率（②÷①）：${pctDisplay(kcRate)}
⑨KCからのアポ率（⑥÷②）：${pctDisplay(apoFromKcRate)}
⑩1日の総稼働時間：${formatDuration(totalMinutes)}
⑪総稼働時間に対する委託料合計：${yenDisplay(totalPay)}
⑫その日のアポ単価（⑪÷⑥）：${apoUnit != null && Number.isFinite(apoUnit) ? yenDisplay(apoUnit) : "-"}
${apoDetailBlock}`;

  const posted = await postSlackIncomingWebhook(webhookUrl, { text });
  if (!posted.ok) {
    return { ok: false, error: posted.error, detail: posted.detail };
  }

  return { ok: true, date: dateStr, sent: true };
}
