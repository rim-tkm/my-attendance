import { getSupabase } from "@/lib/supabase";
import {
  DEFAULT_HOURLY_RATE,
  getKpiTotalsFromRecords,
  getKpiForUser,
  getRecordsForUser,
  safeRatePercent,
  type KpiRecord,
  type Member,
  type WorkRecord,
} from "@/lib/attendance";
import {
  computeCostYen,
  computeLaborCostYen,
  computeRoi,
  computeValueCreatedYenFromTotals,
  ROI_FIXED_COST_ADMIN_YEN,
  ROI_FIXED_COST_AUTOCALL_YEN,
  ROI_PER_PERSON_FIXED_COST_YEN,
} from "@/lib/roi-analysis";
import { postSlackIncomingWebhook, resolveSlackWebhookUrl, slackWebhookMissingMessage } from "@/lib/slack-webhook";

export { getTodayJstDateString } from "@/lib/export-schedule";

function formatRangeLabelJa(start: string, end: string): string {
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me, de] = end.split("-").map(Number);
  const a = new Date(ys, ms - 1, ds).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
  const b = new Date(ye, me - 1, de).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
  return `${a}〜${b}`;
}

/**
 * 定期ランキングの集計期間（JSTの「今日」が基準）
 * - 15日: 当月1日〜15日
 * - 1日: 前月16日〜前月末日
 */
export function getRankingPeriodForAnchor(anchorJst: string): { start: string; end: string; labelJa: string } | null {
  const parts = anchorJst.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const day = parts[2];
  if (!y || !m || !day) return null;

  if (day === 15) {
    const start = `${y}-${String(m).padStart(2, "0")}-01`;
    const end = anchorJst;
    return { start, end, labelJa: formatRangeLabelJa(start, end) };
  }
  if (day === 1) {
    const prevMonthLast = new Date(y, m - 1, 0);
    const py = prevMonthLast.getFullYear();
    const pm = prevMonthLast.getMonth() + 1;
    const lastD = prevMonthLast.getDate();
    const start = `${py}-${String(pm).padStart(2, "0")}-16`;
    const end = `${py}-${String(pm).padStart(2, "0")}-${String(lastD).padStart(2, "0")}`;
    return { start, end, labelJa: formatRangeLabelJa(start, end) };
  }
  return null;
}

export function rankingSignalEmoji(roi: number | null): string {
  if (roi == null || !Number.isFinite(roi)) return "⚪️";
  if (roi >= 2) return "🔵";
  if (roi >= 1) return "🟡";
  return "🔴";
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
  id: string;
  user_id: string;
  date: string;
  duration_minutes: number | null;
  start_raw: string;
  start_rounded: string;
  end_raw: string;
  end_rounded: string;
  is_auto_completed?: boolean;
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

function rowToWorkRecord(r: DbAttendanceRow): WorkRecord {
  return {
    id: r.id,
    userId: r.user_id,
    date: r.date,
    durationMinutes: Number(r.duration_minutes) || 0,
    startRaw: r.start_raw ?? "",
    startRounded: r.start_rounded ?? "",
    endRaw: r.end_raw ?? "",
    endRounded: r.end_rounded ?? "",
    isAutoCompleted: r.is_auto_completed === true,
  };
}

export type MemberRankingEntry = {
  rank: number;
  name: string;
  userId: string;
  emoji: string;
  roi: number | null;
  totalCalls: number;
  validCalls: number;
  kcCount: number;
  followUpCreated: number;
  decisionMakerApo: number;
  nonDecisionMakerApo: number;
  totalApo: number;
  validCallRate: number | null;
  kcRate: number | null;
  apoFromKcRate: number | null;
  totalMinutes: number;
  laborCostYen: number;
  fixedCostYen: number;
  costYen: number;
  valueYen: number;
  apoUnitYen: number | null;
  /** 消費コスト ÷ 決裁者アポ数 */
  decisionMakerApoUnitYen: number | null;
};

function toMemberLite(r: {
  id: string;
  name: string | null;
  login_account: string | null;
  hourly_rate: number | null;
  is_active: boolean | null;
}): Member {
  return {
    id: r.id,
    name: (r.name ?? "").trim(),
    loginAccount: (r.login_account ?? "").trim(),
    hourlyRate: typeof r.hourly_rate === "number" && r.hourly_rate >= 0 ? r.hourly_rate : DEFAULT_HOURLY_RATE,
    isActive: r.is_active === undefined || r.is_active === null ? true : !!r.is_active,
  };
}

export type LoadSupabaseRoiSourceResult =
  | { ok: true; kpis: KpiRecord[]; records: WorkRecord[]; members: Member[] }
  | { ok: false; error: string };

/** 指定期間の KPI・稼働・ユーザーを Supabase から取得（ROI ランキング・手動レポート共通） */
export async function loadSupabaseRoiSourceForRange(
  start: string,
  end: string
): Promise<LoadSupabaseRoiSourceResult> {
  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: "Supabase is not configured" };
  }

  const [{ data: kpiRows }, { data: attRows }, { data: userRows }] = await Promise.all([
    supabase.from("kpis").select("*").gte("date", start).lte("date", end),
    supabase.from("attendance").select("*").gte("date", start).lte("date", end),
    supabase.from("users").select("id, name, login_account, hourly_rate, is_active"),
  ]);

  const kpis = (kpiRows as DbKpiRow[] | null)?.map(rowToKpi) ?? [];
  const records = (attRows as DbAttendanceRow[] | null)?.map(rowToWorkRecord) ?? [];
  const members = (userRows ?? []).map((u) =>
    toMemberLite(u as Parameters<typeof toMemberLite>[0])
  );

  return { ok: true, kpis, records, members };
}

