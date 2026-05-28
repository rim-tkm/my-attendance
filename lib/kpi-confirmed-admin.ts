import type { KpiRecord } from "@/lib/attendance";
import { KPI_DAY_DEFAULT_START_TIME, getKpiForDate, getKpiForUser, normalizeKpiStartTime } from "@/lib/attendance";

export type ConfirmedAppsPatch = {
  confirmedDecisionMakerApps?: number;
  confirmedNonDecisionMakerApps?: number;
};

function clampNonNegInt(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

/** 管理者：日別の確定数をマージして KPI 行を返す（未存在なら新規行） */
export function buildKpiRecordWithConfirmedPatch(
  allKpiRecords: KpiRecord[],
  userId: string,
  dateYmd: string,
  patch: ConfirmedAppsPatch
): { record: KpiRecord; nextForUser: KpiRecord[] } {
  const userKpi = getKpiForUser(allKpiRecords, userId);
  const existing = getKpiForDate(userKpi, dateYmd);
  const slotStart = normalizeKpiStartTime(existing ?? { startTime: KPI_DAY_DEFAULT_START_TIME });
  const base: KpiRecord = existing ?? {
    id: crypto.randomUUID(),
    userId,
    date: dateYmd,
    startTime: slotStart,
    totalCalls: 0,
    validCalls: 0,
    kcCount: 0,
    followUpCreated: 0,
    decisionMakerApo: 0,
    nonDecisionMakerApo: 0,
    confirmedDecisionMakerApps: 0,
    confirmedNonDecisionMakerApps: 0,
  };
  const record: KpiRecord = {
    ...base,
    confirmedDecisionMakerApps:
      patch.confirmedDecisionMakerApps !== undefined
        ? clampNonNegInt(patch.confirmedDecisionMakerApps)
        : (base.confirmedDecisionMakerApps ?? 0),
    confirmedNonDecisionMakerApps:
      patch.confirmedNonDecisionMakerApps !== undefined
        ? clampNonNegInt(patch.confirmedNonDecisionMakerApps)
        : (base.confirmedNonDecisionMakerApps ?? 0),
  };
  const nextForUser = existing
    ? userKpi.map((r) =>
        r.date === dateYmd && normalizeKpiStartTime(r) === normalizeKpiStartTime(existing) ? record : r
      )
    : [
        record,
        ...userKpi.filter(
          (r) => !(r.date === record.date && normalizeKpiStartTime(r) === normalizeKpiStartTime(record))
        ),
      ];
  return { record, nextForUser };
}
