import type { KpiRecord, Member, OpenRecord, Shift } from "@/lib/attendance";
import {
  earliestPlannedShiftStartMinutes,
  getKpiRates,
  SHIFT_ENTRY_NONE,
} from "@/lib/attendance";

type KpiRatesForSort = ReturnType<typeof getKpiRates>;

/** 管理画面テーブル: 降順 → 昇順 → デフォルト（null） */
export type AdminTableSortState<K extends string = string> = { key: K; dir: "asc" | "desc" } | null;

export function cycleAdminTableSort<K extends string>(
  prev: AdminTableSortState<K>,
  key: K
): AdminTableSortState<K> {
  if (prev == null || prev.key !== key) return { key, dir: "desc" };
  if (prev.dir === "desc") return { key, dir: "asc" };
  return null;
}

export function adminTableSortIcon<K extends string>(
  sort: AdminTableSortState<K>,
  key: K
): "↕" | "↑" | "↓" {
  if (sort == null || sort.key !== key) return "↕";
  return sort.dir === "desc" ? "↓" : "↑";
}

/**
 * 稼働予定管理グリッドの日付列ソート用スコア。
 * 降順: 予定あり（開始が早いほど大きい値内で後ろ…ではなく em を足しているので要整理）
 *
 * 要件「予定あり/なし」: あり > なし > 未登録 を降順で上に。
 * 予定あり同士は開始が早い順を昇順にしたい場合は降順で「遅い方が上」になるので、スコアを反転して並べる。
 * ここでは score が大きいほど「予定が厚い/早い」→ 降順で大きい方が上。
 */
export function shiftScheduleGridDateColumnScore(shift: Shift | undefined | null): number {
  if (!shift) return 0;
  if (shift.startPlanned === SHIFT_ENTRY_NONE || shift.startPlanned === "なし") return 1_000_000;
  const em = earliestPlannedShiftStartMinutes(shift);
  if (em == null || Number.isNaN(em)) return 1_500_000;
  // 2e6 台: あり。開始が早いほど「数値として小さい」→ 降順だと遅い開始が上になるのを避け、早い開始ほど大きいスコアにする
  return 2_000_000 + (24 * 60 - em);
}

export type DailyActualBlockRowForSort = {
  member: Member;
  shift: Shift | null;
  agg: {
    earliestStartIso: string;
    latestEndIso: string;
    breakOrGapMinutes: number;
    totalWorkMinutes: number;
  } | null;
  plannedMinutes: number;
  openOnDate: OpenRecord | null;
};

export type DailyActualSortKey = "name" | "planned" | "start" | "end" | "break" | "work";

function workMinutesForDailyActualSort(r: DailyActualBlockRowForSort): number {
  if (r.agg) return r.agg.totalWorkMinutes;
  if (r.openOnDate) return -1;
  if (r.plannedMinutes > 0) return -2;
  return 0;
}