export function buildMemberRankingEntries(
  start: string,
  end: string,
  allKpi: KpiRecord[],
  allRecords: WorkRecord[],
  members: Member[]
): MemberRankingEntry[] {
  const contractorMembers = members.filter(
    (m) => m.isActive !== false && (m.loginAccount ?? "").toLowerCase() !== "admin"
  );

  const entries: MemberRankingEntry[] = contractorMembers.map((mem) => {
    const kpis = getKpiForUser(allKpi, mem.id).filter((k) => k.date >= start && k.date <= end);
    const totals = getKpiTotalsFromRecords(kpis);
    const valueYen = computeValueCreatedYenFromTotals({
      totalCalls: totals.totalCalls,
      followUpCreated: totals.followUpCreated,
      nonDecisionMakerApo: totals.nonDecisionMakerApo,
      decisionMakerApo: totals.decisionMakerApo,
    });
    const totalMinutes = getRecordsForUser(allRecords, mem.id)
      .filter((r) => r.date >= start && r.date <= end)
      .reduce((s, r) => s + r.durationMinutes, 0);
    const rate = mem.hourlyRate != null && mem.hourlyRate >= 0 ? mem.hourlyRate : DEFAULT_HOURLY_RATE;
    const laborCostYen = computeLaborCostYen(totalMinutes, rate);
    const fixedCostYen = ROI_PER_PERSON_FIXED_COST_YEN;
    const costYen = computeCostYen(totalMinutes, rate);
    const roi = computeRoi(valueYen, costYen);
    const validCallRate = safeRatePercent(totals.validCalls, totals.totalCalls);
    const kcRate = safeRatePercent(totals.kcCount, totals.validCalls);
    const apoFromKcRate = safeRatePercent(totals.totalApo, totals.kcCount);
    const apoUnitYen =
      totals.totalApo > 0 && Number.isFinite(costYen) ? costYen / totals.totalApo : null;
    const decisionMakerApoUnitYen =
      totals.decisionMakerApo > 0 && Number.isFinite(costYen) ? costYen / totals.decisionMakerApo : null;

    return {
      rank: 0,
      name: mem.name,
      userId: mem.id,
      emoji: rankingSignalEmoji(roi),
      roi,
      totalCalls: totals.totalCalls,
      validCalls: totals.validCalls,
      kcCount: totals.kcCount,
      followUpCreated: totals.followUpCreated,
      decisionMakerApo: totals.decisionMakerApo,
      nonDecisionMakerApo: totals.nonDecisionMakerApo,
      totalApo: totals.totalApo,
      validCallRate,
      kcRate,
      apoFromKcRate,
      totalMinutes,
      laborCostYen,
      fixedCostYen,
      costYen,
      valueYen,
      apoUnitYen,
      decisionMakerApoUnitYen,
    };
  });

  entries.sort((a, b) => {
    if (a.roi == null && b.roi == null) return a.name.localeCompare(b.name, "ja");
    if (a.roi == null) return 1;
    if (b.roi == null) return -1;
    if (b.roi !== a.roi) return b.roi - a.roi;
    return a.name.localeCompare(b.name, "ja");
  });

  entries.forEach((e, i) => {
    e.rank = i + 1;
  });

  return entries;
}

function pct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "-";
  return `${v}%`;
}

