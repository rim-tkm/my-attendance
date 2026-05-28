import type { OpenRecord, Shift, WorkRecord } from "@/lib/attendance";
import {
  SHIFT_ENTRY_NONE,
  canonicalShiftForUserDate,
  earliestPlannedShiftStartMinutes,
  formatYmdJst,
  WORK_DURATION_EXCEEDS_24H_MESSAGE,
  WORK_DURATION_HARD_MAX_MINUTES,
} from "@/lib/attendance";
import { getTodayJstDateString, isWeekendYmdJst, JST_WEEKEND_WORK_REJECTED_MESSAGE } from "@/lib/export-schedule";

export const PUNCH_OUTSIDE_WINDOW_MESSAGE = "打刻は9:45〜21:15の間のみ可能です";
export const PUNCH_DEADLINE_PASSED_MESSAGE =
  "打刻期限を過ぎました。管理者に連絡して時間を報告してください";

/** 業務開始打刻: 当日の最も早い稼働予定開始のこの分だけ前から許可 */
export const PUNCH_START_LEAD_MINUTES_BEFORE_PLANNED = 60;

/** 業務開始打刻: 当日の最も早い稼働予定開始のこの分だけ後まで許可 */
export const PUNCH_START_LAG_MINUTES_AFTER_PLANNED = 60;

/** 予定に基づく開始打刻がまだ早いとき（UI 案内・API エラーで共通） */
export const PUNCH_START_BEFORE_PLANNED_MESSAGE = "稼働開始は予定時刻の1時間前から可能です";

/** 予定に基づく開始打刻が遅すぎるとき（UI 案内・API エラーで共通） */
export const PUNCH_START_AFTER_PLANNED_MESSAGE =
  "稼働開始は予定時刻の1時間後まで可能です。管理者に連絡してください";

const WINDOW_START_MIN = 9 * 60 + 45;
const WINDOW_END_MIN = 21 * 60 + 15;
const GRACE_MS = 15 * 60 * 1000;

function isNoneLike(v: string): boolean {
  const t = v.trim();
  return t === "" || t === SHIFT_ENTRY_NONE || t === "なし";
}

function isConcretePlannedSlot(start: string, end: string): boolean {
  return !isNoneLike(start) && !isNoneLike(end);
}

/** JST 暦日 ymd の hh:mm が指す瞬間の epoch ms（+09:00） */
export function jstYmdHhmmToUtcMs(ymd: string, hhmm: string): number | null {
  const t = hhmm.trim();
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(min) || hh < 0 || hh > 23 || min < 0 || min > 59) return null;
  const iso = `${ymd}T${String(hh).padStart(2, "0")}:${String(min).padStart(2, "0")}:00+09:00`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export function getJstMinutesSinceMidnight(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "NaN");
  const min = Number(parts.find((p) => p.type === "minute")?.value ?? "NaN");
  if (!Number.isFinite(h) || !Number.isFinite(min)) return -1;
  return h * 60 + min;
}

export function isWithinDailyPunchClockWindowJst(at: Date): boolean {
  const mins = getJstMinutesSinceMidnight(at);
  if (mins < 0) return false;
  return mins >= WINDOW_START_MIN && mins <= WINDOW_END_MIN;
}

/**
 * 業務開始打刻が許可される JST の「その日 0:00 からの分」（下限）。
 * - 具体の稼働予定がある: max(9:45, 最速枠の開始 − 60分)
 * - 予定なし・枠なし: 9:45
 */
export function getMemberStartPunchEarliestJstMinutesSinceMidnight(shift: Shift | undefined | null): number {
  const earliestPlan = earliestPlannedShiftStartMinutes(shift ?? undefined);
  if (earliestPlan == null || !Number.isFinite(earliestPlan)) {
    return WINDOW_START_MIN;
  }
  return Math.max(WINDOW_START_MIN, earliestPlan - PUNCH_START_LEAD_MINUTES_BEFORE_PLANNED);
}

/**
 * 業務開始打刻が許可される JST の「その日 0:00 からの分」（上限）。
 * 具体の稼働予定があるときのみ min(21:15, 最速枠の開始 + 60分)。予定なしは null（日次上限のみ）。
 */
export function getMemberStartPunchLatestJstMinutesSinceMidnight(shift: Shift | undefined | null): number | null {
  const earliestPlan = earliestPlannedShiftStartMinutes(shift ?? undefined);
  if (earliestPlan == null || !Number.isFinite(earliestPlan)) {
    return null;
  }
  return Math.min(WINDOW_END_MIN, earliestPlan + PUNCH_START_LAG_MINUTES_AFTER_PLANNED);
}

/** 現在時刻が「予定に基づく業務開始打刻」ウィンドウ内か（当日 JST の分で比較） */
export function isMemberStartPunchAllowedByPlannedWorkJst(now: Date, shift: Shift | undefined | null): boolean {
  const m = getJstMinutesSinceMidnight(now);
  if (m < 0) return false;
  if (m < getMemberStartPunchEarliestJstMinutesSinceMidnight(shift)) return false;
  const latest = getMemberStartPunchLatestJstMinutesSinceMidnight(shift);
  if (latest != null && m > latest) return false;
  return true;
}

export function assertMemberStartPunchAllowedByPlannedWork(now: Date, shift: Shift | undefined | null): void {
  const m = getJstMinutesSinceMidnight(now);
  if (m < 0) throw new Error(PUNCH_OUTSIDE_WINDOW_MESSAGE);
  if (m < getMemberStartPunchEarliestJstMinutesSinceMidnight(shift)) {
    throw new Error(PUNCH_START_BEFORE_PLANNED_MESSAGE);
  }
  const latest = getMemberStartPunchLatestJstMinutesSinceMidnight(shift);
  if (latest != null && m > latest) {
    throw new Error(PUNCH_START_AFTER_PLANNED_MESSAGE);
  }
}