export function compareDailyActualBlockRows(
  a: DailyActualBlockRowForSort,
  b: DailyActualBlockRowForSort,
  key: DailyActualSortKey,
  desc: boolean
): number {
  const m = desc ? -1 : 1;
  const tie = () => a.member.name.localeCompare(b.member.name, "ja");

  const startMs = (r: DailyActualBlockRowForSort) => {
    if (r.agg?.earliestStartIso) return Date.parse(r.agg.earliestStartIso);
    if (r.openOnDate) return Date.parse(r.openOnDate.startRounded);
    return NaN;
  };
  const endMs = (r: DailyActualBlockRowForSort) => {
    if (r.agg?.latestEndIso) return Date.parse(r.agg.latestEndIso);
    return NaN;
  };

  switch (key) {
    case "name": {
      const c = a.member.name.localeCompare(b.member.name, "ja");
      return m * c;
    }
    case "planned": {
      const ea = earliestPlannedShiftStartMinutes(a.shift);
      const eb = earliestPlannedShiftStartMinutes(b.shift);
      const na = ea != null && !Number.isNaN(ea) ? ea : 99999;
      const nb = eb != null && !Number.isNaN(eb) ? eb : 99999;
      if (na !== nb) return m * (na - nb);
      return tie();
    }
    case "start": {
      const ta = startMs(a);
      const tb = startMs(b);
      const aOk = Number.isFinite(ta);
      const bOk = Number.isFinite(tb);
      if (!aOk && !bOk) return tie();
      if (!aOk) return m * 1;
      if (!bOk) return m * -1;
      if (ta !== tb) return m * (ta - tb);
      return tie();
    }
    case "end": {
      const ta = endMs(a);
      const tb = endMs(b);
      const aOk = Number.isFinite(ta);
      const bOk = Number.isFinite(tb);
      if (!aOk && !bOk) return tie();
      if (!aOk) return m * 1;
      if (!bOk) return m * -1;
      if (ta !== tb) return m * (ta - tb);
      return tie();
    }
    case "break": {
      const ba = a.agg != null && a.agg.breakOrGapMinutes > 0 ? a.agg.breakOrGapMinutes : -1;
      const bb = b.agg != null && b.agg.breakOrGapMinutes > 0 ? b.agg.breakOrGapMinutes : -1;
      if (ba !== bb) return m * (ba - bb);
      return tie();
    }
    case "work": {
      const wa = workMinutesForDailyActualSort(a);
      const wb = workMinutesForDailyActualSort(b);
      if (wa !== wb) return m * (wa - wb);
      return tie();
    }
    default:
      return tie();
  }
}

export type AdminKpiDailySortKey =
  | "name"
  | "totalCalls"
  | "validCalls"
  | "kc"
  | "followUp"
  | "decisionApo"
  | "nonDecisionApo"
  | "validRate"
  | "kcRate"
  | "apoRate";

export function compareAdminKpiDailyRows(
  a: { mem: Member; dayKpi: KpiRecord | undefined; rates: KpiRatesForSort },
  b: { mem: Member; dayKpi: KpiRecord | undefined; rates: KpiRatesForSort },
  key: AdminKpiDailySortKey,
  desc: boolean
): number {
  const m = desc ? -1 : 1;
  const tie = () => a.mem.name.localeCompare(b.mem.name, "ja");

  const num = (x: number | undefined | null, missing: number) =>
    x != null && Number.isFinite(x) ? x : missing;

  switch (key) {
    case "name":
      return m * a.mem.name.localeCompare(b.mem.name, "ja");
    case "totalCalls": {
      const c = num(a.dayKpi?.totalCalls, -1) - num(b.dayKpi?.totalCalls, -1);
      if (c !== 0) return m * c;
      return tie();
    }
    case "validCalls": {
      const c = num(a.dayKpi?.validCalls, -1) - num(b.dayKpi?.validCalls, -1);
      if (c !== 0) return m * c;
      return tie();
    }
    case "kc": {
      const c = num(a.dayKpi?.kcCount, -1) - num(b.dayKpi?.kcCount, -1);
      if (c !== 0) return m * c;
      return tie();
    }
    case "followUp": {
      const c = num(a.dayKpi?.followUpCreated, -1) - num(b.dayKpi?.followUpCreated, -1);
      if (c !== 0) return m * c;
      return tie();
    }
    case "decisionApo": {
      const c = num(a.dayKpi?.decisionMakerApo, -1) - num(b.dayKpi?.decisionMakerApo, -1);
      if (c !== 0) return m * c;
      return tie();
    }
    case "nonDecisionApo": {
      const c = num(a.dayKpi?.nonDecisionMakerApo, -1) - num(b.dayKpi?.nonDecisionMakerApo, -1);
      if (c !== 0) return m * c;
      return tie();
    }
    case "validRate": {
      const c = num(a.rates?.validRate, -1) - num(b.rates?.validRate, -1);
      if (c !== 0) return m * c;
      return tie();
    }
    case "kcRate": {
      const c = num(a.rates?.kcRate, -1) - num(b.rates?.kcRate, -1);
      if (c !== 0) return m * c;
      return tie();
    }
    case "apoRate": {
      const c = num(a.rates?.apoRate, -1) - num(b.rates?.apoRate, -1);
      if (c !== 0) return m * c;
      return tie();
    }
    default:
      return tie();
  }
}
