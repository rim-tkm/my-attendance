import type { KpiRecord, Member, WorkRecord } from "@/lib/attendance";
import {
  calcMonthlyPay,
  DEFAULT_HOURLY_RATE,
  formatDuration,
  getKpiForDate,
  getKpiForMonth,
  getKpiForUser,
  getKpiTotalsFromRecords,
  getRecordsForUser,
  getTotalMinutesForMonthByUser,
  safeRatePercent,
} from "@/lib/attendance";

/** 価値基準（円） */
export const ROI_YEN_PER_CALL = 10;
export const ROI_YEN_PER_FOLLOWUP = 100;
export const ROI_YEN_PER_NON_DECISION_APO = 200;
export const ROI_YEN_PER_DECISION_APO = 10_000;

export function computeValueCreatedYenFromTotals(t: {
  totalCalls: number;
  followUpCreated: number;
  nonDecisionMakerApo: number;
  decisionMakerApo: number;
}): number {
  return (
    t.totalCalls * ROI_YEN_PER_CALL +
    t.followUpCreated * ROI_YEN_PER_FOLLOWUP +
    t.nonDecisionMakerApo * ROI_YEN_PER_NON_DECISION_APO +
    t.decisionMakerApo * ROI_YEN_PER_DECISION_APO
  );
}

export function computeValueCreatedYenFromKpi(k: KpiRecord): number {
  return computeValueCreatedYenFromTotals({
    totalCalls: k.totalCalls,
    followUpCreated: k.followUpCreated,
    nonDecisionMakerApo: k.nonDecisionMakerApo,
    decisionMakerApo: k.decisionMakerApo,
  });
}

export function computeCostYen(totalMinutes: number, hourlyRate: number): number {
  return calcMonthlyPay(totalMinutes, hourlyRate);
}

/** 創出価値 ÷ コスト。コスト0は null */
export function computeRoi(valueYen: number, costYen: number): number | null {
  if (!Number.isFinite(valueYen) || !Number.isFinite(costYen) || costYen <= 0) return null;
  return valueYen / costYen;
}

export type RoiSignal = "red" | "yellow" | "green" | "neutral";

/** ROI 信号機: 1未満赤、1〜2未満黄、2以上緑 */
export function roiTrafficSignal(roi: number | null): RoiSignal {
  if (roi == null || !Number.isFinite(roi)) return "neutral";
  if (roi < 1) return "red";
  if (roi < 2) return "yellow";
  return "green";
}

/** 開始・終了を正規化（入れ替え） */
export function normalizeRoiRange(startDate: string, endDate: string): { start: string; end: string } {
  const a = startDate <= endDate ? startDate : endDate;
  const b = startDate <= endDate ? endDate : startDate;
  return { start: a, end: b };
}

/** 日付文字列 YYYY-MM-DD に n 日加算 */
export function addCalendarDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const x = new Date(y, m - 1, d + delta);
  const yy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * 今日を含む「直近 N カレンダー月」の先頭日（1日）。
 * N=3 → 当月・前月・前々月のうち最も早い月の1日
 */
