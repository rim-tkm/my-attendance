import type { KpiRecord, Shift, WorkRecord } from "@/lib/attendance";
import {
  buildAdminExactWorkRecord,
  buildWorkRecordFromHhmmOnDate,
  canonicalShiftForUserDate,
  getKpiForDate,
  getKpiForUser,
  getRecordsForUser,
  getRecordsForUserAndDate,
  getTotalMinutesForDate,
  SHIFT_ENTRY_NONE,
  timeToMinutes,
} from "@/lib/attendance";
import { logAttendanceAdminManualOverrideHistory } from "@/lib/data-change-history";
import type { PlanActualGapResolution } from "@/lib/supabase-data";
import { isWeekendYmdJst, JST_WEEKEND_WORK_REJECTED_MESSAGE } from "@/lib/export-schedule";
import { getConcretePlannedSlots } from "@/lib/plan-actual-gap";
import {
  deleteAttendanceRecordById,
  loadKpi,
  loadOpenRecords,
  loadRecords,
  loadShifts,
  saveOpenRecords,
  savePlanActualGapResolution,
  saveRecordsForUser,
  saveShifts,
  updateShiftPlannedSlotsById,
} from "@/lib/supabase-data";

/** attendance の ISO を日本時間の HH:mm に変換（シフト表の壁時計と一致させる） */
function isoToJstHhmm(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "0";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "0";
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function minutesToHhmm(total: number): string {
  const capped = Math.min(Math.max(0, total), 23 * 60 + 45);
  const h = Math.floor(capped / 60);
  const m = capped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function workRecordToHistoryJson(r: WorkRecord): Record<string, unknown> {
  return {
    id: r.id,
    user_id: r.userId,
    date: r.date,
    start_raw: r.startRaw,
    start_rounded: r.startRounded,
    end_raw: r.endRaw,
    end_rounded: r.endRounded,
    duration_minutes: r.durationMinutes,
    is_auto_completed: r.isAutoCompleted ?? false,
  };
}

function kpiToHistoryJson(k: KpiRecord): Record<string, unknown> {
  return {
    id: k.id,
    user_id: k.userId,
    date: k.date,
    total_calls: k.totalCalls,
    valid_calls: k.validCalls,
    kc_count: k.kcCount,
    follow_up_created: k.followUpCreated,
    decision_maker_apo: k.decisionMakerApo,
    non_decision_maker_apo: k.nonDecisionMakerApo,
  };
}

/**
 * 実績レコードから、その日の予定枠を上書きする値を組み立てる。
 * 枠は最大2つ。3件以上の実績は開始時刻＋実働合計分で1枠にまとめる。
 */
function shiftPatchFromActualRecords(dayRecs: WorkRecord[]): {
  startPlanned: string;
  endPlanned: string;
  startPlanned2: string | null;
  endPlanned2: string | null;
} | null {
  const sorted = [...dayRecs].sort((a, b) => a.startRounded.localeCompare(b.startRounded));
  if (sorted.length === 0) return null;
  if (sorted.length === 1) {
    const r = sorted[0];
    return {
      startPlanned: isoToJstHhmm(r.startRounded),
      endPlanned: isoToJstHhmm(r.endRounded),
      startPlanned2: null,
      endPlanned2: null,
    };
  }
  if (sorted.length === 2) {
    const [a, b] = sorted;
    return {
      startPlanned: isoToJstHhmm(a.startRounded),
      endPlanned: isoToJstHhmm(a.endRounded),
      startPlanned2: isoToJstHhmm(b.startRounded),
      endPlanned2: isoToJstHhmm(b.endRounded),
    };
  }
  const first = sorted[0];
  const startHhmm = isoToJstHhmm(first.startRounded);
  const startM = timeToMinutes(startHhmm);
  const totalDur = sorted.reduce((s, r) => s + r.durationMinutes, 0);
  const endHhmm = minutesToHhmm(startM + totalDur);
  return {
    startPlanned: startHhmm,
    endPlanned: endHhmm,
    startPlanned2: null,
    endPlanned2: null,
  };
}

/**
 * 予実乖離の「予定に合わせる」「実績に合わせる」「稼働なし」を実行し、DB に解決方法を保存する。
 */
export async function applyPlanActualGapResolve(
  userId: string,
  date: string,
  mode: PlanActualGapResolution
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (mode === "manual") {
      return { ok: false, error: "手動確定は「手動で時間を編集」から保存してください。" };
    }
    if (isWeekendYmdJst(date)) {
      return { ok: false, error: JST_WEEKEND_WORK_REJECTED_MESSAGE };
    }
    const shifts = await loadShifts();
    const shift = canonicalShiftForUserDate(shifts, userId, date);
    if (!shift) return { ok: false, error: "この日の稼働予定が見つかりません。" };

    const allRecords = await loadRecords();
    const actualMins = getTotalMinutesForDate(getRecordsForUser(allRecords, userId), date);

    if (mode === "actual") {
      if (actualMins <= 0) {
        return { ok: false, error: "実績がないため「実績に合わせる」は使えません。" };
      }
      const dayRecs = getRecordsForUserAndDate(allRecords, userId, date);
      const patch = shiftPatchFromActualRecords(dayRecs);
      if (!patch) return { ok: false, error: "実績レコードを解釈できませんでした。" };
      const okShift = await updateShiftPlannedSlotsById(shift.id, patch);
      if (!okShift) return { ok: false, error: "稼働予定の更新に失敗しました。" };
      await savePlanActualGapResolution(userId, date, mode);
      return { ok: true };
    }

    if (mode === "absent") {
      if (actualMins > 0) {
        return {
          ok: false,
          error: "活動記録のある日は「稼働なし」にできません。実績に合わせるか、記録を削除してから選んでください。",
        };
      }
      const dayRecsAbsent = getRecordsForUserAndDate(allRecords, userId, date);
      for (const r of dayRecsAbsent) {
        const del = await deleteAttendanceRecordById(r.id);
        if (!del.ok) return { ok: false, error: del.error ?? "活動記録の削除に失敗しました。" };
      }
      const opensAbsent = await loadOpenRecords();
      await saveOpenRecords(opensAbsent.filter((o) => !(o.userId === userId && o.date === date)));
      const afterAbsent = await loadRecords();
      const userRestAbsent = getRecordsForUser(afterAbsent, userId).filter((r) => r.date !== date);
      await saveRecordsForUser(userId, userRestAbsent, { bypassPunchTimeRestrictions: true });
      const okAbsent = await updateShiftPlannedSlotsById(shift.id, {
        startPlanned: SHIFT_ENTRY_NONE,
        endPlanned: SHIFT_ENTRY_NONE,
        startPlanned2: null,
        endPlanned2: null,
      });
      if (!okAbsent) return { ok: false, error: "稼働予定を「なし」に更新できませんでした。" };
      await savePlanActualGapResolution(userId, date, "absent");
      return { ok: true };
    }

    const slots = getConcretePlannedSlots(shift);
    if (slots.length === 0) return { ok: false, error: "予定枠が空のため「予定に合わせる」は使えません。" };

    const dayRecs = getRecordsForUserAndDate(allRecords, userId, date);
    for (const r of dayRecs) {
      const del = await deleteAttendanceRecordById(r.id);
      if (!del.ok) return { ok: false, error: del.error ?? "既存の活動記録の削除に失敗しました。" };
    }

    const opens = await loadOpenRecords();
    const nextOpen = opens.filter((o) => !(o.userId === userId && o.date === date));
    await saveOpenRecords(nextOpen);

    const afterDel = await loadRecords();
    const userRest = getRecordsForUser(afterDel, userId).filter((r) => r.date !== date);
    const newRecs: WorkRecord[] = [];
    for (const slot of slots) {
      const w = buildWorkRecordFromHhmmOnDate(date, slot.start, slot.end, userId, undefined, false);
      if (w) newRecs.push(w);
    }
    if (newRecs.length === 0) {
      return { ok: false, error: "予定枠から活動記録を生成できませんでした（時刻を確認してください）。" };
    }
    await saveRecordsForUser(userId, [...userRest, ...newRecs], { bypassPunchTimeRestrictions: true });
    await savePlanActualGapResolution(userId, date, mode);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

const MANUAL_OVERRIDE_HISTORY_SOURCE = "plan_actual_gap_admin_manual";

/**
 * 管理者が開始・終了・休憩（分）を指定して活動記録を 1 件に差し替え、予実を manual で確定する。
 * 既存の当日 attendance は削除し、修正前の attendance / KPI スナップショットを data_change_history に残す。
 */
export async function applyPlanActualGapManualOverride(
  userId: string,
  date: string,
  input: { startHhmm: string; endHhmm: string; breakMinutes: number },
  opts?: { adminUserId?: string | null }
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (isWeekendYmdJst(date)) {
      return { ok: false, error: JST_WEEKEND_WORK_REJECTED_MESSAGE };
    }
    const startH = input.startHhmm.trim();
    const endH = input.endHhmm.trim();
    const breakM = Math.max(0, Math.floor(input.breakMinutes));

    let shifts = await loadShifts();
    let shift = canonicalShiftForUserDate(shifts, userId, date);
    if (!shift) {
      const placeholder: Shift = {
        id: crypto.randomUUID(),
        userId,
        date,
        startPlanned: SHIFT_ENTRY_NONE,
        endPlanned: SHIFT_ENTRY_NONE,
      };
      const okNew = await saveShifts([...shifts, placeholder], {
        skipChangeHistory: true,
        changeSource: "plan_actual_gap_manual_ensure_shift",
      });
      if (!okNew) return { ok: false, error: "稼働予定の新規行を作成できませんでした。" };
      shifts = await loadShifts();
      shift = canonicalShiftForUserDate(shifts, userId, date);
      if (!shift) return { ok: false, error: "稼働予定の確認に失敗しました。" };
    }

    const newId = crypto.randomUUID();
    const newRec = buildAdminExactWorkRecord(date, startH, endH, breakM, userId, newId);
    if (!newRec) {
      return {
        ok: false,
        error: "開始・終了・休憩の組み合わせが無効です（実働が 0 分以下、または時刻の形式が不正です）。",
      };
    }

    const allRecords = await loadRecords();
    const dayRecs = getRecordsForUserAndDate(allRecords, userId, date);
    const kpis = await loadKpi();
    const kpiBefore = getKpiForDate(getKpiForUser(kpis, userId), date);

    for (const r of dayRecs) {
      const del = await deleteAttendanceRecordById(r.id);
      if (!del.ok) return { ok: false, error: del.error ?? "既存の活動記録の削除に失敗しました。" };
    }

    const opens = await loadOpenRecords();
    await saveOpenRecords(opens.filter((o) => !(o.userId === userId && o.date === date)));

    const afterDel = await loadRecords();
    const userRest = getRecordsForUser(afterDel, userId).filter((r) => r.date !== date);
    await saveRecordsForUser(userId, [...userRest, newRec], { bypassPunchTimeRestrictions: true });

    /** 管理者が入力した壁時計どおりに shifts を上書き（ISO 経由の変換ズレを避ける） */
    const patch = {
      startPlanned: startH,
      endPlanned: endH,
      startPlanned2: null,
      endPlanned2: null,
    };
    const okShift = await updateShiftPlannedSlotsById(shift.id, patch);
    if (!okShift) return { ok: false, error: "稼働予定の更新に失敗しました。" };

    const sortedBefore = [...dayRecs].sort((a, b) => a.startRounded.localeCompare(b.startRounded));
    const originalStart = sortedBefore.length > 0 ? sortedBefore[0].startRounded : null;
    const originalEnd = sortedBefore.length > 0 ? sortedBefore[sortedBefore.length - 1].endRounded : null;

    await savePlanActualGapResolution(userId, date, "manual", {
      kpiId: kpiBefore?.id ?? null,
      originalStart,
      originalEnd,
      approvedStart: newRec.startRounded,
      approvedEnd: newRec.endRounded,
      adminId: opts?.adminUserId ?? null,
    });

    await logAttendanceAdminManualOverrideHistory({
      newAttendanceId: newRec.id,
      userId,
      source: MANUAL_OVERRIDE_HISTORY_SOURCE,
      oldRow: {
        修正前データ: {
          attendance: dayRecs.map(workRecordToHistoryJson),
          kpi: kpiBefore ? kpiToHistoryJson(kpiBefore) : null,
        },
      },
      newRow: {
        確定後の活動記録: workRecordToHistoryJson(newRec),
        admin_input: { start_hhmm: startH, end_hhmm: endH, break_minutes: breakM },
        resolution: "manual",
      },
    });

    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
