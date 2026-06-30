import type { KpiRecord, Member, WorkRecord } from "@/lib/attendance";
import {
  DEFAULT_HOURLY_RATE,
  formatDuration,
  getKpiForMonth,
  getKpiForUser,
  getKpiTotalsFromRecords,
  getRecordsForMonth,
  getRecordsForUser,
  safeRatePercent,
  sumBillableMinutesForUserMonth,
} from "@/lib/attendance";
import { calcInvoiceAmounts } from "@/lib/invoice-html";
import { calcMemberMonthlyPayYen, getInternUnitRates, isInternMember, sumInternConfirmedAppsForMonth } from "@/lib/invoice-intern";

/** 印刷レポートの日付表示（app/page.tsx の formatDisplayDate と同じ） */
function formatDisplayDate(dateStr: string): string {
  const parts = dateStr.split("-").map(Number);
  const y = parts[0];
  const mo = parts[1];
  const d = parts[2];
  const date = new Date(y, (mo || 1) - 1, d || 1);
  return date.toLocaleDateString("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

/** HH:mm（app/page.tsx の formatTimeForReport と同じ） */
function formatTimeForReport(iso: string): string {
  const t = new Date(iso);
  return t.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

export type ReportPdfDailyRow = {
  displayDate: string;
  timeRangesText: string;
  apoCount: number;
};

/**
 * 結合 PDF（請求書＋実績報告）の実績ページ用モデル。
 * `概算委託料` は結合 HTML と同様に請求の税込合計（totalWithTax）を表示する。
 */
export type ReportPdfModel = {
  memberName: string;
  monthLabel: string;
  hourlyRate: number;
  totalMinutes: number;
  workDays: number;
  isIntern: boolean;
  internRateDecisionMaker?: number;
  internRateNonDecisionMaker?: number;
  confirmedDecisionCount?: number;
  confirmedNonDecisionCount?: number;
  /** 請求書の税込合計（結合印刷 HTML と同一） */
  grossPayTaxInclusive: number;
  totalCalls: number;
  validCalls: number;
  kcCount: number;
  decisionMakerApo: number;
  validRate: number | null;
  kcRate: number | null;
  apoRate: number | null;
  dailyRows: ReportPdfDailyRow[];
};

export function buildReportPdfModelForMember(
  member: Member,
  yearMonth: string,
  allRecords: WorkRecord[],
  allKpiRecords: KpiRecord[]
): ReportPdfModel {
  const userId = member.id;
  const userRecords = getRecordsForMonth(getRecordsForUser(allRecords, userId), yearMonth);
  const userKpi = getKpiForMonth(getKpiForUser(allKpiRecords, userId), yearMonth);
  const totalMinutes = sumBillableMinutesForUserMonth(allRecords, userId, yearMonth);
  const workDays = new Set(userRecords.map((r) => r.date)).size;
  const intern = isInternMember(member);
  const hourlyRate = intern ? 0 : member.hourlyRate != null ? member.hourlyRate : DEFAULT_HOURLY_RATE;
  const grossPayTaxInclusive = intern
    ? calcMemberMonthlyPayYen(member, totalMinutes, allKpiRecords, yearMonth, DEFAULT_HOURLY_RATE)
    : calcInvoiceAmounts(totalMinutes, hourlyRate).totalWithTax;
  const internTotals = intern ? sumInternConfirmedAppsForMonth(allKpiRecords, userId, yearMonth) : null;
  const internRates = intern ? getInternUnitRates(member) : null;
  const kpiTotals = getKpiTotalsFromRecords(userKpi);
  const validRate = safeRatePercent(kpiTotals.validCalls, kpiTotals.totalCalls);
  const kcRate = safeRatePercent(kpiTotals.kcCount, kpiTotals.validCalls);
  const apoRate = safeRatePercent(kpiTotals.decisionMakerApo, kpiTotals.kcCount);
  const dateToKpi = new Map(userKpi.map((k) => [k.date, k]));
  const allDates = new Set<string>([...userRecords.map((r) => r.date), ...userKpi.map((k) => k.date)]);
  const sortedDates = Array.from(allDates).sort();
  const dailyRows: ReportPdfDailyRow[] = sortedDates.map((date) => {
    const dayRecords = userRecords.filter((r) => r.date === date);
    const timeRanges = dayRecords.map(
      (r) => `${formatTimeForReport(r.startRounded)}-${formatTimeForReport(r.endRounded)}`
    );
    const k = dateToKpi.get(date);
    const apoCount = k ? k.decisionMakerApo + k.nonDecisionMakerApo : 0;
    return {
      displayDate: formatDisplayDate(date),
      timeRangesText: timeRanges.join(" / "),
      apoCount,
    };
  });
  const [y, m] = yearMonth.split("-");
  const monthLabel = `${y}年${m}月`;
  return {
    memberName: member.name,
    monthLabel,
    hourlyRate,
    totalMinutes,
    workDays,
    isIntern: intern,
    internRateDecisionMaker: internRates?.decisionMaker,
    internRateNonDecisionMaker: internRates?.nonDecisionMaker,
    confirmedDecisionCount: internTotals?.decisionCount,
    confirmedNonDecisionCount: internTotals?.nonDecisionCount,
    grossPayTaxInclusive,
    totalCalls: kpiTotals.totalCalls,
    validCalls: kpiTotals.validCalls,
    kcCount: kpiTotals.kcCount,
    decisionMakerApo: kpiTotals.decisionMakerApo,
    validRate,
    kcRate,
    apoRate,
    dailyRows,
  };
}

export function formatDurationForReport(totalMinutes: number): string {
  return formatDuration(totalMinutes);
}