function slotEndMs(ymd: string, start: string, end: string): number | null {
  const startMs = jstYmdHhmmToUtcMs(ymd, start);
  const endMs0 = jstYmdHhmmToUtcMs(ymd, end);
  if (startMs == null || endMs0 == null) return null;
  if (endMs0 === startMs) return null;
  let endMs = endMs0;
  if (endMs < startMs) endMs += 24 * 60 * 60 * 1000;
  return endMs;
}

export function getLatestConcretePlanEndMs(dateYmd: string, shift: Shift | undefined): number | null {
  if (!shift) return null;
  let last: number | null = null;
  if (isConcretePlannedSlot(shift.startPlanned, shift.endPlanned)) {
    last = slotEndMs(dateYmd, shift.startPlanned, shift.endPlanned);
  }
  const sp2 = shift.startPlanned2 ?? "";
  const ep2 = shift.endPlanned2 ?? "";
  if (isConcretePlannedSlot(sp2, ep2)) {
    const e2 = slotEndMs(dateYmd, sp2, ep2);
    if (e2 != null) last = last == null ? e2 : Math.max(last, e2);
  }
  return last;
}

/**
 * 本人の「終了打刻」として許容される最終瞬間（ms、境界を含む）。
 * min(当日 JST 21:15, 最遅の予定終了+15分)。実予定が無い場合は 21:15。
 */
export function getMemberEndPunchDeadlineMs(
  dateYmd: string,
  shift: Shift | undefined,
  graceMs: number = GRACE_MS
): number {
  const windowEnd = jstYmdHhmmToUtcMs(dateYmd, "21:15");
  if (windowEnd == null) return Number.POSITIVE_INFINITY;
  const planEnd = getLatestConcretePlanEndMs(dateYmd, shift);
  const planDeadline = planEnd == null ? Number.POSITIVE_INFINITY : planEnd + graceMs;
  return Math.min(windowEnd, planDeadline);
}

export function isMemberEndPunchLockedByPlanAt(now: Date, dateYmd: string, shift: Shift | undefined): boolean {
  if (isWeekendYmdJst(dateYmd)) return true;
  return now.getTime() > getMemberEndPunchDeadlineMs(dateYmd, shift);
}

export function assertMemberOpenRecordPunchAllowed(
  open: OpenRecord,
  now: Date,
  shiftForWorkDate: Shift | undefined
): void {
  if (isWeekendYmdJst(open.date)) throw new Error(JST_WEEKEND_WORK_REJECTED_MESSAGE);
  const today = getTodayJstDateString(now);
  if (open.date !== today) throw new Error(PUNCH_OUTSIDE_WINDOW_MESSAGE);
  if (!isWithinDailyPunchClockWindowJst(now)) throw new Error(PUNCH_OUTSIDE_WINDOW_MESSAGE);
  if (!isWithinDailyPunchClockWindowJst(new Date(open.startRaw))) throw new Error(PUNCH_OUTSIDE_WINDOW_MESSAGE);
  assertMemberStartPunchAllowedByPlannedWork(now, shiftForWorkDate);
}

function assertMemberCompletedTodayWorkRecord(
  rec: WorkRecord,
  shift: Shift | undefined,
  now: Date
): void {
  if (isWeekendYmdJst(rec.date)) throw new Error(JST_WEEKEND_WORK_REJECTED_MESSAGE);
  const today = getTodayJstDateString(now);
  if (rec.date !== today) return;
  if (rec.isAutoCompleted === true) return;

  const startAt = new Date(rec.startRaw);
  const endAt = new Date(rec.endRaw);
  if (!isWithinDailyPunchClockWindowJst(startAt)) throw new Error(PUNCH_OUTSIDE_WINDOW_MESSAGE);
  if (!isWithinDailyPunchClockWindowJst(endAt)) throw new Error(PUNCH_OUTSIDE_WINDOW_MESSAGE);
  if (!isWithinDailyPunchClockWindowJst(now)) throw new Error(PUNCH_OUTSIDE_WINDOW_MESSAGE);
  if (formatYmdJst(startAt) !== rec.date || formatYmdJst(endAt) !== rec.date) {
    throw new Error("開始・終了は同一稼働日（日本時間）の範囲にしてください");
  }
  if (rec.durationMinutes <= 0) {
    throw new Error("稼働時間が0分の記録は保存できません");
  }
  if (rec.durationMinutes > WORK_DURATION_HARD_MAX_MINUTES) {
    throw new Error(WORK_DURATION_EXCEEDS_24H_MESSAGE);
  }

  const deadlineMs = getMemberEndPunchDeadlineMs(rec.date, shift);
  if (endAt.getTime() > deadlineMs) throw new Error(PUNCH_DEADLINE_PASSED_MESSAGE);
  if (now.getTime() > deadlineMs) throw new Error(PUNCH_DEADLINE_PASSED_MESSAGE);
}

/** 本人保存経路: 当日分の完了レコードに打刻ウィンドウ・予定終了+15分を適用 */
export function assertMemberWorkRecordsForTodayPunch(
  userId: string,
  userRecords: WorkRecord[],
  allShifts: Shift[],
  now: Date
): void {
  const today = getTodayJstDateString(now);
  const shift = canonicalShiftForUserDate(allShifts, userId, today);
  for (const r of userRecords) {
    if (r.userId !== userId) continue;
    assertMemberCompletedTodayWorkRecord(r, shift ?? undefined, now);
  }
}
