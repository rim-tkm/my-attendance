import {
  getKpiForDate,
  getKpiForUser,
  getOpenRecordForUser,
  getRecordsForUser,
  kpiRecordHasOperationalMetrics,
  type WorkRecord,
} from "@/lib/attendance";
import { getTodayJstDateString, isWeekendYmdJst } from "@/lib/export-schedule";
import {
  loadKpi,
  loadMembers,
  loadOpenRecords,
  loadRecords,
  releaseKpiMissingAfterPunchAlertSent,
  tryClaimKpiMissingAfterPunchAlertSent,
} from "@/lib/supabase-data";
import { getSupabase } from "@/lib/supabase";
import { postSlackIncomingWebhook, resolveSlackWebhookUrl, slackWebhookMissingMessage } from "@/lib/slack-webhook";
import { getSlackKpiMissingNotifyMentionLine } from "@/lib/slack-kpi-missing-mentions";

export function readKpiMissingAfterPunchGraceMinutes(): number {
  const v = process.env.KPI_MISSING_AFTER_PUNCH_MINUTES?.trim();
  if (!v) return 15;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 && n <= 240 ? n : 15;
}

/** 日本時間のその日 0:00 のエポック ms */
function jstMidnightMsForYmd(ymd: string): number {
  const [y, M, d] = ymd.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(M) || !Number.isFinite(d)) return NaN;
  return new Date(
    `${y}-${String(M).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00+09:00`
  ).getTime();
}

/** 終了打刻が「本日 JST 0:00 以降」に行われた活動記録のみを対象に、当日の最遅 end を求める */
function latestEndMsAmongPunchesOnOrAfterTodayJst(
  dayRecs: WorkRecord[],
  /** 稼働日（通常は本日 JST） */
  workDateYmd: string,
  todayStartJstMs: number
): { maxEndMs: number; maxEndIso: string } | null {
  let maxEndMs = 0;
  let maxEndIso = "";
  for (const r of dayRecs) {
    if (r.date !== workDateYmd) continue;
    const endMs = new Date(r.endRaw).getTime();
    const startMs = new Date(r.startRaw).getTime();
    if (!Number.isFinite(endMs) || !Number.isFinite(startMs) || endMs <= startMs) continue;
    if (endMs < todayStartJstMs) continue;
    if (endMs > maxEndMs) {
      maxEndMs = endMs;
      maxEndIso = r.endRaw;
    }
  }
  if (maxEndMs === 0 || maxEndIso === "") return null;
  return { maxEndMs, maxEndIso };
}

