import type { KpiRecord, Member } from "@/lib/attendance";
import { getKpiForMonth, getKpiForUser } from "@/lib/attendance";

/** インターン成果報酬：決裁者商談確定（税込単価・円/件） */
export const INTERN_RATE_DECISION_MAKER_APPS = 2000;
/** インターン成果報酬：非決裁者商談確定（税込単価・円/件） */
export const INTERN_RATE_NON_DECISION_MAKER_APPS = 500;

export type InternConfirmedMonthTotals = {
  decisionCount: number;
  nonDecisionCount: number;
};

export function sumInternConfirmedAppsForMonth(
  allKpiRecords: KpiRecord[],
  userId: string,
  yearMonth: string
): InternConfirmedMonthTotals {
  const monthRows = getKpiForMonth(getKpiForUser(allKpiRecords, userId), yearMonth);
  return {
    decisionCount: monthRows.reduce((s, k) => s + Math.max(0, k.confirmedDecisionMakerApps ?? 0), 0),
    nonDecisionCount: monthRows.reduce((s, k) => s + Math.max(0, k.confirmedNonDecisionMakerApps ?? 0), 0),
  };
}

/** 行ごと税込→税抜・消費税（請求書 PDF と同一の端数処理） */
export function splitTaxInclusiveLineAmount(taxInclusive: number): { subtotal: number; tax: number; total: number } {
  const total = Math.max(0, Math.round(taxInclusive));
  const subtotal = Math.floor(total / 1.1);
  const tax = total - subtotal;
  return { subtotal, tax, total };
}

export type InternUnitRates = {
  decisionMaker: number;
  nonDecisionMaker: number;
};

export function getInternUnitRates(
  member: Pick<Member, "internRateDecisionMakerApps" | "internRateNonDecisionMakerApps">
): InternUnitRates {
  const dm = member.internRateDecisionMakerApps;
  const ndm = member.internRateNonDecisionMakerApps;
  return {
    decisionMaker:
      typeof dm === "number" && Number.isFinite(dm) && dm >= 0 ? Math.floor(dm) : INTERN_RATE_DECISION_MAKER_APPS,
    nonDecisionMaker:
      typeof ndm === "number" && Number.isFinite(ndm) && ndm >= 0
        ? Math.floor(ndm)
        : INTERN_RATE_NON_DECISION_MAKER_APPS,
  };
}

export function calcInternInvoiceAmounts(
  totals: InternConfirmedMonthTotals,
  rates: InternUnitRates = {
    decisionMaker: INTERN_RATE_DECISION_MAKER_APPS,
    nonDecisionMaker: INTERN_RATE_NON_DECISION_MAKER_APPS,
  }
): {
  totalWithTax: number;
  subtotal: number;
  taxRate: number;
  decisionAmount: number;
  nonDecisionAmount: number;
} {
  const decisionAmount = totals.decisionCount * rates.decisionMaker;
  const nonDecisionAmount = totals.nonDecisionCount * rates.nonDecisionMaker;
  const totalWithTax = decisionAmount + nonDecisionAmount;
  const subtotal = Math.floor(totalWithTax / 1.1);
  const taxRate = totalWithTax - subtotal;
  return { totalWithTax, subtotal, taxRate, decisionAmount, nonDecisionAmount };
}

export function isInternMember(member: Pick<Member, "isIntern">): boolean {
  return member.isIntern === true;
}

export function calcMemberMonthlyPayYen(
  member: Member,
  totalMinutes: number,
  allKpiRecords: KpiRecord[],
  yearMonth: string,
  hourlyRateFallback: number
): number {
  if (isInternMember(member)) {
    const totals = sumInternConfirmedAppsForMonth(allKpiRecords, member.id, yearMonth);
    return calcInternInvoiceAmounts(totals, getInternUnitRates(member)).totalWithTax;
  }
  const rate = member.hourlyRate != null ? member.hourlyRate : hourlyRateFallback;
  if (!Number.isFinite(totalMinutes) || !Number.isFinite(rate) || rate < 0) return 0;
  return Math.floor((totalMinutes / 60) * rate);
}
