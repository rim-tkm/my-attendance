import type { OpenRecord, Shift, WorkRecord, KpiRecord, Member } from "@/lib/attendance";
import {
  calcDurationMinutes,
  canonicalShiftForUserDate,
  earliestPlannedShiftStartMinutes,
  formatShiftPlannedTimeRanges,
  getKpiForDate,
  getKpiForUser,
  getRecordsForUserAndDate,
  getShiftPlannedMinutes,
  kpiRecordHasOperationalMetrics,
  latestPlannedShiftEndMinutes,
  shiftHasConcretePrimaryPlanned,
  SHIFT_ENTRY_NONE,
} from "@/lib/attendance";
import { getJstClockMinutesSinceMidnight, getTodayJstDateString } from "@/lib/export-schedule";
import { isInternMember } from "@/lib/invoice-intern";
import { normalizeRoiRange } from "@/lib/roi-analysis";

/** この分差以上なら「時間乖離」とみなす（稼働乖離アラートと同水準） */
export const PLAN_ACTUAL_TIME_TOLERANCE_MIN = 15;
/** この分差以上、または実績ゼロは強調（赤字）表示用 */
export const PLAN_ACTUAL_LARGE_GAP_MIN = 60;

/** 予実乖離アーカイブの承認キー（Supabase・UI で共通） */
export function planActualGapApprovalKey(userId: string, date: string): string {
  return `${userId}\t${date}`;
}

/** 予実乖離の対象メンバー（時給制の業務委託のみ。管理者・インターンは除外） */
export function isPlanActualGapEligibleMember(
  member: Pick<Member, "isActive" | "loginAccount" | "isIntern">
): boolean {
  return (
    member.isActive !== false &&
    (member.loginAccount ?? "").trim().toLowerCase() !== "admin" &&
    !isInternMember(member)
  );
}

/** 稼働予定の実枠（枠1・枠2）を { start, end } の配列で返す */
export function getConcretePlannedSlots(shift: Shift): { start: string; end: string }[] {
  const slots: { start: string; end: string }[] = [];
  if (shiftHasConcretePrimaryPlanned(shift)) {
    slots.push({ start: shift.startPlanned, end: shift.endPlanned });
  }
  const sp2 = (shift.startPlanned2 ?? "").trim();
  const ep2 = (shift.endPlanned2 ?? "").trim();
  if (
    sp2 !== "" &&
    sp2 !== SHIFT_ENTRY_NONE &&
    sp2 !== "なし" &&
    ep2 !== "" &&
    ep2 !== SHIFT_ENTRY_NONE &&
    ep2 !== "なし"
  ) {
    slots.push({ start: sp2, end: ep2 });
  }
  return slots;
}

export type PlanActualGapRow = {
  date: string;
  userId: string;
  memberName: string;
  plannedMinutes: number;
  actualMinutes: number;
  /** 実績 − 予定（分） */
  diffMinutes: number;
  plannedTimeLabel: string;
  kpiMissing: boolean;
  timeMismatch: boolean;
  /** 実績なし、または乖離が LARGE_GAP 以上 */
  severeTime: boolean;
  /** 終了予定＋許容時間を過ぎているが未終了打刻がある */
  missingEndPunchAfterPlannedEnd?: boolean;
};

export type BuildPlanActualGapRowsOptions = {
  /** 既定は `new Date()`。テストやサーバー側で固定したいとき指定 */
  now?: Date;
  /** 当日の終了予定超過チェック・過去日の未終了打刻検出に使用 */
  openRecords?: Pick<OpenRecord, "userId" | "date">[];
};

/** shifts / attendance / kpis に現れる最古の日付（フォールバック付き） */
export function earliestPlanActualDataDate(
  shifts: Shift[],
  records: WorkRecord[],
  kpis: KpiRecord[],
  fallback: string
): string {
  const dates: string[] = [];
  shifts.forEach((s) => dates.push(s.date));
  records.forEach((r) => dates.push(r.date));
  kpis.forEach((k) => dates.push(k.date));
  if (dates.length === 0) return fallback;
  return dates.sort()[0];
}

/**
 * 予定（shifts の稼働分数）と実績（活動記録の合計分）、KPI 入力有無を突き合わせ、
 * 「時間乖離」または「KPI 未入力」の行だけ返す。
 *
 * - **未来の暦日**は対象外（その日が来るまで乖離として扱わない）。
 * - **当日（JST）**は、最も早い稼働開始予定を過ぎるまで時間・KPI の乖離として出さない（まだ「これから出勤」の枠を除外）。
 * - **当日**かつ終了予定＋許容を過ぎているのに未終了打刻がある場合も乖離に含める。
 * - **インターン**（成果報酬型・打刻管理対象外）は `is_intern: true` のメンバーを常に除外する。
 */