/** attendance の終了打刻を JST で読みやすく表示 */
export function formatEndPunchDisplayJst(isoEndRaw: string): string {
  const d = new Date(isoEndRaw);
  if (Number.isNaN(d.getTime())) return isoEndRaw;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function buildKpiMissingAfterPunchSlackText(params: {
  memberName: string;
  endPunchDisplay: string;
  graceMinutes: number;
  mentionLine?: string;
}): string {
  const mentionPrefix =
    params.mentionLine && params.mentionLine.trim() !== "" ? `${params.mentionLine.trim()}\n\n` : "";
  const g = params.graceMinutes;
  return `${mentionPrefix}🚨 【KPI未入力アラート：至急確認】

👤 ${params.memberName} さん
・終了打刻時刻：${params.endPunchDisplay}

⚠️ 状況: 業務終了の打刻から${g}分が経過しましたが、KPIの数値報告が完了していません。
💡 報告が漏れている可能性があります。速やかに数値を入力して確定させるよう本人へ指示してください。`;
}

export type KpiMissingAfterPunchNotifyResult =
  | { ok: true; notified: false; reason: string }
  | { ok: true; notified: true }
  | { ok: false; error: string; detail?: string };

/**
 * ログイン中ユーザーについて「本日・終了打刻＋猶予後・KPI 未入力」のときだけ Slack を 1 回送信。
 * Cron ではなく、終了打刻後のタイマーまたは KPI タブ表示などから呼ぶ想定。
 */
export async function tryNotifyKpiMissingAfterPunchForUser(userId: string): Promise<KpiMissingAfterPunchNotifyResult> {
  const workDate = getTodayJstDateString();
  if (isWeekendYmdJst(workDate)) {
    return { ok: true, notified: false, reason: "weekend" };
  }

  const nowMs = Date.now();
  const graceMinutes = readKpiMissingAfterPunchGraceMinutes();
  const graceMs = graceMinutes * 60 * 1000;
  const todayStartJstMs = jstMidnightMsForYmd(workDate);
  if (!Number.isFinite(todayStartJstMs)) {
    return { ok: true, notified: false, reason: "invalid_date" };
  }

  const [membersOrNull, records, openRecs, kpis] = await Promise.all([
    loadMembers(),
    loadRecords(),
    loadOpenRecords(),
    loadKpi(),
  ]);
  const members = membersOrNull ?? [];
  const m = members.find((x) => x.id === userId);
  if (!m || m.isActive === false) {
    return { ok: true, notified: false, reason: "no_member" };
  }
  if ((m.loginAccount ?? "").trim().toLowerCase() === "admin") {
    return { ok: true, notified: false, reason: "admin" };
  }
  const firstWork = m.firstWorkDate?.trim();
  if (firstWork && /^\d{4}-\d{2}-\d{2}$/.test(firstWork) && workDate < firstWork) {
    return { ok: true, notified: false, reason: "before_first_work" };
  }

  const open = getOpenRecordForUser(openRecs, userId);
  if (open && open.date === workDate) {
    return { ok: true, notified: false, reason: "open_record" };
  }

  const dayRecs = getRecordsForUser(records, userId).filter((r) => r.date === workDate);
  const latest = latestEndMsAmongPunchesOnOrAfterTodayJst(dayRecs, workDate, todayStartJstMs);
  if (!latest) {
    return { ok: true, notified: false, reason: "no_eligible_punch_today" };
  }
  if (nowMs < latest.maxEndMs + graceMs) {
    return { ok: true, notified: false, reason: "grace_not_elapsed" };
  }

  const kpiRow = getKpiForDate(getKpiForUser(kpis, userId), workDate);
  if (kpiRecordHasOperationalMetrics(kpiRow)) {
    return { ok: true, notified: false, reason: "kpi_filled" };
  }

  const supabase = getSupabase();
  if (!supabase) {
    return { ok: true, notified: false, reason: "no_supabase" };
  }

  const { data: sentPrecheck } = await supabase
    .from("kpi_missing_after_punch_alert_sent")
    .select("user_id")
    .eq("user_id", userId)
    .eq("work_date", workDate)
    .maybeSingle();
  if (sentPrecheck) {
    return { ok: true, notified: false, reason: "already_notified_sent_table_precheck" };
  }

  const { data: kpiFlag, error: kpiErr } = await supabase
    .from("kpis")
    .select("kpi_missing_slack_notified_at")
    .eq("user_id", userId)
    .eq("date", workDate)
    .eq("start_time", "00:00:00")
    .maybeSingle();
  if (kpiErr) {
    console.warn("[kpi-missing-after-punch] kpis flag read:", kpiErr);
  } else if (kpiFlag && (kpiFlag as { kpi_missing_slack_notified_at?: string | null }).kpi_missing_slack_notified_at) {
    return { ok: true, notified: false, reason: "already_notified_kpi_column" };
  }

  const claimed = await tryClaimKpiMissingAfterPunchAlertSent(userId, workDate);
  if (!claimed) {
    return { ok: true, notified: false, reason: "already_notified_sent_table" };
  }

  const webhookUrl = resolveSlackWebhookUrl("kpi_missing_after_punch");
  if (!webhookUrl) {
    await releaseKpiMissingAfterPunchAlertSent(userId, workDate);
    console.warn(
      "[kpi-missing-after-punch] Webhook が未設定のため送信しません（" +
        slackWebhookMissingMessage("kpi_missing_after_punch") +
        "）"
    );
    return { ok: true, notified: false, reason: "no_webhook" };
  }

  const memberName = (m.name ?? "").trim() || "（氏名なし）";
  const text = buildKpiMissingAfterPunchSlackText({
    memberName,
    endPunchDisplay: formatEndPunchDisplayJst(latest.maxEndIso),
    graceMinutes,
    mentionLine: getSlackKpiMissingNotifyMentionLine(),
  });
  const posted = await postSlackIncomingWebhook(webhookUrl, { text });
  if (!posted.ok) {
    await releaseKpiMissingAfterPunchAlertSent(userId, workDate);
    return { ok: false, error: posted.error, detail: posted.detail };
  }

  const at = new Date().toISOString();
  const { error: upErr } = await supabase
    .from("kpis")
    .update({ kpi_missing_slack_notified_at: at })
    .eq("user_id", userId)
    .eq("date", workDate)
    .eq("start_time", "00:00:00");
  if (upErr) {
    console.warn("[kpi-missing-after-punch] kpi_missing_slack_notified_at update:", upErr);
  }

  return { ok: true, notified: true };
}
