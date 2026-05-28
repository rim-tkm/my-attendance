import type { KpiRecord, OpenRecord, Shift, WorkRecord } from "@/lib/attendance";
import {
  SHIFT_ENTRY_NONE,
  aggregateUserWorkDaySpan,
  getRecordsForUser,
  getTotalMinutesForDate,
  kpiRecordHasOperationalMetrics,
} from "@/lib/attendance";

/** 請求・一覧用: 分 → 時間ラベル（整数なら整数、それ以外は小数1桁） */
export function formatAttendanceHoursLabel(totalMinutes: number): string {
  const h = totalMinutes / 60;
  return h % 1 === 0 ? String(h) : h.toFixed(1);
}

function formatIsoJaHm(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

export type UserDayLaborSignals = {
  completedMinutes: number;
  span: ReturnType<typeof aggregateUserWorkDaySpan>;
  openOnDate: OpenRecord | null;
};

export function getUserDayLaborSignals(
  allRecords: WorkRecord[],
  allOpenRecords: OpenRecord[],
  userId: string,
  dateStr: string
): UserDayLaborSignals {
  const userRecs = getRecordsForUser(allRecords, userId);
  const completedMinutes = getTotalMinutesForDate(userRecs, dateStr);
  const span = aggregateUserWorkDaySpan(allRecords, userId, dateStr);
  const openOnDate = allOpenRecords.find((o) => o.userId === userId && o.date === dateStr) ?? null;
  return { completedMinutes, span, openOnDate };
}

export function dayHasLaborOrOpen(signals: UserDayLaborSignals): boolean {
  return signals.completedMinutes > 0 || signals.openOnDate != null;
}

/**
 * 稼働予定管理グリッド等の 1 行目。
 * 完了した打刻（attendance）または当日の未終了打刻（open_records）があれば、shifts より優先して表示する。
 */
export function formatAdminShiftSchedulePrimaryLine(
  shift: Shift | undefined,
  signals: UserDayLaborSignals
): string {
  if (signals.completedMinutes > 0) {
    if (signals.span) {
      const a = formatIsoJaHm(signals.span.earliestStartIso);
      const b = formatIsoJaHm(signals.span.latestEndIso);
      return `打刻 ${a}–${b}`;
    }
    return `打刻あり（${formatAttendanceHoursLabel(signals.completedMinutes)}h）`;
  }
  if (signals.openOnDate) {
    return `打刻中（開始 ${formatIsoJaHm(signals.openOnDate.startRounded)}）`;
  }
  if (!shift) return "未登録";
  if (shift.startPlanned === SHIFT_ENTRY_NONE) return "稼働予定なし";
  let t = `${shift.startPlanned}～${shift.endPlanned}`;
  if (shift.startPlanned2 && shift.endPlanned2 && shift.startPlanned2.trim() && shift.endPlanned2.trim()) {
    t += ` ／ ${shift.startPlanned2}～${shift.endPlanned2}`;
  }
  return t;
}

/** 稼働予定管理グリッドの 2 行目（実績サマリ）。打刻ベースを KPI より優先する。 */
export function formatAdminShiftScheduleSecondaryLine(
  kpi: KpiRecord | undefined,
  signals: UserDayLaborSignals
): { text: string; highlight: boolean } {
  const hasKpi = kpiRecordHasOperationalMetrics(kpi);
  if (signals.completedMinutes > 0) {
    return {
      text: `実績 ${formatAttendanceHoursLabel(signals.completedMinutes)}h`,
      highlight: true,
    };
  }
  if (signals.openOnDate) {
    return { text: "実績 集計中（終了打刻待ち）", highlight: true };
  }
  if (hasKpi) {
    return {
      text: `実績 ${formatAttendanceHoursLabel(signals.completedMinutes)}h`,
      highlight: true,
    };
  }
  return { text: "実績 未入力", highlight: false };
}