export function firstDayOfRollingCalendarMonths(todayStr: string, monthCount: number): string {
  if (monthCount < 1) return todayStr;
  const [y, m] = todayStr.split("-").map(Number);
  const x = new Date(y, m - 1 - (monthCount - 1), 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-01`;
}

/** 対象月の 1 日〜（当月なら今日・それ以外は月末） */
export function getMonthDateRange(yearMonth: string, todayStr: string): { start: string; end: string } {
  const [y, m] = yearMonth.split("-").map(Number);
  const start = `${yearMonth}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const last = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const end = yearMonth === todayStr.slice(0, 7) ? todayStr : last;
  return { start, end };
}

/** 開始日〜終了日を日付文字列の配列で列挙 */
export function getDateStringsInclusive(startDate: string, endDate: string): string[] {
  const { start, end } = normalizeRoiRange(startDate, endDate);
  const out: string[] = [];
  const [y0, m0, d0] = start.split("-").map(Number);
  let cd = new Date(y0, m0 - 1, d0);
  const [y1, m1, d1] = end.split("-").map(Number);
  const endD = new Date(y1, m1 - 1, d1);
  while (cd <= endD) {
    const yy = cd.getFullYear();
    const mm = String(cd.getMonth() + 1).padStart(2, "0");
    const dd = String(cd.getDate()).padStart(2, "0");
    out.push(`${yy}-${mm}-${dd}`);
    cd = new Date(cd.getFullYear(), cd.getMonth(), cd.getDate() + 1);
  }
  return out;
}

function csvEscapeCell(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export type RoiCsvDayRow = {
  name: string;
  date: string;
  durationLabel: string;
  hourlyRate: number;
  costYen: number;
  totalCalls: number;
  validCalls: number;
  kcCount: number;
  followUpCreated: number;
  decisionMakerApo: number;
  nonDecisionMakerApo: number;
  totalApo: number;
  valueYen: number;
  roi: number | null;
};

export function buildRoiCsvDayRows(
  startDate: string,
  endDate: string,
  activeMembers: Member[],
  allKpiRecords: KpiRecord[],
  allRecords: WorkRecord[]
): RoiCsvDayRow[] {
  const { start, end } = normalizeRoiRange(startDate, endDate);
  const days = getDateStringsInclusive(start, end);
  const rows: RoiCsvDayRow[] = [];
  for (const mem of activeMembers) {
    const hourlyRate = mem.hourlyRate != null && mem.hourlyRate >= 0 ? mem.hourlyRate : DEFAULT_HOURLY_RATE;
    const userKpi = getKpiForUser(allKpiRecords, mem.id);
    const userRec = getRecordsForUser(allRecords, mem.id);
    for (const dateStr of days) {
      const k = getKpiForDate(userKpi, dateStr);
      const mins = userRec.filter((r) => r.date === dateStr).reduce((s, r) => s + r.durationMinutes, 0);
      const costYen = calcMonthlyPay(mins, hourlyRate);
      const totalCalls = k?.totalCalls ?? 0;
      const validCalls = k?.validCalls ?? 0;
      const kcCount = k?.kcCount ?? 0;
      const followUpCreated = k?.followUpCreated ?? 0;
      const decisionMakerApo = k?.decisionMakerApo ?? 0;
      const nonDecisionMakerApo = k?.nonDecisionMakerApo ?? 0;
      const totalApo = decisionMakerApo + nonDecisionMakerApo;
      const valueYen = k ? computeValueCreatedYenFromKpi(k) : 0;
      const roi = computeRoi(valueYen, costYen);
      rows.push({
        name: mem.name,
        date: dateStr,
        durationLabel: formatDuration(mins),
        hourlyRate,
        costYen,
        totalCalls,
        validCalls,
        kcCount,
        followUpCreated,
        decisionMakerApo,
        nonDecisionMakerApo,
        totalApo,
        valueYen,
        roi,
      });
    }
  }
  return rows;
}

export function buildRoiCsvContent(rows: RoiCsvDayRow[]): string {
  const headers = [
    "名前",
    "日付",
    "総稼働時間",
    "時給",
    "コスト合計",
    "⓪総コール数",
    "①総有効コール",
    "②KC数",
    "③追いかけ制作",
    "④決裁者アポ",
    "⑤非決裁者アポ",
    "⑥合計アポ数",
    "創出価値額",
    "ROI",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const roiStr = r.roi != null && Number.isFinite(r.roi) ? String(Math.round(r.roi * 100) / 100) : "-";
    lines.push(
      [
        csvEscapeCell(r.name),
        r.date,
        csvEscapeCell(r.durationLabel),
        String(r.hourlyRate),
        String(r.costYen),
        String(r.totalCalls),
        String(r.validCalls),
        String(r.kcCount),
        String(r.followUpCreated),
        String(r.decisionMakerApo),
        String(r.nonDecisionMakerApo),
        String(r.totalApo),
        String(r.valueYen),
        roiStr,
      ].join(",")
    );
  }
  return `\uFEFF${lines.join("\n")}`;
}

export function getMonthDayStrings(yearMonth: string, capAtDateInclusive?: string): string[] {
  const [y, mo] = yearMonth.split("-").map(Number);
  const last = new Date(y, mo, 0).getDate();
  const out: string[] = [];
  for (let d = 1; d <= last; d++) {
    const ds = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (capAtDateInclusive && ds > capAtDateInclusive) break;
    out.push(ds);
  }
  return out;
}

/** 指定日・チーム全体の創出価値・コスト */
export function computeTeamDayValueAndCost(
  dateStr: string,
  activeMembers: Member[],
  allKpiRecords: KpiRecord[],
  allRecords: WorkRecord[]
): { valueYen: number; costYen: number } {
  let valueYen = 0;
  let costYen = 0;
  for (const mem of activeMembers) {
    const k = getKpiForDate(getKpiForUser(allKpiRecords, mem.id), dateStr);
    if (k) valueYen += computeValueCreatedYenFromKpi(k);
    const mins = getRecordsForUser(allRecords, mem.id)
      .filter((r) => r.date === dateStr)
      .reduce((s, r) => s + r.durationMinutes, 0);
    const rate = mem.hourlyRate != null && mem.hourlyRate >= 0 ? mem.hourlyRate : DEFAULT_HOURLY_RATE;
    costYen += calcMonthlyPay(mins, rate);
  }
  return { valueYen, costYen };
}

export type DailyRoiPoint = { date: string; roi: number | null };

/** 月内の日別チーム ROI（コスト0の日は null） */
export function buildTeamDailyRoiSeries(
  yearMonth: string,
  activeMembers: Member[],
  allKpiRecords: KpiRecord[],
  allRecords: WorkRecord[],
  todayStr: string
): DailyRoiPoint[] {
  const cap = yearMonth === todayStr.slice(0, 7) ? todayStr : undefined;
  const days = getMonthDayStrings(yearMonth, cap);
  return days.map((dateStr) => {
    const { valueYen, costYen } = computeTeamDayValueAndCost(dateStr, activeMembers, allKpiRecords, allRecords);
    return { date: dateStr, roi: computeRoi(valueYen, costYen) };
  });
}

export type MemberRoiRow = {
  memberId: string;
  name: string;
  totalMinutes: number;
  valueYen: number;
  costYen: number;
  roi: number | null;
  decisionApoRate: number | null;
  signal: RoiSignal;
};

export function buildMemberRoiRows(
  yearMonth: string,
  activeMembers: Member[],
  allKpiRecords: KpiRecord[],
  allRecords: WorkRecord[]
): MemberRoiRow[] {
  return activeMembers.map((mem) => {
    const monthKpis = getKpiForMonth(getKpiForUser(allKpiRecords, mem.id), yearMonth);
    const totals = getKpiTotalsFromRecords(monthKpis);
    const valueYen = computeValueCreatedYenFromTotals({
      totalCalls: totals.totalCalls,
      followUpCreated: totals.followUpCreated,
      nonDecisionMakerApo: totals.nonDecisionMakerApo,
      decisionMakerApo: totals.decisionMakerApo,
    });
    const totalMinutes = getTotalMinutesForMonthByUser(allRecords, mem.id, yearMonth);
    const rate = mem.hourlyRate != null && mem.hourlyRate >= 0 ? mem.hourlyRate : DEFAULT_HOURLY_RATE;
    const costYen = computeCostYen(totalMinutes, rate);
    const roi = computeRoi(valueYen, costYen);
    const decisionApoRate = safeRatePercent(totals.decisionMakerApo, totals.totalCalls);
    return {
      memberId: mem.id,
      name: mem.name,
      totalMinutes,
      valueYen,
      costYen,
      roi,
      decisionApoRate,
      signal: roiTrafficSignal(roi),
    };
  });
}

/** 任意期間のメンバー別 ROI 集計（KPI・活動記録を期間内で合算） */
export function buildMemberRoiRowsForRange(
  startDate: string,
  endDate: string,
  activeMembers: Member[],
  allKpiRecords: KpiRecord[],
  allRecords: WorkRecord[]
): MemberRoiRow[] {
  const { start, end } = normalizeRoiRange(startDate, endDate);
  return activeMembers.map((mem) => {
    const userKpis = getKpiForUser(allKpiRecords, mem.id).filter((k) => k.date >= start && k.date <= end);
    const totals = getKpiTotalsFromRecords(userKpis);
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
    const costYen = computeCostYen(totalMinutes, rate);
    const roi = computeRoi(valueYen, costYen);
    const decisionApoRate = safeRatePercent(totals.decisionMakerApo, totals.totalCalls);
    return {
      memberId: mem.id,
      name: mem.name,
      totalMinutes,
      valueYen,
      costYen,
      roi,
      decisionApoRate,
      signal: roiTrafficSignal(roi),
    };
  });
}

/** 期間内の日別チーム ROI（未来日は除外） */
export function buildTeamDailyRoiSeriesForRange(
  startDate: string,
  endDate: string,
  activeMembers: Member[],
  allKpiRecords: KpiRecord[],
  allRecords: WorkRecord[],
  todayStr: string
): DailyRoiPoint[] {
  const { start, end } = normalizeRoiRange(startDate, endDate);
  const days = getDateStringsInclusive(start, end).filter((d) => d <= todayStr);
  return days.map((dateStr) => {
    const { valueYen, costYen } = computeTeamDayValueAndCost(dateStr, activeMembers, allKpiRecords, allRecords);
    return { date: dateStr, roi: computeRoi(valueYen, costYen) };
  });
}
