import type { KpiRecord, Member, WorkRecord } from "@/lib/attendance";
import { getKpiForMonth, getKpiInDateRange, getKpiTotalsFromRecords, safeRatePercent } from "@/lib/attendance";
import {
  calcInternInvoiceAmounts,
  getInternUnitRates,
  isInternMember,
  sumInternConfirmedAppsForMonth,
  type InternConfirmedMonthTotals,
} from "@/lib/invoice-intern";
import { addCalendarDays } from "@/lib/roi-analysis";

export type DashboardMemberSplit = {
  general: Member[];
  intern: Member[];
  generalIds: Set<string>;
  internIds: Set<string>;
};

export function splitDashboardMembers(
  members: Member[],
  isAdmin: (m: Member) => boolean
): DashboardMemberSplit {
  const eligible = members.filter((m) => m.isActive !== false && !isAdmin(m));
  const general = eligible.filter((m) => !isInternMember(m));
  const intern = eligible.filter((m) => isInternMember(m));
  return {
    general,
    intern,
    generalIds: new Set(general.map((m) => m.id)),
    internIds: new Set(intern.map((m) => m.id)),
  };
}

export type GeneralDashboardMetrics = {
  totalMinutes: number;
  totalApo: number;
  aposPerHour: number | null;
  decisionMakerApo: number;
  kcRate: number | null;
  apoRate: number | null;
};

export function computeGeneralDashboardMetrics(
  generalIds: Set<string>,
  allKpiRecords: KpiRecord[],
  allRecords: WorkRecord[],
  yearMonth: string
): GeneralDashboardMetrics {
  const monthKpis = getKpiForMonth(allKpiRecords, yearMonth).filter((k) => generalIds.has(k.userId));
  const totals = getKpiTotalsFromRecords(monthKpis);
  const totalMinutes = allRecords
    .filter((r) => r.date.startsWith(yearMonth) && generalIds.has(r.userId))
    .reduce((s, r) => s + r.durationMinutes, 0);
  const hours = totalMinutes / 60;
  const aposPerHour = hours > 0 ? totals.totalApo / hours : null;
  const kcRate = safeRatePercent(totals.kcCount, totals.validCalls);
  const apoRate = safeRatePercent(totals.decisionMakerApo, totals.validCalls);
  return {
    totalMinutes,
    totalApo: totals.totalApo,
    aposPerHour,
    decisionMakerApo: totals.decisionMakerApo,
    kcRate,
    apoRate,
  };
}

export type InternDashboardMetrics = {
  confirmedDecision: number;
  confirmedNonDecision: number;
  totalRewardYen: number;
};

export function computeInternDashboardMetrics(
  interns: Member[],
  allKpiRecords: KpiRecord[],
  yearMonth: string
): InternDashboardMetrics {
  let confirmedDecision = 0;
  let confirmedNonDecision = 0;
  let totalRewardYen = 0;
  for (const m of interns) {
    const totals = sumInternConfirmedAppsForMonth(allKpiRecords, m.id, yearMonth);
    confirmedDecision += totals.decisionCount;
    confirmedNonDecision += totals.nonDecisionCount;
    totalRewardYen += calcInternInvoiceAmounts(totals, getInternUnitRates(m)).totalWithTax;
  }
  return { confirmedDecision, confirmedNonDecision, totalRewardYen };
}

export function sumInternConfirmedAppsInRange(
  allKpiRecords: KpiRecord[],
  userId: string,
  startDate: string,
  endDate: string
): InternConfirmedMonthTotals {
  const rows = getKpiInDateRange(allKpiRecords, startDate, endDate).filter((k) => k.userId === userId);
  return {
    decisionCount: rows.reduce((s, k) => s + Math.max(0, k.confirmedDecisionMakerApps ?? 0), 0),
    nonDecisionCount: rows.reduce((s, k) => s + Math.max(0, k.confirmedNonDecisionMakerApps ?? 0), 0),
  };
}