export function buildPlanActualGapRows(
  members: Member[],
  shifts: Shift[],
  records: WorkRecord[],
  kpis: KpiRecord[],
  rangeStart: string,
  rangeEnd: string,
  options?: BuildPlanActualGapRowsOptions
): PlanActualGapRow[] {
  const now = options?.now ?? new Date();
  const openRefs = options?.openRecords ?? [];
  const todayJst = getTodayJstDateString(now);
  const clockMin = getJstClockMinutesSinceMidnight(now);

  const { start, end } = normalizeRoiRange(rangeStart, rangeEnd);
  const nameById = new Map(members.map((m) => [m.id, (m.name ?? "").trim() || "（名前なし）"]));
  const activeContractors = new Set(
    members.filter(isPlanActualGapEligibleMember).map((m) => m.id)
  );

  const keySet = new Set<string>();
  for (const s of shifts) {
    if (s.date < start || s.date > end) continue;
    if (s.date > todayJst) continue;
    if (!activeContractors.has(s.userId)) continue;
    if (getShiftPlannedMinutes(s) <= 0) continue;
    keySet.add(`${s.userId}\t${s.date}`);
  }

  const rows: PlanActualGapRow[] = [];
  Array.from(keySet).forEach((key) => {
    const tab = key.indexOf("\t");
    const userId = key.slice(0, tab);
    const date = key.slice(tab + 1);

    const shift = canonicalShiftForUserDate(shifts, userId, date);
    if (!shift) return;
    const planned = getShiftPlannedMinutes(shift);
    if (planned <= 0) return;

    const startMin = earliestPlannedShiftStartMinutes(shift);
    const endMin = latestPlannedShiftEndMinutes(shift);

    if (date === todayJst && startMin != null && clockMin < startMin) {
      return;
    }

    const openForDay = openRefs.some((o) => o.userId === userId && o.date === date);
    let missingEndPunchAfterPlannedEnd = false;
    if (openForDay && endMin != null) {
      if (date < todayJst) {
        missingEndPunchAfterPlannedEnd = true;
      } else if (date === todayJst && clockMin >= endMin + PLAN_ACTUAL_TIME_TOLERANCE_MIN) {
        missingEndPunchAfterPlannedEnd = true;
      }
    }

    /** 予定（シフトの枠の長さ）と比較する実績は、活動記録の開始〜終了の壁時計幅の合計（休憩は別欄のため duration ではなく span を使う） */
    const dayRecs = getRecordsForUserAndDate(records, userId, date);
    const actual = dayRecs.reduce(
      (s, r) => s + calcDurationMinutes(new Date(r.startRounded), new Date(r.endRounded)),
      0
    );
    const diff = actual - planned;
    const k = getKpiForDate(getKpiForUser(kpis, userId), date);
    const kpiMissing = !kpiRecordHasOperationalMetrics(k);

    const baseTimeMismatch =
      (planned > 0 && actual === 0) || Math.abs(diff) >= PLAN_ACTUAL_TIME_TOLERANCE_MIN;
    const timeMismatch = baseTimeMismatch || missingEndPunchAfterPlannedEnd;
    const severeTime =
      (planned > 0 && actual === 0) ||
      Math.abs(diff) >= PLAN_ACTUAL_LARGE_GAP_MIN ||
      missingEndPunchAfterPlannedEnd;

    if (!timeMismatch && !kpiMissing) return;

    const plannedTimeLabel = formatShiftPlannedTimeRanges(shift) ?? "—";
    rows.push({
      date,
      userId,
      memberName: nameById.get(userId) ?? "（不明）",
      plannedMinutes: planned,
      actualMinutes: actual,
      diffMinutes: diff,
      plannedTimeLabel,
      kpiMissing,
      timeMismatch,
      severeTime,
      ...(missingEndPunchAfterPlannedEnd ? { missingEndPunchAfterPlannedEnd: true } : {}),
    });
  });

  rows.sort((a, b) => {
    const c = b.date.localeCompare(a.date);
    if (c !== 0) return c;
    return a.memberName.localeCompare(b.memberName, "ja");
  });
  return rows;
}

/** `buildPlanActualGapRows` の別名（通知・バッチでの利用向け） */
export function getPlanActualGap(
  members: Member[],
  shifts: Shift[],
  records: WorkRecord[],
  kpis: KpiRecord[],
  rangeStart: string,
  rangeEnd: string,
  options?: BuildPlanActualGapRowsOptions
): PlanActualGapRow[] {
  return buildPlanActualGapRows(members, shifts, records, kpis, rangeStart, rangeEnd, options);
}

export function filterPlanActualGapRows(rows: PlanActualGapRow[], search: string): PlanActualGapRow[] {
  const q = search.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) =>
      r.memberName.toLowerCase().includes(q) ||
      r.date.includes(q) ||
      r.date.replace(/-/g, "").includes(q)
  );
}

function csvEscapeCell(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${String(v).replace(/"/g, '""')}"`;
  return v;
}

/** フィルター済み行をそのまま CSV（先頭 BOM） */
export function buildPlanActualGapCsv(rows: PlanActualGapRow[]): string {
  const header = [
    "日付",
    "氏名",
    "予定分数",
    "実績分数",
    "乖離分数_実績マイナス予定",
    "予定枠",
    "KPI",
    "時間乖離フラグ",
    "備考",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const notes: string[] = [];
    if (r.missingEndPunchAfterPlannedEnd) notes.push("終了予定超過・未終了打刻");
    else if (r.plannedMinutes > 0 && r.actualMinutes === 0) notes.push("実績なし");
    if (r.timeMismatch && !(r.plannedMinutes > 0 && r.actualMinutes === 0) && !r.missingEndPunchAfterPlannedEnd)
      notes.push("予実時間差");
    if (r.kpiMissing) notes.push("KPI未入力");
    lines.push(
      [
        csvEscapeCell(r.date),
        csvEscapeCell(r.memberName),
        String(r.plannedMinutes),
        String(r.actualMinutes),
        String(r.diffMinutes),
        csvEscapeCell(r.plannedTimeLabel),
        r.kpiMissing ? "未入力" : "入力あり",
        r.timeMismatch ? "あり" : "なし",
        csvEscapeCell(notes.join("・")),
      ].join(",")
    );
  }
  return "\uFEFF" + lines.join("\r\n");
}