function yenDisplay(n: number): string {
  return `¥${Math.floor(n).toLocaleString("ja-JP")}`;
}

/** ランキング本文（Slack 用・区切り線・日本語ラベル） */
export function formatSlackMemberRankingDetails(entries: MemberRankingEntry[]): string {
  if (entries.length === 0) {
    return "対象メンバーがありません。";
  }

  const lines: string[] = [];
  const sep = "--------------------";

  entries.forEach((e, i) => {
    if (i > 0) lines.push(sep);

    const displayName = e.name.trim() ? e.name : "(名前なし)";
    const roiStr =
      e.roi != null && Number.isFinite(e.roi) ? String(Number(e.roi.toFixed(2))) : "—";
    const headline = `*${e.rank}位：${displayName} ${e.emoji} (ROI: ${roiStr})*`;

    const decisionApoRate = safeRatePercent(e.decisionMakerApo, e.totalCalls);
    const apoUnitStr =
      e.apoUnitYen != null && Number.isFinite(e.apoUnitYen) ? yenDisplay(e.apoUnitYen) : "—";
    const decisionApoUnitStr =
      e.decisionMakerApoUnitYen != null && Number.isFinite(e.decisionMakerApoUnitYen)
        ? yenDisplay(e.decisionMakerApoUnitYen)
        : "—";

    lines.push(headline);
    lines.push("");
    lines.push(
      `💰 生産性: 創出価値 ${yenDisplay(e.valueYen)} / 総コスト ${yenDisplay(e.costYen)}（給与: ${yenDisplay(e.laborCostYen)} / 固定費: ${yenDisplay(e.fixedCostYen)} ※オートコール${yenDisplay(ROI_FIXED_COST_AUTOCALL_YEN)}・管理${yenDisplay(ROI_FIXED_COST_ADMIN_YEN)}）`
    );
    lines.push("");
    lines.push("📊 主要指標:");
    lines.push("");
    lines.push(`総コール: ${e.totalCalls}件 (有効率: ${pct(e.validCallRate)})`);
    lines.push(`決アポ数: ${e.decisionMakerApo}件 (決アポ率: ${pct(decisionApoRate)})`);
    lines.push("💰 【アポ単価詳細】");
    lines.push(`・通常アポ単価：${apoUnitStr}`);
    lines.push(`・決済者アポ単価：${decisionApoUnitStr}`);
    lines.push("");
    lines.push(
      `📝 詳細: [KC: ${e.kcCount} / 追いかけ: ${e.followUpCreated} / 非決アポ: ${e.nonDecisionMakerApo}]`
    );
  });

  lines.push("");
  lines.push(sep);
  lines.push("");
  lines.push(
    "【判定】🔵 ROI 2.0以上 ／ 🟡 ROI 1.0以上（2.0未満） ／ 🔴 ROI 1.0未満 ／ ⚪️ 算出不可（数値不整合など）"
  );

  return lines.join("\n");
}

export function formatSlackRankingMessage(labelJa: string, entries: MemberRankingEntry[]): string {
  const header = ["【定期ROIランキング報告】", `集計期間: ${labelJa}`, ""].join("\n");
  return header + formatSlackMemberRankingDetails(entries);
}

export type SlackRankingResult =
  | { ok: true; anchor: string; start: string; end: string }
  | { ok: false; error: string; detail?: string };

export async function sendSlackRanking(anchorJst: string): Promise<SlackRankingResult> {
  const webhookUrl = resolveSlackWebhookUrl("ranking");
  if (!webhookUrl) {
    return { ok: false, error: "Slack webhook is not configured", detail: slackWebhookMissingMessage("ranking") };
  }

  const period = getRankingPeriodForAnchor(anchorJst);
  if (!period) {
    return {
      ok: false,
      error: "集計対象日ではありません（JSTで毎月1日または15日の日付をアンカーに指定してください）",
    };
  }

  const { start, end } = period;

  const loaded = await loadSupabaseRoiSourceForRange(start, end);
  if (!loaded.ok) {
    return { ok: false, error: loaded.error };
  }
  const { kpis, records, members } = loaded;

  const entries = buildMemberRankingEntries(start, end, kpis, records, members);
  const text = formatSlackRankingMessage(period.labelJa, entries);

  const posted = await postSlackIncomingWebhook(webhookUrl, { text });
  if (!posted.ok) {
    return { ok: false, error: posted.error, detail: posted.detail };
  }

  return { ok: true, anchor: anchorJst, start, end };
}