export function computeInternDashboardMetricsForRange(
  interns: Member[],
  allKpiRecords: KpiRecord[],
  startDate: string,
  endDate: string
): InternDashboardMetrics {
  let confirmedDecision = 0;
  let confirmedNonDecision = 0;
  let totalRewardYen = 0;
  for (const m of interns) {
    const totals = sumInternConfirmedAppsInRange(allKpiRecords, m.id, startDate, endDate);
    confirmedDecision += totals.decisionCount;
    confirmedNonDecision += totals.nonDecisionCount;
    totalRewardYen += calcInternInvoiceAmounts(totals, getInternUnitRates(m)).totalWithTax;
  }
  return { confirmedDecision, confirmedNonDecision, totalRewardYen };
}

export type InternRewardRowForRange = {
  member: Member;
  confirmedDecision: number;
  confirmedNonDecision: number;
  rewardYen: number;
};

export function buildInternRewardRowsForRange(
  interns: Member[],
  allKpiRecords: KpiRecord[],
  startDate: string,
  endDate: string
): InternRewardRowForRange[] {
  return interns.map((member) => {
    const totals = sumInternConfirmedAppsInRange(allKpiRecords, member.id, startDate, endDate);
    const rewardYen = calcInternInvoiceAmounts(totals, getInternUnitRates(member)).totalWithTax;
    return {
      member,
      confirmedDecision: totals.decisionCount,
      confirmedNonDecision: totals.nonDecisionCount,
      rewardYen,
    };
  });
}

export function computeGeneralKpiMetricsForRange(
  generalIds: Set<string>,
  allKpiRecords: KpiRecord[],
  allRecords: WorkRecord[],
  startDate: string,
  endDate: string
): GeneralDashboardMetrics & { totals: ReturnType<typeof getKpiTotalsFromRecords> } {
  const rangeKpis = getKpiInDateRange(allKpiRecords, startDate, endDate).filter((k) => generalIds.has(k.userId));
  const totals = getKpiTotalsFromRecords(rangeKpis);
  const totalMinutes = allRecords
    .filter((r) => generalIds.has(r.userId) && r.date >= startDate && r.date <= endDate)
    .reduce((s, r) => s + r.durationMinutes, 0);
  const hours = totalMinutes / 60;
  const aposPerHour = hours > 0 ? totals.totalApo / hours : null;
  const kcRate = safeRatePercent(totals.kcCount, totals.validCalls);
  const apoRate = safeRatePercent(totals.decisionMakerApo, totals.validCalls);
  return {
    totals,
    totalMinutes,
    totalApo: totals.totalApo,
    aposPerHour,
    decisionMakerApo: totals.decisionMakerApo,
    kcRate,
    apoRate,
  };
}

export type InternConfirmedDailyPoint = {
  date: string;
  dayLabel: string;
  confirmedDm: number;
  confirmedNonDm: number;
};

function lastDayOfYearMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const last = new Date(y, m, 0);
  const mm = String(m).padStart(2, "0");
  const dd = String(last.getDate()).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

/** 当月1日〜今日（または月末）のインターン確定数を日別集計 */
export function buildInternConfirmedDailySeries(
  internIds: Set<string>,
  allKpiRecords: KpiRecord[],
  yearMonth: string,
  todayStr: string
): InternConfirmedDailyPoint[] {
  if (internIds.size === 0) return [];
  const start = `${yearMonth}-01`;
  const monthEnd = lastDayOfYearMonth(yearMonth);
  const end = todayStr < monthEnd ? todayStr : monthEnd;
  if (end < start) return [];

  const byDate = new Map<string, { dm: number; ndm: number }>();
  for (const k of allKpiRecords) {
    if (!internIds.has(k.userId) || !k.date.startsWith(yearMonth) || k.date < start || k.date > end) continue;
    const cur = byDate.get(k.date) ?? { dm: 0, ndm: 0 };
    cur.dm += Math.max(0, k.confirmedDecisionMakerApps ?? 0);
    cur.ndm += Math.max(0, k.confirmedNonDecisionMakerApps ?? 0);
    byDate.set(k.date, cur);
  }

  const points: InternConfirmedDailyPoint[] = [];
  let d = start;
  while (d <= end) {
    const agg = byDate.get(d) ?? { dm: 0, ndm: 0 };
    const [, mo, day] = d.split("-");
    points.push({
      date: d,
      dayLabel: `${Number(mo)}/${Number(day)}`,
      confirmedDm: agg.dm,
      confirmedNonDm: agg.ndm,
    });
    d = addCalendarDays(d, 1);
  }
  return points;
}
