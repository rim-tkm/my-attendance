"use client";

import { signIn, signOut } from "next-auth/react";
import { useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from "react";
import type { WorkRecord, OpenRecord, Shift, KpiRecord, Member } from "@/lib/attendance";
import {
  DEFAULT_HOURLY_RATE,
  roundUpTo15Minutes,
  roundDownTo15Minutes,
  calcDurationMinutes,
  toDateString,
  formatDuration,
  getRecordsForMonth,
  getRecordsForDate,
  getTotalMinutesForMonth,
  getTotalMinutesForDate,
  getSelectableMonths,
  getOpenRecordForUser,
  getRecordsForUser,
  getShiftsForUser,
  getKpiForUser,
  getKpiForDate,
  getKpiForMonth,
  getMonthlyKpiTotals,
  getThisWeekMondayDateString,
  getKpiInDateRange,
  getKpiTotalsFromRecords,
  decisionMakerApoUnitYenFromPay,
  get15MinOptions,
  getShiftPlannedMinutes,
  timeToMinutes,
  buildWorkRecordFromHhmmOnDate,
  getWeekDates,
  getDeadlineForWeek,
  addWeeksToWeekStart,
  getMondayOfCalendarWeekForYmd,
  getSubmittableShiftWeekMondays,
  getOrderedSubmittableShiftWeeks,
  getFirstOpenShiftWeekStart,
  isWeekOpenForEntry,
  getShiftsByDateForWeek,
  getDateStringsInclusive,
  SHIFT_ENTRY_NONE,
  isWeekendYmd,
  getKpiRates,
  safeRatePercent,
  getTotalMinutesForMonthByUser,
  getTotalMinutesForUserInDateRange,
  calcMonthlyPay,
  getActiveMembersMissingInvoiceNumber,
  isMemberMissingInvoiceNumber,
  KPI_DAY_DEFAULT_START_TIME,
  normalizeKpiStartTime,
  kpiRecordHasOperationalMetrics,
  mergeShiftsAndKpisByUserDate,
  shiftHasConcretePrimaryPlanned,
  aggregateUserWorkDaySpan,
  userQualifiesForDailyActualView,
  buildPlannedShiftListForDate,
  coerceKpiTimestamptzField,
  coerceKpiWorkDateYmd,
  dedupeKpiRecordsByUserDate,
  canonicalShiftForUserDate,
  earliestPlannedShiftStartMinutes,
  formatShiftPlannedForDailyActualCell,
  getRecordsForUserAndDate,
  shiftPrimarySlotIsExplicitNoneEntry,
  shiftSecondarySlotIsExplicitNoneEntry,
  SHIFT_WEEKDAY_DEFAULT_START,
  SHIFT_WEEKDAY_DEFAULT_END,
  SHIFT_PLANNED_START_BUSINESS_RULE_MESSAGE,
  SHIFT_PLANNED_LATEST_BUSINESS_RULE_MESSAGE,
  shiftPlannedHhmmWindowViolation,
  buildShiftPrimaryPlannedStartSelectOptions,
  buildShiftPrimaryPlannedEndSelectOptions,
  buildShiftSecondaryPlannedStartSelectOptions,
  buildShiftSecondaryPlannedEndSelectOptions,
  formatYmdJst,
  WORK_DURATION_EXCEEDS_24H_MESSAGE,
  WORK_DURATION_HARD_MAX_MINUTES,
  WORK_RECORD_END_NOT_AFTER_START_MESSAGE,
  WORK_RECORD_SAME_START_END_MESSAGE,
  WORK_DURATION_SOFT_CONFIRM_MINUTES,
  SHIFT_PLANNED_NEW_MEMBER_EARLIEST_START_MINUTES,
} from "@/lib/attendance";
import {
  formatAdminShiftSchedulePrimaryLine,
  formatAdminShiftScheduleSecondaryLine,
  getUserDayLaborSignals,
} from "@/lib/shift-labor-display";
import {
  addCalendarDays,
  buildMemberRoiRowsForRange,
  buildRoiCsvDayRows,
  buildRoiCsvContent,
  buildTeamDailyRoiSeriesForRange,
  firstDayOfRollingCalendarMonths,
  getMonthDateRange,
  normalizeRoiRange,
  compareMemberRoiRowsByKpiOutsourceKey,
  ROI_YEN_PER_CALL,
  ROI_YEN_PER_FOLLOWUP,
  ROI_YEN_PER_NON_DECISION_APO,
  ROI_YEN_PER_DECISION_APO,
  ROI_FIXED_COST_ADMIN_YEN,
  ROI_FIXED_COST_AUTOCALL_YEN,
  ROI_PER_PERSON_FIXED_COST_YEN,
  type DailyRoiPoint,
  type RoiKpiOutsourceSortKey,
} from "@/lib/roi-analysis";
import {
  buildInternConfirmedDailySeries,
  buildInternRewardRowsForRange,
  computeGeneralDashboardMetrics,
  computeGeneralKpiMetricsForRange,
  computeInternDashboardMetrics,
  computeInternDashboardMetricsForRange,
  splitDashboardMembers,
  type InternConfirmedDailyPoint,
} from "@/lib/admin-dashboard-metrics";
import { isInternMember } from "@/lib/invoice-intern";
import {
  adminTableSortIcon,
  cycleAdminTableSort,
  type AdminTableSortState,
  type AdminKpiDailySortKey,
  compareAdminKpiDailyRows,
  compareDailyActualBlockRows,
  type DailyActualSortKey,
  shiftScheduleGridDateColumnScore,
} from "@/lib/admin-table-sort";
import {
  buildBomUtf8CsvContent,
  buildProductivityDailyCsvRows,
  buildProductivityMemberSummaryCsvRows,
} from "@/lib/export-productivity-csv";
import {
  loadMembers,
  addMember,
  updateMember,
  loadRecords,
  loadOpenRecords,
  loadShifts,
  loadKpi,
  saveRecords,
  saveOpenRecords,
  saveRecordsForUser,
  setOpenRecordForUser,
  saveKpiForUser,
  loginUser,
  loadPlanActualGapApprovalsDetailed,
  type PlanActualGapResolution,
  exportAllDataFromSupabase,
  importAllDataToSupabase,
  deleteAttendanceRecordById,
} from "@/lib/supabase-data";
import { persistOpenRecordClientBackup, readOpenRecordClientBackup } from "@/lib/open-record-client-backup";
import { withNetworkRetry } from "@/lib/network-retry";
import { parseStartInstantJstOnWorkDate } from "@/lib/punch-jst-time";
import { getSupabase } from "@/lib/supabase";
import {
  exportScheduleToCsvString,
  formatScheduleColumnHeader,
  getMondayOfCalendarWeekContaining,
  getTodayJstDateString,
  isWeekendYmdJst,
  JST_WEEKEND_WORK_REJECTED_MESSAGE,
} from "@/lib/export-schedule";
import {
  isWithinDailyPunchClockWindowJst,
  isMemberEndPunchLockedByPlanAt,
  isMemberStartPunchAllowedByPlannedWorkJst,
  getMemberStartPunchEarliestJstMinutesSinceMidnight,
  getMemberStartPunchLatestJstMinutesSinceMidnight,
  getJstMinutesSinceMidnight,
  PUNCH_OUTSIDE_WINDOW_MESSAGE,
  PUNCH_DEADLINE_PASSED_MESSAGE,
  PUNCH_START_BEFORE_PLANNED_MESSAGE,
  PUNCH_START_AFTER_PLANNED_MESSAGE,
} from "@/lib/punch-time-guard";
import {
  loadMemberOpenRecordFromDb,
  PUNCH_ALREADY_STARTED_MESSAGE,
  PUNCH_GENERIC_NETWORK_ERROR,
  PUNCH_NETWORK_RETRY_OPTIONS,
  PUNCH_NO_OPEN_RECORD_MESSAGE,
  resolvePunchErrorMessage,
} from "@/lib/punch-client";
import {
  buildPlanActualGapRows,
  buildPlanActualGapCsv,
  filterPlanActualGapRows,
  earliestPlanActualDataDate,
  planActualGapApprovalKey,
  getConcretePlannedSlots,
  PLAN_ACTUAL_TIME_TOLERANCE_MIN,
  PLAN_ACTUAL_LARGE_GAP_MIN,
  type PlanActualGapRow,
} from "@/lib/plan-actual-gap";
import { applyPlanActualGapManualOverride, applyPlanActualGapResolve } from "@/lib/plan-actual-gap-resolve";
import { readKpiMissingAfterPunchGraceMinutes } from "@/lib/kpi-missing-after-punch-reminder";
import {
  buildInvoiceBulkZipFileName,
  buildInvoiceCombinedPdfFileName,
  buildInvoiceHtmlForMember,
  calcInvoiceAmounts,
} from "@/lib/invoice-html";
import { buildKpiRecordWithConfirmedPatch } from "@/lib/kpi-confirmed-admin";
import {
  INTERN_RATE_DECISION_MAKER_APPS,
  INTERN_RATE_NON_DECISION_MAKER_APPS,
  calcMemberMonthlyPayYen,
  getInternUnitRates,
  sumInternConfirmedAppsForMonth,
} from "@/lib/invoice-intern";
import { renderMemberCombinedPdfBlob } from "@/lib/member-combined-pdf";
import { preloadJpFontsForPdf } from "@/lib/invoice-pdf-pdflib";
import {
  sanitizeInvoiceRegistrationInput,
  validateQualifiedInvoiceRegistrationNumber,
} from "@/lib/invoice-registration-number";
import JSZip from "jszip";

/** シフト保存 API 用: isManualDelete を is_manual_delete にし、DB 非カラムを送らない */
function shiftsToScheduleApiJson(shifts: Shift[]): unknown[] {
  return shifts.map((s) => {
    const { isManualDelete, ...rest } = s;
    return isManualDelete === true ? { ...rest, is_manual_delete: true } : rest;
  });
}

function formatPlanActualGapDiffLabel(r: PlanActualGapRow): string {
  if (r.missingEndPunchAfterPlannedEnd) return "終了未打刻（予定超過）";
  if (r.plannedMinutes > 0 && r.actualMinutes === 0) return "実績なし";
  const d = r.diffMinutes;
  if (d === 0) return "±0";
  const sign = d > 0 ? "+" : "−";
  return `${sign}${formatDuration(Math.abs(d))}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function formatDisplayDate(dateStr: string): string {
  const parts = dateStr.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  const date = new Date(y, (m || 1) - 1, d || 1);
  return date.toLocaleDateString("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

type AdminShiftDayFields = { s1: string; e1: string; s2: string; e2: string };

function analyzeAdminShiftDay(f: AdminShiftDayFields): {
  dayNone: boolean;
  slot1Inverted: boolean;
  slot2Incomplete: boolean;
  slot2Inverted: boolean;
  totalMinutes: number;
  slotWindowEarly: boolean;
  slotWindowLate: boolean;
} {
  const dayNone = f.s1 === SHIFT_ENTRY_NONE;
  if (dayNone) {
    return {
      dayNone: true,
      slot1Inverted: false,
      slot2Incomplete: false,
      slot2Inverted: false,
      totalMinutes: 0,
      slotWindowEarly: false,
      slotWindowLate: false,
    };
  }
  const t1s = timeToMinutes(f.s1);
  const t1e = timeToMinutes(f.e1);
  const slot1Inverted = !Number.isNaN(t1s) && !Number.isNaN(t1e) && t1e <= t1s;
  const slot2Incomplete = Boolean(f.s2) !== Boolean(f.e2);
  let slot2Inverted = false;
  if (f.s2 && f.e2) {
    const u = timeToMinutes(f.s2);
    const v = timeToMinutes(f.e2);
    slot2Inverted = !Number.isNaN(u) && !Number.isNaN(v) && v <= u;
  }
  let slotWindowEarly = false;
  let slotWindowLate = false;
  const bumpWindow = (hhmm: string) => {
    const v = shiftPlannedHhmmWindowViolation(hhmm);
    if (v === "early") slotWindowEarly = true;
    if (v === "late") slotWindowLate = true;
  };
  bumpWindow(f.s1);
  bumpWindow(f.e1);
  if (f.s2 && f.e2) {
    bumpWindow(f.s2);
    bumpWindow(f.e2);
  }
  let total = 0;
  if (!slot1Inverted && !Number.isNaN(t1s) && !Number.isNaN(t1e)) total += Math.max(0, t1e - t1s);
  if (f.s2 && f.e2 && !slot2Inverted) {
    const u = timeToMinutes(f.s2);
    const v = timeToMinutes(f.e2);
    if (!Number.isNaN(u) && !Number.isNaN(v)) total += Math.max(0, v - u);
  }
  return {
    dayNone,
    slot1Inverted,
    slot2Incomplete,
    slot2Inverted,
    totalMinutes: total,
    slotWindowEarly,
    slotWindowLate,
  };
}

function adminShiftDayCanSave(f: AdminShiftDayFields, restrictMorningStart?: boolean): boolean {
  const a = analyzeAdminShiftDay(f);
  if (a.dayNone) return true;
  if (a.slotWindowEarly || a.slotWindowLate) return false;
  if (a.slot1Inverted || a.slot2Incomplete || a.slot2Inverted) return false;
  if (restrictMorningStart) {
    const floor = SHIFT_PLANNED_NEW_MEMBER_EARLIEST_START_MINUTES;
    if (f.s1 !== SHIFT_ENTRY_NONE && f.s1 !== "なし") {
      const m1 = timeToMinutes(f.s1);
      if (!Number.isNaN(m1) && m1 < floor) return false;
    }
    const s2 = (f.s2 ?? "").trim();
    if (s2 && s2 !== SHIFT_ENTRY_NONE && s2 !== "なし") {
      const m2 = timeToMinutes(s2);
      if (!Number.isNaN(m2) && m2 < floor) return false;
    }
  }
  return a.totalMinutes > 0;
}

/** ビジュアルシフト表用：セル種別 */
function classifyVisualShiftCell(s: Shift | undefined): "missing" | "off" | "work" {
  if (!s) return "missing";
  if (s.startPlanned === SHIFT_ENTRY_NONE || s.startPlanned === "なし") return "off";
  return "work";
}

/** ビジュアルシフト表：稼働ありセルに表示する時間ラベル（黒文字想定） */
function formatVisualShiftWorkLabel(s: Shift): string {
  let t = `${s.startPlanned}～${s.endPlanned}`;
  if (s.startPlanned2 && s.endPlanned2 && s.startPlanned2.trim() && s.endPlanned2.trim()) {
    t += `\n${s.startPlanned2}～${s.endPlanned2}`;
  }
  return t;
}

function formatShiftSectionDateHeading(dateStr: string): string {
  const parts = dateStr.split("-").map(Number);
  const date = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function shiftFormWeekendNone(): { s1: string; e1: string; s2: string; e2: string } {
  return { s1: SHIFT_ENTRY_NONE, e1: SHIFT_ENTRY_NONE, s2: "", e2: "" };
}

/** 指定月の末日を YYYY-MM-DD で返す */
function getLastDayOfMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const last = new Date(y, m, 0);
  const dd = String(last.getDate()).padStart(2, "0");
  return `${y}-${String(m).padStart(2, "0")}-${dd}`;
}

/** 期間ラベル用：日付範囲を "M/D〜M/D" 形式で */
function formatPeriodLabel(start: string, end: string): string {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  return `${sm}/${sd}〜${em}/${ed}`;
}

/** レポート用：日付文字列から時刻のみ HH:mm を返す */
function formatTimeForReport(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

/** 実績レポート用：選択可能な最大月（前月）を YYYY-MM で返す。今月・未来は選択不可 */
function getLastMonthString(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** 請求書一括用：基準月から過去 count ヶ月分の YYYY-MM（基準月を含む） */
function getInvoiceBulkMonthOptions(maxYearMonth: string, count: number): string[] {
  const out: string[] = [];
  let [y, m] = maxYearMonth.split("-").map(Number);
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/** メンバー一覧：請求管理番号の3桁表示用。未設定は null */
function formatMemberInvoiceNumberThreeDigits(invoiceNumber: string | null | undefined): string | null {
  const raw = String(invoiceNumber ?? "").replace(/\D/g, "");
  if (!raw) return null;
  return raw.slice(-3).padStart(3, "0");
}

type AdminMemberTableSortKey = "morning" | "intern" | "invoice" | "name" | "minutes" | "pay";
type InternConfirmedPanelSortKey = "name" | "invoice";

function adminMemberTableSortGlyph(
  sort: { key: AdminMemberTableSortKey; dir: "asc" | "desc" } | null,
  column: AdminMemberTableSortKey
): string {
  if (!sort || sort.key !== column) return "⇅";
  return sort.dir === "asc" ? "▲" : "▼";
}

/** 管理者用：日付・開始・終了時刻から WorkRecord を生成（15分刻みで丸める）。終了≦開始の場合は null */
function buildWorkRecordFromTimes(
  dateStr: string,
  startTime: string,
  endTime: string,
  userId: string,
  id?: string,
  isAutoCompleted?: boolean
): WorkRecord | null {
  return buildWorkRecordFromHhmmOnDate(dateStr, startTime, endTime, userId, id, isAutoCompleted);
}

/** ISO 時刻文字列から "HH:mm" を取得（編集フォーム用） */
function getTimeFromIso(iso: string): string {
  if (!iso) return "09:00";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 活動記録・未終了打刻・または KPI 実績がある日（稼働予定の「なし」化を UI で制限する） */
function dateHasShiftActualData(
  userId: string,
  dateStr: string,
  allRecords: WorkRecord[],
  allKpiRecords: KpiRecord[],
  allOpenRecords: OpenRecord[]
): boolean {
  const mins = getTotalMinutesForDate(getRecordsForUser(allRecords, userId), dateStr);
  if (mins > 0) return true;
  if (allOpenRecords.some((o) => o.userId === userId && o.date === dateStr)) return true;
  const k = getKpiForDate(getKpiForUser(allKpiRecords, userId), dateStr);
  return kpiRecordHasOperationalMetrics(k);
}

/** 前日以前の「業務開始のみ」記録を稼働予定終了時刻で自動補完（日付変更時・起動時に実行） */
async function runAutoComplete(): Promise<void> {
  const [records, openRecs, shifts] = await Promise.all([loadRecords(), loadOpenRecords(), loadShifts()]);
  const todayStr = getTodayJstDateString();
  const openPast = openRecs.filter((o) => o.date < todayStr && !isWeekendYmdJst(o.date));
  if (openPast.length === 0) return;
  const newRecords: WorkRecord[] = [];
  for (const o of openPast) {
    const shift = shifts.find((s) => s.userId === o.userId && s.date === o.date);
    const startHhmm = getTimeFromIso(o.startRounded);
    let endTime: string;
    if (shift && shift.startPlanned !== ENTRY_NONE && shift.endPlanned !== ENTRY_NONE) {
      const startMins = timeToMinutes(startHhmm);
      const plan1 = timeToMinutes(shift.startPlanned);
      const plan2 = shift.startPlanned2 != null && shift.startPlanned2 !== ENTRY_NONE ? timeToMinutes(shift.startPlanned2) : null;
      if (plan2 != null && !Number.isNaN(plan2) && Math.abs(startMins - plan2) < Math.abs(startMins - plan1)) endTime = shift.endPlanned2 ?? shift.endPlanned;
      else endTime = shift.endPlanned;
    } else {
      endTime = "23:59";
    }
    const built = buildWorkRecordFromTimes(o.date, startHhmm, endTime, o.userId, o.id, true);
    if (built) newRecords.push(built);
  }
  if (newRecords.length === 0) return;
  const updatedRecords = [...records, ...newRecords].filter((r) => !isWeekendYmdJst(r.date));
  const completedIds = new Set(openPast.map((x) => x.id));
  const updatedOpen = openRecs.filter((r) => !completedIds.has(r.id));
  try {
    await saveRecords(updatedRecords);
    await saveOpenRecords(updatedOpen);
  } catch (e) {
    console.warn("runAutoComplete save error:", e);
  }
}

/** 業務委託実績報告書の本文HTML（結合PDF用） */
function buildReportBody(
  memberName: string,
  yearMonth: string,
  hourlyRate: number,
  totalMinutes: number,
  workDays: number,
  estimatedPay: number,
  totalCalls: number,
  validCalls: number,
  kcCount: number,
  decisionMakerApo: number,
  validRate: number | null,
  kcRate: number | null,
  apoRate: number | null,
  dailyRows: { date: string; displayDate: string; timeRanges: string[]; apoCount: number }[]
): string {
  const [y, m] = yearMonth.split("-");
  const monthLabel = `${y}年${m}月`;
  return `
  <div class="report-header">
    <div class="report-company">株式会社RIM</div>
    <h1 class="report-title">業務委託実績報告書</h1>
  </div>
  <div class="report-section">
    <div class="report-section-title">1. 基本情報</div>
    <table class="report-table">
      <tr><td>メンバー名</td><td>${memberName}</td></tr>
      <tr><td>対象月</td><td>${monthLabel}</td></tr>
      <tr><td>委託料単価</td><td class="number">¥${hourlyRate.toLocaleString()} /時間</td></tr>
    </table>
  </div>
  <div class="report-section">
    <div class="report-section-title">2. 稼働統計</div>
    <table class="report-table">
      <tr><td>総稼働時間（合計）</td><td class="number">${formatDuration(totalMinutes)}</td></tr>
      <tr><td>業務日数</td><td class="number">${workDays} 日</td></tr>
      <tr><td>概算委託料</td><td class="number">¥${estimatedPay.toLocaleString()}</td></tr>
    </table>
    <p class="report-note">※本金額は業務委託契約に基づく、稼働時間に応じた委託料の概算です。</p>
  </div>
  <div class="report-section">
    <div class="report-section-title">3. 業務遂行内容</div>
    <div class="report-business-desc">指定リストへの架電、および進捗データの入力</div>
  </div>
  <div class="report-section">
    <div class="report-section-title">4. 生産性スコア</div>
    <table class="report-table">
      <tr><td>総コール数</td><td class="number">${totalCalls}</td></tr>
      <tr><td>総有効コール数</td><td class="number">${validCalls}</td></tr>
      <tr><td>決裁者対話数（KC）</td><td class="number">${kcCount}</td></tr>
      <tr><td>決裁者アポ数</td><td class="number">${decisionMakerApo}</td></tr>
      <tr><td>有効率</td><td class="number">${validRate != null ? `${validRate}%` : "—"}</td></tr>
      <tr><td>KC率（決裁者接続率）</td><td class="number">${kcRate != null ? `${kcRate}%` : "—"}</td></tr>
      <tr><td>アポ率</td><td class="number">${apoRate != null ? `${apoRate}%` : "—"}</td></tr>
    </table>
  </div>
  <div class="report-section">
    <div class="report-section-title">5. 日別明細</div>
    <table class="report-table">
      <thead>
        <tr>
          <th>日付</th>
          <th>業務開始・終了時間</th>
          <th class="text-right">獲得アポ数</th>
        </tr>
      </thead>
      <tbody>
        ${dailyRows.length === 0 ? "<tr><td colspan=\"3\">該当データがありません</td></tr>" : dailyRows.map((row) => `<tr>
          <td>${row.displayDate}</td>
          <td class="daily-time">${row.timeRanges.join(" / ")}</td>
          <td class="text-right number">${row.apoCount}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>`;
}

/** 業務委託実績報告書のHTMLを生成（印刷用・A4・単体用） */
function buildReportHtml(
  memberName: string,
  yearMonth: string,
  hourlyRate: number,
  totalMinutes: number,
  workDays: number,
  estimatedPay: number,
  totalCalls: number,
  validCalls: number,
  kcCount: number,
  decisionMakerApo: number,
  validRate: number | null,
  kcRate: number | null,
  apoRate: number | null,
  dailyRows: { date: string; displayDate: string; timeRanges: string[]; apoCount: number }[]
): string {
  const body = buildReportBody(memberName, yearMonth, hourlyRate, totalMinutes, workDays, estimatedPay, totalCalls, validCalls, kcCount, decisionMakerApo, validRate, kcRate, apoRate, dailyRows);
  const style = `@page{size:A4;margin:16mm} body{font-family:Hiragino Sans,Meiryo,sans-serif;font-size:10pt;color:#1e293b;margin:0;padding:14px} .report-header{text-align:center;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #1e293b} .report-company{font-size:13pt;font-weight:bold} .report-title{font-size:14pt;font-weight:bold} .report-section{margin-top:14px} .report-section-title{font-size:11pt;font-weight:bold;margin-bottom:6px;border-bottom:1px solid #94a3b8} .report-table{width:100%;border-collapse:collapse;margin-top:4px} .report-table th,.report-table td{border:1px solid #cbd5e1;padding:4px 8px;font-size:9pt} .report-table td:first-child{width:160px;background:#f8fafc} .text-right{text-align:right} .number{font-variant-numeric:tabular-nums} .daily-time{white-space:nowrap} .report-note{font-size:8pt;color:#64748b;margin-top:2px} .report-business-desc{font-size:9pt;padding:6px 8px;background:#f8fafc;border:1px solid #e2e8f0}`;
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>業務委託実績報告書</title><style>${style}</style></head><body>${body}</body></html>`;
}

/** 指定メンバー・指定月の実績レポートを印刷用ウィンドウで開く（管理者・メンバー共通） */
function printMemberReport(
  member: Member,
  yearMonth: string,
  allRecords: WorkRecord[],
  allKpiRecords: KpiRecord[]
): void {
  const userId = member.id;
  const userRecords = getRecordsForMonth(getRecordsForUser(allRecords, userId), yearMonth);
  const userKpi = getKpiForMonth(getKpiForUser(allKpiRecords, userId), yearMonth);
  const totalMinutes = userRecords.reduce((s, r) => s + r.durationMinutes, 0);
  const workDays = new Set(userRecords.map((r) => r.date)).size;
  const rate = member.hourlyRate != null ? member.hourlyRate : DEFAULT_HOURLY_RATE;
  const estimatedPay = calcMonthlyPay(totalMinutes, rate);
  const kpiTotals = getKpiTotalsFromRecords(userKpi);
  const validRate = safeRatePercent(kpiTotals.validCalls, kpiTotals.totalCalls);
  const kcRate = safeRatePercent(kpiTotals.kcCount, kpiTotals.validCalls);
  const apoRate = safeRatePercent(kpiTotals.decisionMakerApo, kpiTotals.kcCount);
  const dateToKpi = new Map(userKpi.map((k) => [k.date, k]));
  const allDates = new Set<string>([...userRecords.map((r) => r.date), ...userKpi.map((k) => k.date)]);
  const sortedDates = Array.from(allDates).sort();
  const dailyRows = sortedDates.map((date) => {
    const dayRecords = userRecords.filter((r) => r.date === date);
    const timeRanges = dayRecords.map(
      (r) => `${formatTimeForReport(r.startRounded)}～${formatTimeForReport(r.endRounded)}`
    );
    const k = dateToKpi.get(date);
    const apoCount = k ? k.decisionMakerApo + k.nonDecisionMakerApo : 0;
    return {
      date,
      displayDate: formatDisplayDate(date),
      timeRanges,
      apoCount,
    };
  });
  const html = buildReportHtml(
    member.name,
    yearMonth,
    rate,
    totalMinutes,
    workDays,
    estimatedPay,
    kpiTotals.totalCalls,
    kpiTotals.validCalls,
    kpiTotals.kcCount,
    kpiTotals.decisionMakerApo,
    validRate,
    kcRate,
    apoRate,
    dailyRows
  );
  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  }
}

/** 指定メンバー・指定月の請求書を印刷用ウィンドウで開く（単体・管理者・メンバー共通） */
function printMemberInvoice(
  member: Member,
  yearMonth: string,
  allRecords: WorkRecord[]
): void {
  const html = buildInvoiceHtmlForMember(member, yearMonth, allRecords);
  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  }
}

type Tab = "home" | "shift" | "kpi";
type AdminSection =
  | "dashboard"
  | "attendance"
  | "shift"
  | "kpi"
  | "dailyActual"
  | "planActualGap"
  | "settings"
  | "roi"
  | "productivityExport";

function RoiTrendChart({ points }: { points: DailyRoiPoint[] }) {
  const vw = 640;
  const vh = 200;
  const pl = 44;
  const pr = 10;
  const pt = 12;
  const pb = 30;
  const gw = vw - pl - pr;
  const gh = vh - pt - pb;
  const n = points.length;
  if (n === 0) {
    return <p className="text-sm text-slate-500">表示する日付がありません。</p>;
  }
  const hasAny = points.some((p) => p.roi != null && Number.isFinite(p.roi));
  if (!hasAny) {
    return <p className="text-sm text-slate-500">この期間にコストが発生した日がなく、ROI を表示できません。</p>;
  }
  const rois = points.filter((p) => p.roi != null && Number.isFinite(p.roi)).map((p) => p.roi as number);
  let min = Math.min(...rois);
  let max = Math.max(...rois);
  if (Math.abs(max - min) < 1e-6) {
    min = Math.max(0, min - 0.3);
    max = max + 0.3;
  }
  const pad = Math.max((max - min) * 0.1, 0.08);
  min -= pad;
  max += pad;
  const yAt = (roi: number) => pt + gh - ((roi - min) / (max - min)) * gh;
  const pathParts: string[] = [];
  let started = false;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const x = pl + (n <= 1 ? gw / 2 : (i / (n - 1)) * gw);
    if (p.roi == null || !Number.isFinite(p.roi)) {
      started = false;
      continue;
    }
    const y = yAt(p.roi);
    if (!started) {
      pathParts.push(`M${x.toFixed(1)},${y.toFixed(1)}`);
      started = true;
    } else {
      pathParts.push(`L${x.toFixed(1)},${y.toFixed(1)}`);
    }
  }
  const d = pathParts.join(" ");
  const refLines: { roi: number; label: string; dash?: string }[] = [
    { roi: 1, label: "ROI 1.0", dash: "4 3" },
    { roi: 2, label: "ROI 2.0", dash: "4 3" },
  ];
  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${vw} ${vh}`} className="h-auto w-full max-w-[640px]" preserveAspectRatio="xMidYMid meet" aria-label="チーム日次ROIの推移">
        <rect x={0} y={0} width={vw} height={vh} fill="#f8fafc" rx={4} />
        {refLines.map(({ roi, dash }) => {
          if (roi < min || roi > max) return null;
          const y = yAt(roi);
          return (
            <line key={roi} x1={pl} y1={y} x2={pl + gw} y2={y} stroke="#cbd5e1" strokeWidth={1} strokeDasharray={dash} />
          );
        })}
        <path d={d} fill="none" stroke="#0f172a" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <text x={pl} y={vh - 6} fill="#64748b" style={{ fontSize: 10 }}>
          日付（月内）
        </text>
        <text x={4} y={pt + gh / 2} fill="#64748b" style={{ fontSize: 10 }} transform={`rotate(-90 4 ${pt + gh / 2})`}>
          ROI
        </text>
      </svg>
      <p className="mt-2 text-xs text-slate-500">破線は ROI 1.0（損益分岐目安）と 2.0（高貢献目安）です。チーム全体の日次集計です。</p>
    </div>
  );
}

function InternConfirmedBarChart({ points }: { points: InternConfirmedDailyPoint[] }) {
  const vw = 720;
  const vh = 240;
  const pl = 48;
  const pr = 16;
  const pt = 16;
  const pb = 40;
  const gw = vw - pl - pr;
  const gh = vh - pt - pb;
  const n = points.length;
  if (n === 0) {
    return <p className="text-sm text-slate-500">表示する日付がありません。</p>;
  }
  const maxVal = Math.max(1, ...points.flatMap((p) => [p.confirmedDm, p.confirmedNonDm]));
  const yAt = (v: number) => pt + gh - (v / maxVal) * gh;
  const groupW = gw / n;
  const barW = Math.min(14, Math.max(3, groupW * 0.2));
  const labelStep = n <= 10 ? 1 : n <= 20 ? 2 : 3;
  const yTicks = [0, Math.ceil(maxVal / 2), maxVal];

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${vw} ${vh}`} className="h-auto w-full min-w-[320px]" preserveAspectRatio="xMidYMid meet" aria-label="インターン確定商談数の日次推移">
        <rect x={0} y={0} width={vw} height={vh} fill="#faf5ff" rx={4} />
        {yTicks.map((tick) => {
          const y = yAt(tick);
          return (
            <g key={tick}>
              <line x1={pl} y1={y} x2={pl + gw} y2={y} stroke="#e9d5ff" strokeWidth={1} />
              <text x={pl - 6} y={y + 3} textAnchor="end" fill="#6b21a8" style={{ fontSize: 10 }}>
                {tick}
              </text>
            </g>
          );
        })}
        {points.map((p, i) => {
          const cx = pl + i * groupW + groupW / 2;
          const dmH = p.confirmedDm > 0 ? gh - (p.confirmedDm / maxVal) * gh : 0;
          const ndmH = p.confirmedNonDm > 0 ? gh - (p.confirmedNonDm / maxVal) * gh : 0;
          const dmY = pt + gh - dmH;
          const ndmY = pt + gh - ndmH;
          return (
            <g key={p.date}>
              <rect
                x={cx - barW - 1}
                y={dmY}
                width={barW}
                height={dmH}
                fill="#7c3aed"
                rx={1}
                aria-label={`${p.dayLabel} 決裁者確定 ${p.confirmedDm}件`}
              />
              <rect
                x={cx + 1}
                y={ndmY}
                width={barW}
                height={ndmH}
                fill="#c084fc"
                rx={1}
                aria-label={`${p.dayLabel} 非決裁者確定 ${p.confirmedNonDm}件`}
              />
              {i % labelStep === 0 || i === n - 1 ? (
                <text x={cx} y={vh - 8} textAnchor="middle" fill="#6b21a8" style={{ fontSize: 9 }}>
                  {p.dayLabel}
                </text>
              ) : null}
            </g>
          );
        })}
        <text x={pl} y={vh - 22} fill="#6b21a8" style={{ fontSize: 10 }}>
          日付（当月）
        </text>
      </svg>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-violet-600" aria-hidden />
          決裁者確定（confirmed_dm）
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-purple-300" aria-hidden />
          非決裁者確定（confirmed_non_dm）
        </span>
      </div>
    </div>
  );
}

function InternConfirmedDashboardRow({
  member,
  dateYmd,
  allKpiRecords,
  busy,
  onSave,
}: {
  member: Member;
  dateYmd: string;
  allKpiRecords: KpiRecord[];
  busy: boolean;
  onSave: (patch: { confirmedDecisionMakerApps?: number; confirmedNonDecisionMakerApps?: number }) => Promise<void>;
}) {
  const existing = getKpiForDate(getKpiForUser(allKpiRecords, member.id), dateYmd);
  const [dm, setDm] = useState(() => kpiStoredNumberToInputString(existing?.confirmedDecisionMakerApps ?? 0));
  const [ndm, setNdm] = useState(() => kpiStoredNumberToInputString(existing?.confirmedNonDecisionMakerApps ?? 0));

  useEffect(() => {
    setDm(kpiStoredNumberToInputString(existing?.confirmedDecisionMakerApps ?? 0));
    setNdm(kpiStoredNumberToInputString(existing?.confirmedNonDecisionMakerApps ?? 0));
  }, [member.id, dateYmd, existing?.confirmedDecisionMakerApps, existing?.confirmedNonDecisionMakerApps]);

  const saveBoth = async () => {
    await onSave({
      confirmedDecisionMakerApps: parseKpiFieldStringToInt(dm),
      confirmedNonDecisionMakerApps: parseKpiFieldStringToInt(ndm),
    });
  };

  const invLabel = formatMemberInvoiceNumberThreeDigits(member.invoiceNumber);

  return (
    <tr className="border-b border-violet-100/80 last:border-0 hover:bg-violet-50/40">
      <td className="px-3 py-2.5 text-sm font-medium text-slate-900">{member.name}</td>
      <td className="px-2 py-2.5 text-center font-mono text-xs tabular-nums text-slate-600">
        {invLabel ?? <span className="text-amber-700">—</span>}
      </td>
      <td className="px-2 py-2.5 text-center">
        <input
          type="number"
          min={0}
          value={dm}
          disabled={busy}
          onChange={(e) => setDm(e.target.value)}
          onBlur={() => void onSave({ confirmedDecisionMakerApps: parseKpiFieldStringToInt(dm) })}
          className="w-16 rounded border border-violet-200 bg-white px-1.5 py-1.5 text-center text-sm tabular-nums focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-400"
          aria-label={`${member.name} 決裁者確定数`}
        />
      </td>
      <td className="px-2 py-2.5 text-center">
        <input
          type="number"
          min={0}
          value={ndm}
          disabled={busy}
          onChange={(e) => setNdm(e.target.value)}
          onBlur={() => void onSave({ confirmedNonDecisionMakerApps: parseKpiFieldStringToInt(ndm) })}
          className="w-16 rounded border border-violet-200 bg-white px-1.5 py-1.5 text-center text-sm tabular-nums focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-400"
          aria-label={`${member.name} 非決裁者確定数`}
        />
      </td>
      <td className="px-2 py-2.5 text-right">
        <button
          type="button"
          disabled={busy}
          onClick={() => void saveBoth()}
          className="rounded-md bg-violet-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-800 disabled:opacity-50"
        >
          {busy ? "保存中…" : "保存"}
        </button>
      </td>
    </tr>
  );
}

type KpiFormFieldKey = keyof Omit<
  KpiRecord,
  | "id"
  | "date"
  | "userId"
  | "kpiMissingSlackNotifiedAt"
  | "startTime"
  | "confirmedDecisionMakerApps"
  | "confirmedNonDecisionMakerApps"
>;

const KPI_LABELS: { key: KpiFormFieldKey; label: string; callSystemHint?: string }[] = [
  {
    key: "totalCalls",
    label: "総コール数",
    callSystemHint: "（コールシステム上の『発信数』を入力してください）",
  },
  {
    key: "validCalls",
    label: "総有効コール数",
    callSystemHint: "（見込み数 + コンタクト数 + キーマンコンタクト数 + 完了数の合計）",
  },
  {
    key: "kcCount",
    label: "KC数",
    callSystemHint: "（キーマンコンタクト数）",
  },
  {
    key: "followUpCreated",
    label: "追いかけ作成数",
    callSystemHint: "（見込み数）",
  },
  { key: "decisionMakerApo", label: "決裁者アポ数" },
  { key: "nonDecisionMakerApo", label: "非決裁者アポ数" },
];

const EMPTY_KPI_FORM_STRINGS: Record<KpiFormFieldKey, string> = {
  totalCalls: "",
  validCalls: "",
  kcCount: "",
  followUpCreated: "",
  decisionMakerApo: "",
  nonDecisionMakerApo: "",
};

function kpiStoredNumberToInputString(n: number): string {
  return n === 0 ? "" : String(n);
}

/** 空欄は保存時 0。不正・負数は 0 に丸める */
function parseKpiFieldStringToInt(s: string): number {
  const t = s.trim();
  if (t === "") return 0;
  const n = parseInt(t, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function sanitizeKpiNumericInput(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** フォーカス時に 0 のみのとき全選択し、すぐ上書き入力できるようにする */
function handleKpiNumberInputFocus(e: React.FocusEvent<HTMLInputElement>) {
  if (e.currentTarget.value === "0") {
    e.currentTarget.select();
  }
}

/** NextAuth Cookie が使えない本番でも Slack 送信できるよう、管理者ログイン時にのみメモリ保持（再読み込みで消える） */
const slackAdminAuthMemory = { current: null as { loginId: string; password: string } | null };

type KpiOutsourceTableSort = { key: RoiKpiOutsourceSortKey; dir: "asc" | "desc" } | null;

function cycleKpiOutsourceSort(prev: KpiOutsourceTableSort, key: RoiKpiOutsourceSortKey): KpiOutsourceTableSort {
  if (prev == null) return { key, dir: "desc" };
  if (prev.key !== key) return { key, dir: "desc" };
  if (prev.dir === "desc") return { key, dir: "asc" };
  return null;
}

function RoiKpiOutsourceTh(props: {
  label: string;
  sublabel?: string;
  sortKey: RoiKpiOutsourceSortKey;
  sort: KpiOutsourceTableSort;
  onSort: (k: RoiKpiOutsourceSortKey) => void;
  align?: "left" | "right";
}) {
  const { label, sublabel, sortKey, sort, onSort, align = "right" } = props;
  const active = sort != null && sort.key === sortKey;
  const icon = !active ? "↕" : sort.dir === "desc" ? "↓" : "↑";
  return (
    <th className={`px-2 py-2.5 font-medium text-slate-600 sm:px-3 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title="クリック: 降順 → 昇順 → 元の順"
        className={`group flex w-full flex-col gap-0.5 ${align === "right" ? "items-end text-right" : "items-start text-left"}`}
      >
        <span className="inline-flex items-baseline gap-1">
          <span>{label}</span>
          <span className="text-slate-400">{icon}</span>
        </span>
        {sublabel ? <span className="text-[10px] font-normal text-slate-500">{sublabel}</span> : null}
      </button>
    </th>
  );
}

function AdminSortableTh(props: {
  label: ReactNode;
  sortKey: string;
  sort: AdminTableSortState<string> | null;
  onSort: (sortKey: string) => void;
  align?: "left" | "center" | "right";
  className?: string;
}) {
  const { label, sortKey, sort, onSort, align = "left", className = "" } = props;
  const icon = adminTableSortIcon(sort as AdminTableSortState<string>, sortKey);
  const alignCls = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  const btnAlign = align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";
  return (
    <th className={`py-2.5 font-medium text-slate-600 ${alignCls} ${className || "px-3"}`.trim()}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title="クリック: 降順 → 昇順 → 元の順"
        className={`inline-flex w-full min-w-0 items-center gap-1.5 text-slate-600 hover:text-slate-900 ${btnAlign}`}
      >
        <span className="min-w-0">{label}</span>
        <span className="shrink-0 select-none text-slate-400" aria-hidden>
          {icon}
        </span>
      </button>
    </th>
  );
}

type AdminKpiModalTarget = { userId: string; dateYmd: string; memberName: string; isIntern: boolean };

/** 管理者が任意メンバー・任意日の KPI を代理入力・修正（メンバー画面の KPI タブと同項目・同注釈） */
function AdminKpiProxyModal(props: {
  target: AdminKpiModalTarget | null;
  allKpiRecords: KpiRecord[];
  onClose: () => void;
  onSave: (memberId: string, savedDay: KpiRecord, nextForUser: KpiRecord[]) => Promise<void>;
}) {
  const { target, allKpiRecords, onClose, onSave } = props;
  const [kpiDate, setKpiDate] = useState(() => getTodayJstDateString());
  const [kpiFields, setKpiFields] = useState<Record<KpiFormFieldKey, string>>(() => ({ ...EMPTY_KPI_FORM_STRINGS }));
  const [confirmedDm, setConfirmedDm] = useState("");
  const [confirmedNdm, setConfirmedNdm] = useState("");
  const [kpiSaveBusy, setKpiSaveBusy] = useState(false);

  useEffect(() => {
    if (!target) return;
    setKpiDate(target.dateYmd);
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const userKpi = getKpiForUser(allKpiRecords, target.userId);
    const existing = getKpiForDate(userKpi, kpiDate);
    if (existing) {
      setKpiFields({
        totalCalls: kpiStoredNumberToInputString(existing.totalCalls),
        validCalls: kpiStoredNumberToInputString(existing.validCalls),
        kcCount: kpiStoredNumberToInputString(existing.kcCount),
        followUpCreated: kpiStoredNumberToInputString(existing.followUpCreated),
        decisionMakerApo: kpiStoredNumberToInputString(existing.decisionMakerApo),
        nonDecisionMakerApo: kpiStoredNumberToInputString(existing.nonDecisionMakerApo),
      });
      setConfirmedDm(kpiStoredNumberToInputString(existing.confirmedDecisionMakerApps ?? 0));
      setConfirmedNdm(kpiStoredNumberToInputString(existing.confirmedNonDecisionMakerApps ?? 0));
    } else {
      setKpiFields({ ...EMPTY_KPI_FORM_STRINGS });
      setConfirmedDm("");
      setConfirmedNdm("");
    }
  }, [target, kpiDate, allKpiRecords]);

  if (!target) return null;

  const targetIsIntern = target.isIntern;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (kpiSaveBusy) return;
    if (isWeekendYmdJst(kpiDate)) {
      alert(JST_WEEKEND_WORK_REJECTED_MESSAGE);
      return;
    }
    setKpiSaveBusy(true);
    try {
      const dateYmd = coerceKpiWorkDateYmd(kpiDate);
      if (!dateYmd) {
        alert("日付が不正です。もう一度お試しください。");
        return;
      }
      const userId = target.userId;
      const userKpi = getKpiForUser(allKpiRecords, userId);
      const existingRec = getKpiForDate(userKpi, dateYmd);
      const slotStart = normalizeKpiStartTime(existingRec ?? { startTime: KPI_DAY_DEFAULT_START_TIME });
      const preservedNotify = existingRec ? coerceKpiTimestamptzField(existingRec.kpiMissingSlackNotifiedAt) : undefined;
      const rec: KpiRecord = {
        id: existingRec ? existingRec.id : crypto.randomUUID(),
        userId,
        date: dateYmd,
        startTime: slotStart,
        totalCalls: targetIsIntern ? (existingRec?.totalCalls ?? 0) : parseKpiFieldStringToInt(kpiFields.totalCalls),
        validCalls: targetIsIntern ? (existingRec?.validCalls ?? 0) : parseKpiFieldStringToInt(kpiFields.validCalls),
        kcCount: targetIsIntern ? (existingRec?.kcCount ?? 0) : parseKpiFieldStringToInt(kpiFields.kcCount),
        followUpCreated: targetIsIntern ? (existingRec?.followUpCreated ?? 0) : parseKpiFieldStringToInt(kpiFields.followUpCreated),
        decisionMakerApo: targetIsIntern ? (existingRec?.decisionMakerApo ?? 0) : parseKpiFieldStringToInt(kpiFields.decisionMakerApo),
        nonDecisionMakerApo: targetIsIntern
          ? (existingRec?.nonDecisionMakerApo ?? 0)
          : parseKpiFieldStringToInt(kpiFields.nonDecisionMakerApo),
        confirmedDecisionMakerApps: parseKpiFieldStringToInt(confirmedDm),
        confirmedNonDecisionMakerApps: parseKpiFieldStringToInt(confirmedNdm),
        ...(preservedNotify ? { kpiMissingSlackNotifiedAt: preservedNotify } : {}),
      };
      const next = existingRec
        ? userKpi.map((r) =>
            r.date === dateYmd && normalizeKpiStartTime(r) === normalizeKpiStartTime(existingRec) ? rec : r
          )
        : [
            rec,
            ...userKpi.filter((r) => !(r.date === rec.date && normalizeKpiStartTime(r) === normalizeKpiStartTime(rec))),
          ];
      await onSave(userId, rec, next);
      onClose();
    } catch {
      /* onSave がトースト等で通知 */
    } finally {
      setKpiSaveBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-4"
      onClick={() => {
        if (kpiSaveBusy) return;
        onClose();
      }}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-sm font-semibold text-slate-800">
          {targetIsIntern ? "商談確定数入力（管理者・インターン）" : "KPI入力（管理者）"}
        </h3>
        <p className="mb-4 text-xs text-slate-600">
          {target.memberName}（{formatDisplayDate(kpiDate)}）
          {targetIsIntern ? (
            <span className="mt-1 block font-medium text-violet-800">
              インターン生は管理者確定の商談数のみが評価・請求の対象です（コール数・アポ数は入力しません）。
            </span>
          ) : null}
        </p>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">対象日</label>
            <input
              type="date"
              value={kpiDate}
              onChange={(e) => setKpiDate(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
            />
            {isWeekendYmdJst(kpiDate) && (
              <p className="mt-1 text-xs font-medium text-amber-800">{JST_WEEKEND_WORK_REJECTED_MESSAGE}</p>
            )}
          </div>
          {!targetIsIntern ? (
            <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
              {KPI_LABELS.map(({ key, label, callSystemHint }) => (
                <div key={key} className="flex min-w-0 flex-col gap-1.5">
                  <label className="text-sm font-medium text-slate-700">{label}</label>
                  {callSystemHint ? (
                    <p className="text-[11px] leading-snug text-slate-500 sm:text-xs">{callSystemHint}</p>
                  ) : null}
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    placeholder="0"
                    value={kpiFields[key]}
                    onChange={(e) =>
                      setKpiFields((prev) => ({
                        ...prev,
                        [key]: sanitizeKpiNumericInput(e.target.value),
                      }))
                    }
                    onFocus={handleKpiNumberInputFocus}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                  />
                </div>
              ))}
            </div>
          ) : null}
          <div
            className={`rounded-lg border p-3 ${targetIsIntern ? "border-violet-300 bg-violet-50" : "border-violet-200 bg-violet-50/50"}`}
          >
            <p className="mb-2 text-xs font-semibold text-violet-900">
              {targetIsIntern ? "商談確定数（評価・請求の唯一の入力項目）" : "管理者確定（成果報酬・請求用）"}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-slate-700">決裁者商談確定数</label>
                <input type="number" min={0} inputMode="numeric" placeholder="0" value={confirmedDm}
                  onChange={(e) => setConfirmedDm(sanitizeKpiNumericInput(e.target.value))}
                  onFocus={handleKpiNumberInputFocus}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800" />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">非決裁者商談確定数</label>
                <input type="number" min={0} inputMode="numeric" placeholder="0" value={confirmedNdm}
                  onChange={(e) => setConfirmedNdm(sanitizeKpiNumericInput(e.target.value))}
                  onFocus={handleKpiNumberInputFocus}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800" />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <button
              type="submit"
              disabled={kpiSaveBusy || isWeekendYmdJst(kpiDate)}
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {kpiSaveBusy ? "保存中…" : "保存"}
            </button>
            <button
              type="button"
              disabled={kpiSaveBusy}
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              キャンセル
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AdminDashboard(props: {
  isAdminUser: boolean;
  adminLoginAccount: string;
  allRecords: WorkRecord[];
  allOpenRecords: OpenRecord[];
  allShifts: Shift[];
  allKpiRecords: KpiRecord[];
  members: Member[];
  setMembers: (v: Member[] | ((prev: Member[]) => Member[])) => void;
  onRefresh: () => void;
  onSaveMemberRecords: (memberId: string, records: WorkRecord[]) => Promise<void>;
  onSaveMemberShifts: (memberId: string, shifts: Shift[]) => Promise<void>;
  /** 管理者による KPI 代理保存（saveKpiForUser 経由で upsert） */
  onSaveMemberKpi: (memberId: string, savedDay: KpiRecord, nextForUser: KpiRecord[]) => Promise<void>;
  planActualGapApprovedKeys: Set<string>;
  planActualGapResolutionByKey: Map<string, PlanActualGapResolution | null>;
  onResolvePlanActualGap: (userId: string, date: string, mode: PlanActualGapResolution) => Promise<void>;
  /** 予実調整の「手動で時間を編集」（管理者のみ UI 表示） */
  onApplyManualPlanActualGap?: (
    userId: string,
    date: string,
    input: { startHhmm: string; endHhmm: string; breakMinutes: number }
  ) => Promise<void>;
  deepLinkMemberId?: string;
  onAdminDeepLinkConsumed?: () => void;
}) {
  const {
    isAdminUser,
    adminLoginAccount,
    allRecords,
    allOpenRecords,
    allShifts,
    allKpiRecords,
    members,
    setMembers,
    onRefresh,
    onSaveMemberRecords,
    onSaveMemberShifts,
    onSaveMemberKpi,
    planActualGapApprovedKeys,
    planActualGapResolutionByKey,
    onResolvePlanActualGap,
    onApplyManualPlanActualGap,
    deepLinkMemberId,
    onAdminDeepLinkConsumed,
  } = props;
  const [adminSection, setAdminSection] = useState<AdminSection>("dashboard");
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberLogin, setNewMemberLogin] = useState("");
  const [newMemberPassword, setNewMemberPassword] = useState("12345");
  const [newMemberHourlyRate, setNewMemberHourlyRate] = useState(DEFAULT_HOURLY_RATE);
  const [newMemberFieldErrors, setNewMemberFieldErrors] = useState<{
    name?: string;
    login?: string;
    password?: string;
    form?: string;
  } | null>(null);
  const [newMemberAdding, setNewMemberAdding] = useState(false);
  const [memberDetailSaveError, setMemberDetailSaveError] = useState<string | null>(null);
  const [invoiceSaveHint, setInvoiceSaveHint] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editLogin, setEditLogin] = useState("");
  const [editPass, setEditPass] = useState("");
  const [editRate, setEditRate] = useState(DEFAULT_HOURLY_RATE);
  const [editPostalCode, setEditPostalCode] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editBankName, setEditBankName] = useState("");
  const [editBranchName, setEditBranchName] = useState("");
  const [editAccountType, setEditAccountType] = useState("普通");
  const [editAccountNumber, setEditAccountNumber] = useState("");
  const [editAccountHolder, setEditAccountHolder] = useState("");
  const [editInvoiceNumber, setEditInvoiceNumber] = useState("");
  const [editInvoiceRegistrationNumber, setEditInvoiceRegistrationNumber] = useState("");
  const [editPhoneNumber, setEditPhoneNumber] = useState("");
  const [editFirstWorkDate, setEditFirstWorkDate] = useState("");
  const [editInternRateDm, setEditInternRateDm] = useState(INTERN_RATE_DECISION_MAKER_APPS);
  const [editInternRateNdm, setEditInternRateNdm] = useState(INTERN_RATE_NON_DECISION_MAKER_APPS);
  const [morningBulkSelectedIds, setMorningBulkSelectedIds] = useState<string[]>([]);
  const [morningBulkBusy, setMorningBulkBusy] = useState(false);
  const [morningRowBusyId, setMorningRowBusyId] = useState<string | null>(null);
  const [internRowBusyId, setInternRowBusyId] = useState<string | null>(null);
  const [confirmedSaveBusyKey, setConfirmedSaveBusyKey] = useState<string | null>(null);
  const [invoiceBulkMonth, setInvoiceBulkMonth] = useState(() => getLastMonthString());
  const [invoiceZipSelectedIds, setInvoiceZipSelectedIds] = useState<string[]>([]);
  const [invoiceZipBusy, setInvoiceZipBusy] = useState(false);
  const [invoiceBulkSectionOpen, setInvoiceBulkSectionOpen] = useState(false);
  const [adminKpiModalTarget, setAdminKpiModalTarget] = useState<AdminKpiModalTarget | null>(null);
  const [hourlyRateRowBusyId, setHourlyRateRowBusyId] = useState<string | null>(null);
  const [internRateRowBusyKey, setInternRateRowBusyKey] = useState<string | null>(null);
  const [kpiDate, setKpiDate] = useState(() => getTodayJstDateString());
  const [dashboardDate, setDashboardDate] = useState(() => getTodayJstDateString());
  const [internConfirmedPanelDate, setInternConfirmedPanelDate] = useState(() => getTodayJstDateString());
  const [internConfirmedSearch, setInternConfirmedSearch] = useState("");
  const [internConfirmedSort, setInternConfirmedSort] = useState<AdminTableSortState<InternConfirmedPanelSortKey>>(null);
  const [backupExpanded, setBackupExpanded] = useState(false);
  const [rangeStart, setRangeStart] = useState(() => getThisWeekMondayDateString());
  const [rangeEnd, setRangeEnd] = useState(() => getTodayJstDateString());
  const [dailyActualStart, setDailyActualStart] = useState(() => {
    const t = getTodayJstDateString();
    return getMonthDateRange(t.slice(0, 7), t).start;
  });
  const [dailyActualEnd, setDailyActualEnd] = useState(() => {
    const t = getTodayJstDateString();
    return getMonthDateRange(t.slice(0, 7), t).end;
  });
  const [gapStart, setGapStart] = useState("");
  const [gapEnd, setGapEnd] = useState("");
  const [gapSearch, setGapSearch] = useState("");
  const [gapPage, setGapPage] = useState(1);
  const [gapMonthQuick, setGapMonthQuick] = useState("");
  const [gapRangeBootstrapped, setGapRangeBootstrapped] = useState(false);
  const gapPageSize = 50;
  const [reportMember, setReportMember] = useState<Member | null>(null);
  const [reportMonth, setReportMonth] = useState(() => getLastMonthString());
  const [recordFormMember, setRecordFormMember] = useState<Member | null>(null);
  const [recordFormRecord, setRecordFormRecord] = useState<WorkRecord | null>(null);
  const [recordFormSaving, setRecordFormSaving] = useState(false);
  const [recordDeletingId, setRecordDeletingId] = useState<string | null>(null);
  const [recordActivityToast, setRecordActivityToast] = useState<{ message: string; isError: boolean } | null>(null);
  const [recordFormDate, setRecordFormDate] = useState(() => getTodayJstDateString());
  const [recordFormStart, setRecordFormStart] = useState("09:00");
  const [recordFormEnd, setRecordFormEnd] = useState("18:00");
  const [recordListMemberId, setRecordListMemberId] = useState<string | null>(null);
  const attendanceRecordEditorRef = useRef<HTMLDivElement>(null);
  const [shiftEditMember, setShiftEditMember] = useState<Member | null>(null);
  const [shiftWeekForm, setShiftWeekForm] = useState<Record<string, { s1: string; e1: string; s2: string; e2: string }>>({});
  const [shiftViewStart, setShiftViewStart] = useState(() =>
    getMondayOfCalendarWeekContaining(getTodayJstDateString())
  );
  const [shiftViewEnd, setShiftViewEnd] = useState(() => {
    const mon = getMondayOfCalendarWeekContaining(getTodayJstDateString());
    return getWeekDates(mon)[6];
  });
  const [productivityPeriodKey, setProductivityPeriodKey] = useState("this_week");
  const [slackTestSending, setSlackTestSending] = useState(false);
  const [slackDailyTestDate, setSlackDailyTestDate] = useState(() => getTodayJstDateString());
  const [slackTestFeedback, setSlackTestFeedback] = useState<{
    message: string;
    variant: "success" | "error" | "info";
  } | null>(null);
  const [productivitySlackTestMemberId, setProductivitySlackTestMemberId] = useState("");
  const [productivitySlackTestDate, setProductivitySlackTestDate] = useState(() => getTodayJstDateString());
  const [productivitySlackTestForce, setProductivitySlackTestForce] = useState(false);
  const [productivitySlackTestSending, setProductivitySlackTestSending] = useState(false);
  const [productivitySlackTestFeedback, setProductivitySlackTestFeedback] = useState<{
    message: string;
    variant: "success" | "error" | "info";
  } | null>(null);
  const [shiftRemindTestSending, setShiftRemindTestSending] = useState(false);
  const [shiftRemindTestFeedback, setShiftRemindTestFeedback] = useState<{
    message: string;
    variant: "success" | "error" | "info";
  } | null>(null);
  const [slackManualReportSending, setSlackManualReportSending] = useState(false);
  const [roiSlackToast, setRoiSlackToast] = useState<{ message: string; isError: boolean } | null>(null);
  const [gapApprovalBusy, setGapApprovalBusy] = useState(false);
  const [gapActionToast, setGapActionToast] = useState<{ message: string; isError: boolean } | null>(null);
  const [gapManualEditor, setGapManualEditor] = useState<null | {
    key: string;
    userId: string;
    date: string;
    start: string;
    end: string;
    breakMin: string;
  }>(null);
  const [roiYearMonth, setRoiYearMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [roiStartDate, setRoiStartDate] = useState(() => {
    const d = new Date();
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return getMonthDateRange(ym, getTodayJstDateString()).start;
  });
  const [roiEndDate, setRoiEndDate] = useState(() => {
    const d = new Date();
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return getMonthDateRange(ym, getTodayJstDateString()).end;
  });
  /** 生産性 CSV 出力の期間（ROI とは独立して指定可能） */
  const [peStartDate, setPeStartDate] = useState(() => {
    const d = new Date();
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return getMonthDateRange(ym, getTodayJstDateString()).start;
  });
  const [peEndDate, setPeEndDate] = useState(() => {
    const d = new Date();
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return getMonthDateRange(ym, getTodayJstDateString()).end;
  });
  /** ROI 対象メンバー。null ＝ 全員、配列 ＝ 指定IDのみ（空配列は誰も含めない） */
  const [roiSelectedMemberIds, setRoiSelectedMemberIds] = useState<string[] | null>(null);
  /** 業務委託KPI 列ソート。null ＝ メンバー一覧の元の順。初期は決アポ数の多い順 */
  const [kpiOutsourceSort, setKpiOutsourceSort] = useState<KpiOutsourceTableSort>({
    key: "decisionApo",
    dir: "desc",
  });

  const currentYearMonth = getTodayJstDateString().slice(0, 7);
  const todayStr = getTodayJstDateString();
  const activeMembers = members.filter((mem) => mem.isActive !== false);
  const [adminMemberTableSort, setAdminMemberTableSort] = useState<{
    key: AdminMemberTableSortKey;
    dir: "asc" | "desc";
  } | null>(null);
  const sortedRowsForAdminMemberSettingsTable = useMemo(() => {
    const rows = activeMembers.map((mem) => {
      const monthMin = getTotalMinutesForMonthByUser(allRecords, mem.id, currentYearMonth);
      const pay = calcMemberMonthlyPayYen(mem, monthMin, allKpiRecords, currentYearMonth, DEFAULT_HOURLY_RATE);
      const invDisplay = formatMemberInvoiceNumberThreeDigits(mem.invoiceNumber);
      const invNum = invDisplay != null ? parseInt(invDisplay, 10) : null;
      return { mem, monthMin, pay, invDisplay, invNum };
    });
    if (!adminMemberTableSort) return rows;
    const { key, dir } = adminMemberTableSort;
    rows.sort((ra, rb) => {
      const a = ra.mem;
      const b = rb.mem;
      if (key === "invoice") {
        if (ra.invNum == null && rb.invNum == null) {
          /* tie-break */
        } else if (ra.invNum == null) return 1;
        else if (rb.invNum == null) return -1;
        else {
          const c = ra.invNum - rb.invNum;
          if (c !== 0) return dir === "asc" ? c : -c;
        }
      } else if (key === "name") {
        const c = a.name.localeCompare(b.name, "ja");
        if (c !== 0) return dir === "asc" ? c : -c;
      } else if (key === "minutes") {
        const c = ra.monthMin - rb.monthMin;
        if (c !== 0) return dir === "asc" ? c : -c;
      } else if (key === "pay") {
        const c = ra.pay - rb.pay;
        if (c !== 0) return dir === "asc" ? c : -c;
      } else if (key === "morning") {
        const av = a.canWorkMorning === true ? 1 : 0;
        const bv = b.canWorkMorning === true ? 1 : 0;
        const c = av - bv;
        if (c !== 0) return dir === "asc" ? c : -c;
      } else if (key === "intern") {
        const av = a.isIntern === true ? 1 : 0;
        const bv = b.isIntern === true ? 1 : 0;
        const c = av - bv;
        if (c !== 0) return dir === "asc" ? c : -c;
      }
      return a.name.localeCompare(b.name, "ja");
    });
    return rows;
  }, [activeMembers, allRecords, allKpiRecords, currentYearMonth, adminMemberTableSort]);
  const toggleAdminMemberTableSort = useCallback((nextKey: AdminMemberTableSortKey) => {
    setAdminMemberTableSort((prev) => {
      if (!prev || prev.key !== nextKey) {
        const firstDir: Record<AdminMemberTableSortKey, "asc" | "desc"> = {
          morning: "desc",
          intern: "desc",
          invoice: "asc",
          name: "asc",
          minutes: "desc",
          pay: "desc",
        };
        return { key: nextKey, dir: firstDir[nextKey] };
      }
      return { key: nextKey, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  }, []);

  type AttendanceTodaySortKey = "name" | "status" | "minutes";
  type ShiftScheduleSortState =
    | { column: "name"; dir: "asc" | "desc" }
    | { column: "date"; dateStr: string; dir: "asc" | "desc" }
    | null;

  const [attendanceTodaySort, setAttendanceTodaySort] = useState<AdminTableSortState<AttendanceTodaySortKey> | null>(null);
  const [shiftScheduleSort, setShiftScheduleSort] = useState<ShiftScheduleSortState>(null);
  const [kpiDailySort, setKpiDailySort] = useState<AdminTableSortState<AdminKpiDailySortKey> | null>(null);
  const [adminDailyActualSort, setAdminDailyActualSort] = useState<
    Partial<Record<string, AdminTableSortState<DailyActualSortKey>>>
  >({});

  const toggleAttendanceTodaySort = useCallback((key: AttendanceTodaySortKey) => {
    setAttendanceTodaySort((prev) => cycleAdminTableSort(prev, key));
  }, []);

  const toggleShiftScheduleSort = useCallback((kind: "name" | "date", dateStr?: string) => {
    setShiftScheduleSort((prev) => {
      if (kind === "name") {
        if (prev?.column !== "name") return { column: "name", dir: "desc" };
        if (prev.dir === "desc") return { column: "name", dir: "asc" };
        return null;
      }
      const ds = dateStr ?? "";
      if (prev?.column === "date" && prev.dateStr === ds) {
        if (prev.dir === "desc") return { column: "date", dateStr: ds, dir: "asc" };
        return null;
      }
      return { column: "date", dateStr: ds, dir: "desc" };
    });
  }, []);

  const toggleKpiDailySort = useCallback((key: AdminKpiDailySortKey) => {
    setKpiDailySort((prev) => cycleAdminTableSort(prev, key));
  }, []);

  const toggleDailyActualSort = useCallback((dateStr: string, key: DailyActualSortKey) => {
    setAdminDailyActualSort((prev) => {
      const cur = prev[dateStr] ?? null;
      const next = cycleAdminTableSort(cur, key);
      if (next == null) {
        const { [dateStr]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [dateStr]: next };
    });
  }, []);

  const productivitySlackTestCandidates = useMemo(
    () => activeMembers.filter((m) => (m.loginAccount ?? "").toLowerCase() !== "admin"),
    [activeMembers]
  );
  const todayPlannedShiftList = useMemo(
    () => buildPlannedShiftListForDate(allShifts, todayStr, activeMembers),
    [allShifts, todayStr, activeMembers]
  );

  const attendanceStatusRows = useMemo(
    () =>
      activeMembers.map((mem) => {
        const open = getOpenRecordForUser(allOpenRecords, mem.id);
        const userRecords = getRecordsForUser(allRecords, mem.id);
        const todayMin = userRecords.filter((r) => r.date === todayStr).reduce((s, r) => s + r.durationMinutes, 0);
        return { mem, open: !!open, todayMin };
      }),
    [activeMembers, allOpenRecords, allRecords, todayStr]
  );

  const sortedAttendanceStatusRows = useMemo(() => {
    const rows = [...attendanceStatusRows];
    if (!attendanceTodaySort) return rows;
    const { key, dir } = attendanceTodaySort;
    const desc = dir === "desc";
    const m = desc ? -1 : 1;
    rows.sort((a, b) => {
      const tie = () => a.mem.name.localeCompare(b.mem.name, "ja");
      if (key === "name") return m * a.mem.name.localeCompare(b.mem.name, "ja");
      if (key === "status") {
        const sa = a.open ? 1 : 0;
        const sb = b.open ? 1 : 0;
        if (sa !== sb) return m * (sa - sb);
        return tie();
      }
      if (key === "minutes") {
        if (a.todayMin !== b.todayMin) return m * (a.todayMin - b.todayMin);
        return tie();
      }
      return tie();
    });
    return rows;
  }, [attendanceStatusRows, attendanceTodaySort]);

  const gapDataEarliest = useMemo(
    () => earliestPlanActualDataDate(allShifts, allRecords, allKpiRecords, todayStr),
    [allShifts, allRecords, allKpiRecords, todayStr]
  );

  useEffect(() => {
    if (gapRangeBootstrapped) return;
    setGapEnd(todayStr);
    setGapStart(gapDataEarliest);
    setGapRangeBootstrapped(true);
  }, [gapDataEarliest, todayStr, gapRangeBootstrapped]);

  useEffect(() => {
    const ids = productivitySlackTestCandidates.map((m) => m.id);
    if (ids.length === 0) {
      setProductivitySlackTestMemberId("");
      return;
    }
    if (productivitySlackTestMemberId && ids.includes(productivitySlackTestMemberId)) return;
    setProductivitySlackTestMemberId(ids[0] ?? "");
  }, [productivitySlackTestCandidates, productivitySlackTestMemberId]);

  const gapAllRows = useMemo(
    () =>
      gapStart && gapEnd
        ? buildPlanActualGapRows(members, allShifts, allRecords, allKpiRecords, gapStart, gapEnd, {
            openRecords: allOpenRecords,
          })
        : [],
    [members, allShifts, allRecords, allKpiRecords, allOpenRecords, gapStart, gapEnd]
  );

  const gapFiltered = useMemo(() => filterPlanActualGapRows(gapAllRows, gapSearch), [gapAllRows, gapSearch]);

  useEffect(() => {
    setGapPage(1);
  }, [gapStart, gapEnd, gapSearch]);

  const gapTotalPages = Math.max(1, Math.ceil(gapFiltered.length / gapPageSize));
  const gapPageClamped = Math.min(gapPage, gapTotalPages);
  const gapPageRows = useMemo(() => {
    const from = (gapPageClamped - 1) * gapPageSize;
    return gapFiltered.slice(from, from + gapPageSize);
  }, [gapFiltered, gapPageClamped, gapPageSize]);

  const handleResolvePlanActualGapRow = async (userId: string, date: string, mode: PlanActualGapResolution) => {
    setGapApprovalBusy(true);
    try {
      await onResolvePlanActualGap(userId, date, mode);
    } finally {
      setGapApprovalBusy(false);
    }
  };

  function localHhmmFromAttendanceIso(iso: string): string {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function normalizeTimeInputValue(hhmm: string): string {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (!m) return "09:00";
    const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }

  const toggleGapManualEditor = (r: PlanActualGapRow) => {
    if (!onApplyManualPlanActualGap || !isAdminUser) return;
    const key = planActualGapApprovalKey(r.userId, r.date);
    if (gapManualEditor?.key === key) {
      setGapManualEditor(null);
      return;
    }
    const dayRecs = getRecordsForUserAndDate(allRecords, r.userId, r.date).sort((a, b) =>
      a.startRounded.localeCompare(b.startRounded)
    );
    let start = "09:00";
    let end = "18:00";
    if (dayRecs.length > 0) {
      start = localHhmmFromAttendanceIso(dayRecs[0].startRounded);
      end = localHhmmFromAttendanceIso(dayRecs[dayRecs.length - 1].endRounded);
    } else {
      const sh = canonicalShiftForUserDate(allShifts, r.userId, r.date);
      const slots = sh ? getConcretePlannedSlots(sh) : [];
      if (slots.length > 0) {
        start = slots[0].start;
        end = slots[0].end;
      }
    }
    setGapManualEditor({
      key,
      userId: r.userId,
      date: r.date,
      start: normalizeTimeInputValue(start),
      end: normalizeTimeInputValue(end),
      breakMin: "0",
    });
  };

  const handleGapManualSave = async () => {
    if (!gapManualEditor || !onApplyManualPlanActualGap) return;
    setGapApprovalBusy(true);
    setGapActionToast(null);
    try {
      const br = Math.max(0, Number.parseInt(gapManualEditor.breakMin, 10) || 0);
      await onApplyManualPlanActualGap(gapManualEditor.userId, gapManualEditor.date, {
        startHhmm: normalizeTimeInputValue(gapManualEditor.start),
        endHhmm: normalizeTimeInputValue(gapManualEditor.end),
        breakMinutes: br,
      });
      setGapManualEditor(null);
      setGapActionToast({ message: "手動確定を保存しました。", isError: false });
    } catch (e) {
      setGapActionToast({
        message: e instanceof Error ? e.message : String(e),
        isError: true,
      });
    } finally {
      setGapApprovalBusy(false);
    }
  };

  const archivedMembers = members.filter((mem) => mem.isActive === false);

  const thisWeekMonday = getThisWeekMondayDateString();

  const lastMonthYearMonth = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();

  const productivityPeriodOptions: { key: string; label: string; start: string; end: string; isMonth: boolean; monthLabel?: string }[] = [
    { key: "this_week", label: "今週（月〜現在）", start: thisWeekMonday, end: todayStr, isMonth: false },
    {
      key: "last_week",
      label: "先週（月〜日）",
      start: addWeeksToWeekStart(thisWeekMonday, -1),
      end: getWeekDates(addWeeksToWeekStart(thisWeekMonday, -1))[6],
      isMonth: false,
    },
    ...([2, 3, 4, 5].map((i) => {
      const mon = addWeeksToWeekStart(thisWeekMonday, -i);
      const dates = getWeekDates(mon);
      return { key: `week_${i}`, label: formatPeriodLabel(mon, dates[6]), start: mon, end: dates[6], isMonth: false };
    })),
    { key: "this_month", label: "今月（1日〜現在）", start: `${currentYearMonth}-01`, end: todayStr, isMonth: true, monthLabel: currentYearMonth },
    { key: "last_month", label: "先月（1日〜末日）", start: `${lastMonthYearMonth}-01`, end: getLastDayOfMonth(lastMonthYearMonth), isMonth: true, monthLabel: lastMonthYearMonth },
  ];

  const selectedProductivityPeriod = productivityPeriodOptions.find((p) => p.key === productivityPeriodKey) ?? productivityPeriodOptions[0];
  const rangeKpisForProductivity = getKpiInDateRange(allKpiRecords, selectedProductivityPeriod.start, selectedProductivityPeriod.end);
  const rangeTotalsForProductivity = getKpiTotalsFromRecords(rangeKpisForProductivity);
  const rangeMinutesForProductivity = allRecords
    .filter((r) => r.date >= selectedProductivityPeriod.start && r.date <= selectedProductivityPeriod.end)
    .reduce((s, r) => s + r.durationMinutes, 0);
  const rangeApoCostMinutes =
    rangeTotalsForProductivity.decisionMakerApo > 0 ? rangeMinutesForProductivity / rangeTotalsForProductivity.decisionMakerApo : null;

  // ダッシュボード表示日付に基づく集計（Supabase kpis / attendance / open_records を日付でフィルタ）
  const dateKpis = allKpiRecords.filter((k) => k.date === dashboardDate);
  const dateDecision = dateKpis.reduce((s, k) => s + k.decisionMakerApo, 0);
  const dateNonDecision = dateKpis.reduce((s, k) => s + k.nonDecisionMakerApo, 0);
  // 選択日の「業務開始」活動記録が1回でもあるメンバー数（完了した記録 or 未終了の記録のいずれか）
  const userIdsFromAttendance = allRecords.filter((r) => r.date === dashboardDate).map((r) => r.userId);
  const userIdsFromOpen = allOpenRecords.filter((r) => r.date === dashboardDate).map((r) => r.userId);
  const workingCountForDate = new Set([...userIdsFromAttendance, ...userIdsFromOpen]).size;
  const dateTeamMinutes = allRecords.filter((r) => r.date === dashboardDate).reduce((s, r) => s + r.durationMinutes, 0);
  const dateApoCostMinutes = dateDecision > 0 ? dateTeamMinutes / dateDecision : null;
  // 決裁者アポまたは非決裁者アポが1件以上あるメンバーのみ、決裁者アポ多い順
  const apoListForDate = activeMembers
    .map((mem) => {
      const k = getKpiForDate(getKpiForUser(allKpiRecords, mem.id), dashboardDate);
      const dec = k ? k.decisionMakerApo : 0;
      const non = k ? k.nonDecisionMakerApo : 0;
      return { mem, dec, non };
    })
    .filter(({ dec, non }) => dec >= 1 || non >= 1)
    .sort((a, b) => b.dec - a.dec);

  // 振込先情報が未登録のメンバー（銀行名・支店名・口座番号・口座名義の主要4項目を trim して判定し、4つ揃っていれば入力済みとする）
  const trimVal = (v: string | number | null | undefined) => (v == null ? "" : String(v).trim());
  const hasKeyBankInfo = (m: Member) =>
    trimVal(m.bankName) !== "" &&
    trimVal(m.branchName) !== "" &&
    trimVal(m.accountNumber) !== "" &&
    trimVal(m.accountHolder) !== "";
  const membersWithMissingBankInfo = activeMembers.filter((m) => !hasKeyBankInfo(m));
  const membersWithMissingInvoiceNumber = getActiveMembersMissingInvoiceNumber(members);

  /** ダッシュボード用：過去7日の予実乖離アーカイブ相当のうち、まだ予実確定していない件数（詳細画面の件数と一致） */
  const last7DaysForPlanActualGap = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addCalendarDays(todayStr, -6 + i)),
    [todayStr]
  );
  const planActualGapRowsLast7 = useMemo(
    () =>
      buildPlanActualGapRows(
        members,
        allShifts,
        allRecords,
        allKpiRecords,
        last7DaysForPlanActualGap[0],
        last7DaysForPlanActualGap[6],
        { openRecords: allOpenRecords }
      ),
    [members, allShifts, allRecords, allKpiRecords, allOpenRecords, last7DaysForPlanActualGap]
  );
  const unapprovedPlanActualGapCount = planActualGapRowsLast7.filter(
    (r) => !planActualGapApprovedKeys.has(planActualGapApprovalKey(r.userId, r.date))
  ).length;

  const handleAdd = async () => {
    setNewMemberFieldErrors(null);
    if (!newMemberName.trim()) {
      setNewMemberFieldErrors({ name: "名前を入力してください。" });
      return;
    }
    setNewMemberAdding(true);
    try {
      await addMember(newMemberName.trim(), {
        loginAccount: newMemberLogin.trim(),
        password: newMemberPassword,
        hourlyRate: newMemberHourlyRate >= 0 ? newMemberHourlyRate : DEFAULT_HOURLY_RATE,
      });
      const mems = await loadMembers();
      setMembers(mems ?? []);
      setNewMemberName("");
      setNewMemberLogin("");
      setNewMemberPassword("12345");
      setNewMemberHourlyRate(DEFAULT_HOURLY_RATE);
      setNewMemberFieldErrors(null);
      onRefresh();
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error("メンバー追加エラー:", e);
      if (reason.includes("ログインID")) {
        setNewMemberFieldErrors({ login: reason });
      } else {
        setNewMemberFieldErrors({ form: `追加に失敗しました：${reason}` });
      }
    } finally {
      setNewMemberAdding(false);
    }
  };

  const handleSlackTestSend = async () => {
    setSlackTestFeedback(null);
    const dateArg = slackDailyTestDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
      setSlackTestFeedback({
        message: "テスト送信する日付を YYYY-MM-DD で選んでください。",
        variant: "error",
      });
      return;
    }
    setSlackTestSending(true);
    try {
      const { slackDailyTestAction } = await import("@/app/actions/slack-daily");
      const data = await slackDailyTestAction(dateArg);
      if (data.ok) {
        if (data.skipped && data.skipReason === "weekend") {
          setSlackTestFeedback({
            message:
              "スキップされました：想定外です（テストは通常土日も送信します）。サポートに連絡するか、環境を確認してください。",
            variant: "info",
          });
        } else {
          const dateLine = data.date ? `対象日: ${data.date}` : "";
          const weekendNote = data.weekendTestSend
            ? "\n※本日は土曜または日曜です。自動の Cron ではこの日は送信をスキップしますが、テストでは送信しました。"
            : "";
          setSlackTestFeedback({
            message: `送信成功。${dateLine}\nSlack から成功応答（ok）を受け取りました。チャンネルを確認してください。${weekendNote}`,
            variant: "success",
          });
        }
      } else {
        const err = data.error ?? "エラー";
        const det = data.detail?.trim();
        setSlackTestFeedback({
          message: det ? `${err}\n\n詳細: ${det}` : err,
          variant: "error",
        });
      }
    } catch (e) {
      setSlackTestFeedback({
        message: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
    } finally {
      setSlackTestSending(false);
    }
  };

  const handleProductivitySlackTest = async () => {
    setProductivitySlackTestFeedback(null);
    if (!productivitySlackTestMemberId.trim()) {
      setProductivitySlackTestFeedback({ message: "メンバーを選択してください。", variant: "error" });
      return;
    }
    const d = productivitySlackTestDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      setProductivitySlackTestFeedback({ message: "日付を YYYY-MM-DD で選んでください。", variant: "error" });
      return;
    }
    setProductivitySlackTestSending(true);
    try {
      const { runKpiProductivityAlertAdminTestAction } = await import("@/app/actions/kpi-productivity-alert");
      const data = await runKpiProductivityAlertAdminTestAction({
        memberId: productivitySlackTestMemberId,
        date: d,
        forceSend: productivitySlackTestForce,
      });
      if (!data.ok) {
        const det = data.detail?.trim();
        setProductivitySlackTestFeedback({
          message: det ? `${data.error}\n\n詳細: ${det}` : data.error,
          variant: "error",
        });
        return;
      }
      const stats = `検算: 実稼働約 ${data.workHours.toFixed(2)}h / 有効コール ${data.validCalls} 件 / 基準 ${data.expectedCallsLabel} 件 / 閾値未満=${data.belowThreshold ? "はい" : "いいえ"}`;
      if (data.notified) {
        setProductivitySlackTestFeedback({
          message: `Slack に生産性低下アラート（1時間あたり有効コール10件基準）を送信しました。\n対象日: ${d}\n${stats}`,
          variant: "success",
        });
      } else if (data.skipped) {
        const reason =
          data.skipReason === "no_work_hours"
            ? "この日の打刻（実稼働）がないため、本番と同じ条件では送信しません。"
            : data.skipReason === "not_below_threshold"
              ? "有効コール数が基準（稼働時間×10）を満たしているため送信しませんでした。"
              : data.skipReason === "no_webhook"
                ? "Webhook が未設定のため送信しませんでした。"
                : "送信しませんでした。";
        setProductivitySlackTestFeedback({
          message: `${reason}\n${stats}\n\n「閾値に関係なく送信」をオンにすると、メンション含めた見え方を確認できます。`,
          variant: "info",
        });
      } else {
        setProductivitySlackTestFeedback({ message: `完了しました。\n${stats}`, variant: "info" });
      }
    } catch (e) {
      setProductivitySlackTestFeedback({
        message: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
    } finally {
      setProductivitySlackTestSending(false);
    }
  };

  const handleShiftRemindTestSend = async () => {
    setShiftRemindTestFeedback(null);
    setShiftRemindTestSending(true);
    try {
      let loginId = slackAdminAuthMemory.current?.loginId ?? "";
      let password = slackAdminAuthMemory.current?.password ?? "";
      if (!loginId || !password) {
        const fallbackId = adminLoginAccount.trim();
        if (!fallbackId) {
          alert("ログイン情報を確認できません。一度ログアウトして再ログインしてください。");
          return;
        }
        const p = window.prompt("催促通知を送るため、管理者のパスワードを入力してください");
        if (p == null || p === "") {
          alert("キャンセルしました。");
          return;
        }
        loginId = fallbackId;
        password = p;
      }
      const { remindUnsubmittedShiftTestAction } = await import("@/app/actions/remind-unsubmitted-shift");
      const data = await remindUnsubmittedShiftTestAction({ adminLoginId: loginId, adminPassword: password });
      if (!data.ok) {
        const err = data.error ?? "エラー";
        const det = data.detail?.trim();
        setShiftRemindTestFeedback({
          message: det ? `${err}\n\n詳細: ${det}` : err,
          variant: "error",
        });
        return;
      }
      if (!data.sent) {
        setShiftRemindTestFeedback({
          message: `送信スキップ：翌週（${data.rangeStart} 〜 ${data.rangeEnd}）の期間に、シフト未入力のメンバーはいませんでした。\nSlack には何も送っていません。（テストは曜日・時刻に関係なく、この瞬間のデータで判定しています）`,
          variant: "info",
        });
      } else {
        setShiftRemindTestFeedback({
          message: `送信成功：${data.count}名を対象に Slack に催促を送り、成功応答を受け取りました。\n対象週（翌週）: ${data.rangeStart} 〜 ${data.rangeEnd}\n※テストは Cron のスケジュールに依存せず即時実行です。`,
          variant: "success",
        });
      }
    } catch (e) {
      setShiftRemindTestFeedback({
        message: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
    } finally {
      setShiftRemindTestSending(false);
    }
  };

  const openDetail = (member: Member) => {
    setMemberDetailSaveError(null);
    setInvoiceSaveHint(null);
    setDetailId(member.id);
    setEditName(member.name);
    setEditLogin(member.loginAccount ?? "");
    setEditPass("");
    setEditRate(member.hourlyRate ?? DEFAULT_HOURLY_RATE);
    setEditPostalCode(member.postalCode ?? "");
    setEditAddress(member.address ?? "");
    setEditBankName(member.bankName ?? "");
    setEditBranchName(member.branchName ?? "");
    setEditAccountType(member.accountType ?? "普通");
    setEditAccountNumber(member.accountNumber ?? "");
    setEditAccountHolder(member.accountHolder ?? "");
    setEditInvoiceNumber(member.invoiceNumber ?? "");
    setEditInvoiceRegistrationNumber(member.invoiceRegistrationNumber ?? "");
    setEditPhoneNumber(member.phoneNumber ?? "");
    setEditFirstWorkDate(member.firstWorkDate ?? "");
    const internRates = getInternUnitRates(member);
    setEditInternRateDm(internRates.decisionMaker);
    setEditInternRateNdm(internRates.nonDecisionMaker);
  };

  const openReport = (member: Member) => {
    setReportMember(member);
    setReportMonth(getLastMonthString());
  };

  const adminPdfSelectableMonthMax = getTodayJstDateString().slice(0, 7);

  const handleDownloadCombinedPdfAdmin = async () => {
    if (!reportMember) return;
    const effectiveMonth = reportMonth > adminPdfSelectableMonthMax ? adminPdfSelectableMonthMax : reportMonth;
    setMemberDetailSaveError(null);
    try {
      const blob = await renderMemberCombinedPdfBlob(reportMember, effectiveMonth, allRecords, allKpiRecords);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = buildInvoiceCombinedPdfFileName(reportMember, effectiveMonth);
      a.click();
      URL.revokeObjectURL(url);
      setReportMember(null);
    } catch (e) {
      setMemberDetailSaveError(e instanceof Error ? e.message : String(e));
    }
  };

  const saveDetail = async () => {
    if (!detailId) return;
    setMemberDetailSaveError(null);
    if (!editName.trim()) {
      setMemberDetailSaveError("名前を入力してください。");
      return;
    }
    const loginTrim = editLogin.trim();
    if (loginTrim) {
      const clash = members.some(
        (m) =>
          m.id !== detailId && (m.loginAccount ?? "").trim().toLowerCase() === loginTrim.toLowerCase()
      );
      if (clash) {
        setMemberDetailSaveError("このログインIDは既に使用されています。");
        return;
      }
    }
    const zip = editPostalCode.trim();
    const addr = editAddress.trim();
    const bank = editBankName.trim();
    const branch = editBranchName.trim();
    const accNum = editAccountNumber.trim();
    const accHolder = editAccountHolder.trim();
    const phone = editPhoneNumber.trim();
    const invNum = editInvoiceNumber.trim();
    const invRegCheck = validateQualifiedInvoiceRegistrationNumber(editInvoiceRegistrationNumber);
    if (!invRegCheck.ok) {
      setMemberDetailSaveError(invRegCheck.message);
      return;
    }
    const firstWorkYmd = editFirstWorkDate.trim();
    const detailMember = members.find((m) => m.id === detailId);
    const detailIsIntern = detailMember?.isIntern === true;
    const updates: Record<string, unknown> = {
      name: editName.trim(),
      loginAccount: editLogin,
      hourlyRate: detailIsIntern ? 0 : editRate >= 0 ? editRate : DEFAULT_HOURLY_RATE,
      postalCode: zip,
      address: addr,
      bankName: bank,
      branchName: branch,
      accountType: editAccountType,
      accountNumber: accNum,
      accountHolder: accHolder,
      invoiceNumber: invNum,
      invoiceRegistrationNumber: invRegCheck.value,
      phoneNumber: phone,
      firstWorkDate: firstWorkYmd === "" ? null : firstWorkYmd,
      internRateDecisionMakerApps:
        editInternRateDm >= 0 ? editInternRateDm : INTERN_RATE_DECISION_MAKER_APPS,
      internRateNonDecisionMakerApps:
        editInternRateNdm >= 0 ? editInternRateNdm : INTERN_RATE_NON_DECISION_MAKER_APPS,
    };
    if (editPass !== "") updates.password = editPass;
    try {
      const res = await fetch("/api/admin/member-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          memberId: detailId,
          appBaseUrl: typeof window !== "undefined" ? window.location.origin : "",
          updates,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "保存に失敗しました");
      await onRefresh();
      if (invNum === "") {
        console.warn("[admin] メンバー保存: 請求管理番号未入力", { memberId: detailId, name: editName.trim() });
        setInvoiceSaveHint(
          `「${editName.trim()}」は請求管理番号が未入力のまま保存しました。請求・帳票のため、登録を推奨します。`
        );
      } else {
        setInvoiceSaveHint(null);
      }
      setDetailId(null);
      setMemberDetailSaveError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMemberDetailSaveError(msg);
    }
  };

  const isAdminAccountMember = useCallback((m: Member) => (m.loginAccount ?? "").trim().toLowerCase() === "admin", []);

  const toggleMorningBulkSelect = useCallback((memberId: string, checked: boolean) => {
    setMorningBulkSelectedIds((prev) =>
      checked ? (prev.includes(memberId) ? prev : [...prev, memberId]) : prev.filter((id) => id !== memberId)
    );
  }, []);

  const handleBulkAllowMorning = useCallback(async () => {
    if (morningBulkSelectedIds.length === 0) return;
    setMorningBulkBusy(true);
    setMemberDetailSaveError(null);
    try {
      for (const memberId of morningBulkSelectedIds) {
        const res = await fetch("/api/admin/member-update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            memberId,
            appBaseUrl: typeof window !== "undefined" ? window.location.origin : "",
            updates: { canWorkMorning: true },
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error || "一括更新に失敗しました");
      }
      setMorningBulkSelectedIds([]);
      await onRefresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMemberDetailSaveError(msg);
    } finally {
      setMorningBulkBusy(false);
    }
  }, [morningBulkSelectedIds, onRefresh]);

  const handleRowCanWorkMorningToggle = useCallback(
    async (mem: Member, next: boolean) => {
      if (isAdminAccountMember(mem)) return;
      setMorningRowBusyId(mem.id);
      setMemberDetailSaveError(null);
      try {
        const res = await fetch("/api/admin/member-update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            memberId: mem.id,
            appBaseUrl: typeof window !== "undefined" ? window.location.origin : "",
            updates: { canWorkMorning: next },
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error || "更新に失敗しました");
        await onRefresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setMemberDetailSaveError(msg);
      } finally {
        setMorningRowBusyId(null);
      }
    },
    [isAdminAccountMember, onRefresh]
  );


  const handleRowIsInternToggle = useCallback(
    async (mem: Member, next: boolean) => {
      if (isAdminAccountMember(mem)) return;
      setInternRowBusyId(mem.id);
      setMemberDetailSaveError(null);
      try {
        const res = await fetch("/api/admin/member-update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            memberId: mem.id,
            appBaseUrl: typeof window !== "undefined" ? window.location.origin : "",
            updates: {
              isIntern: next,
              hourlyRate: next ? 0 : DEFAULT_HOURLY_RATE,
            },
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error || "更新に失敗しました");
        setMembers((prev) =>
          prev.map((m) =>
            m.id === mem.id ? { ...m, isIntern: next, hourlyRate: next ? 0 : DEFAULT_HOURLY_RATE } : m
          )
        );
        await onRefresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setMemberDetailSaveError(msg);
      } finally {
        setInternRowBusyId(null);
      }
    },
    [isAdminAccountMember, onRefresh, setMembers]
  );


  const handleAdminSaveConfirmedApps = useCallback(
    async (
      memberId: string,
      dateYmd: string,
      patch: { confirmedDecisionMakerApps?: number; confirmedNonDecisionMakerApps?: number }
    ) => {
      const key = `${memberId}:${dateYmd}`;
      setConfirmedSaveBusyKey(key);
      try {
        const { record, nextForUser } = buildKpiRecordWithConfirmedPatch(allKpiRecords, memberId, dateYmd, patch);
        await onSaveMemberKpi(memberId, record, nextForUser);
      } finally {
        setConfirmedSaveBusyKey(null);
      }
    },
    [allKpiRecords, onSaveMemberKpi]
  );

  const adminMorningSelectableIds = useMemo(
    () =>
      sortedRowsForAdminMemberSettingsTable
        .filter(({ mem }) => !isAdminAccountMember(mem))
        .map(({ mem }) => mem.id),
    [sortedRowsForAdminMemberSettingsTable, isAdminAccountMember]
  );

  const morningBulkAllSelected =
    adminMorningSelectableIds.length > 0 &&
    adminMorningSelectableIds.every((id) => morningBulkSelectedIds.includes(id));

  const toggleMorningBulkSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) setMorningBulkSelectedIds(adminMorningSelectableIds);
      else setMorningBulkSelectedIds([]);
    },
    [adminMorningSelectableIds]
  );

  /** 管理者：当月まで選択可（月末プレビュー・一括ZIP）。メンバー側の PDF 制限とは別 */
  const adminInvoiceBulkMonthMax = getTodayJstDateString().slice(0, 7);
  const invoiceBulkMonthOptions = useMemo(
    () => getInvoiceBulkMonthOptions(adminInvoiceBulkMonthMax, 36),
    [adminInvoiceBulkMonthMax]
  );

  const invoiceZipPanelMembers = useMemo(
    () => activeMembers.filter((m) => !isAdminAccountMember(m)),
    [activeMembers, isAdminAccountMember]
  );

  const dashboardMemberSplit = useMemo(
    () => splitDashboardMembers(activeMembers, isAdminAccountMember),
    [activeMembers, isAdminAccountMember]
  );

  const dashboardGeneralMetrics = useMemo(
    () =>
      computeGeneralDashboardMetrics(
        dashboardMemberSplit.generalIds,
        allKpiRecords,
        allRecords,
        currentYearMonth
      ),
    [dashboardMemberSplit.generalIds, allKpiRecords, allRecords, currentYearMonth]
  );

  const dashboardInternMetrics = useMemo(
    () => computeInternDashboardMetrics(dashboardMemberSplit.intern, allKpiRecords, currentYearMonth),
    [dashboardMemberSplit.intern, allKpiRecords, currentYearMonth]
  );

  const internConfirmedDailySeries = useMemo(
    () =>
      buildInternConfirmedDailySeries(
        dashboardMemberSplit.internIds,
        allKpiRecords,
        currentYearMonth,
        todayStr
      ),
    [dashboardMemberSplit.internIds, allKpiRecords, currentYearMonth, todayStr]
  );

  const internConfirmedPanelMembers = useMemo(() => {
    const q = internConfirmedSearch.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    let rows = dashboardMemberSplit.intern.map((mem) => {
      const invDisplay = formatMemberInvoiceNumberThreeDigits(mem.invoiceNumber);
      const invNum = invDisplay != null ? parseInt(invDisplay, 10) : null;
      return { mem, invDisplay, invNum };
    });
    if (q) {
      rows = rows.filter(({ mem, invDisplay }) => {
        if (mem.name.toLowerCase().includes(q)) return true;
        if (invDisplay && invDisplay.includes(qDigits || q)) return true;
        const rawInv = String(mem.invoiceNumber ?? "").toLowerCase();
        return rawInv.includes(q);
      });
    }
    if (internConfirmedSort) {
      const { key, dir } = internConfirmedSort;
      rows.sort((ra, rb) => {
        if (key === "invoice") {
          if (ra.invNum == null && rb.invNum == null) return 0;
          if (ra.invNum == null) return 1;
          if (rb.invNum == null) return -1;
          const c = ra.invNum - rb.invNum;
          if (c !== 0) return dir === "asc" ? c : -c;
        } else {
          const c = ra.mem.name.localeCompare(rb.mem.name, "ja");
          if (c !== 0) return dir === "asc" ? c : -c;
        }
        return ra.mem.name.localeCompare(rb.mem.name, "ja");
      });
    } else {
      rows.sort((a, b) => a.mem.name.localeCompare(b.mem.name, "ja"));
    }
    return rows;
  }, [dashboardMemberSplit.intern, internConfirmedSearch, internConfirmedSort]);

  const toggleInternConfirmedSort = useCallback((key: InternConfirmedPanelSortKey) => {
    setInternConfirmedSort((prev) => {
      if (prev == null || prev.key !== key) {
        return { key, dir: key === "name" ? "asc" : "desc" };
      }
      if (prev.dir === (key === "name" ? "asc" : "desc")) {
        return { key, dir: key === "name" ? "desc" : "asc" };
      }
      return null;
    });
  }, []);

  const dashboardProductivityGeneral = useMemo(() => {
    const { generalIds } = dashboardMemberSplit;
    const rangeKpis = getKpiInDateRange(
      allKpiRecords,
      selectedProductivityPeriod.start,
      selectedProductivityPeriod.end
    ).filter((k) => generalIds.has(k.userId));
    const rangeTotals = getKpiTotalsFromRecords(rangeKpis);
    const rangeMinutes = allRecords
      .filter(
        (r) =>
          generalIds.has(r.userId) &&
          r.date >= selectedProductivityPeriod.start &&
          r.date <= selectedProductivityPeriod.end
      )
      .reduce((s, r) => s + r.durationMinutes, 0);
    const rangeApoCostMinutes =
      rangeTotals.decisionMakerApo > 0 ? rangeMinutes / rangeTotals.decisionMakerApo : null;
    return { rangeTotals, rangeMinutes, rangeApoCostMinutes };
  }, [
    dashboardMemberSplit,
    allKpiRecords,
    allRecords,
    selectedProductivityPeriod.start,
    selectedProductivityPeriod.end,
  ]);

  const invoiceZipAllSelected =
    invoiceZipPanelMembers.length > 0 &&
    invoiceZipPanelMembers.every((m) => invoiceZipSelectedIds.includes(m.id));

  const toggleInvoiceZipSelect = useCallback((memberId: string, checked: boolean) => {
    setInvoiceZipSelectedIds((prev) =>
      checked ? (prev.includes(memberId) ? prev : [...prev, memberId]) : prev.filter((id) => id !== memberId)
    );
  }, []);

  const toggleInvoiceZipSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) setInvoiceZipSelectedIds(invoiceZipPanelMembers.map((m) => m.id));
      else setInvoiceZipSelectedIds([]);
    },
    [invoiceZipPanelMembers]
  );

  const handleInvoiceZipDownload = useCallback(async () => {
    if (invoiceZipSelectedIds.length === 0) return;
    setInvoiceZipBusy(true);
    setMemberDetailSaveError(null);
    try {
      await preloadJpFontsForPdf();
      const zip = new JSZip();
      for (const id of invoiceZipSelectedIds) {
        const mem = members.find((m) => m.id === id);
        if (!mem) continue;
        const blob = await renderMemberCombinedPdfBlob(mem, invoiceBulkMonth, allRecords, allKpiRecords);
        const fname = buildInvoiceCombinedPdfFileName(mem, invoiceBulkMonth);
        zip.file(fname, blob);
      }
      const out = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = url;
      a.download = buildInvoiceBulkZipFileName(invoiceBulkMonth);
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMemberDetailSaveError(msg);
    } finally {
      setInvoiceZipBusy(false);
    }
  }, [invoiceZipSelectedIds, invoiceBulkMonth, members, allRecords, allKpiRecords]);

  const handleHourlyRateBlur = useCallback(
    async (mem: Member, raw: string) => {
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 0) return;
      const prev = mem.hourlyRate ?? DEFAULT_HOURLY_RATE;
      if (n === prev) return;
      setHourlyRateRowBusyId(mem.id);
      setMemberDetailSaveError(null);
      try {
        const res = await fetch("/api/admin/member-update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            memberId: mem.id,
            appBaseUrl: typeof window !== "undefined" ? window.location.origin : "",
            updates: { hourlyRate: n },
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error || "時給の更新に失敗しました");
        await onRefresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setMemberDetailSaveError(msg);
      } finally {
        setHourlyRateRowBusyId(null);
      }
    },
    [onRefresh]
  );

  const handleInternRateBlur = useCallback(
    async (
      mem: Member,
      field: "internRateDecisionMakerApps" | "internRateNonDecisionMakerApps",
      raw: string
    ) => {
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 0) return;
      const rates = getInternUnitRates(mem);
      const prev = field === "internRateDecisionMakerApps" ? rates.decisionMaker : rates.nonDecisionMaker;
      if (n === prev) return;
      const busyKey = `${mem.id}:${field === "internRateDecisionMakerApps" ? "dm" : "ndm"}`;
      setInternRateRowBusyKey(busyKey);
      setMemberDetailSaveError(null);
      try {
        const res = await fetch("/api/admin/member-update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            memberId: mem.id,
            appBaseUrl: typeof window !== "undefined" ? window.location.origin : "",
            updates: { [field]: n },
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error || "インターン単価の更新に失敗しました");
        await onRefresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setMemberDetailSaveError(msg);
      } finally {
        setInternRateRowBusyKey(null);
      }
    },
    [onRefresh]
  );

  const adminDeepLinkHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!deepLinkMemberId) {
      adminDeepLinkHandledRef.current = null;
      return;
    }
    if (!isAdminUser) return;
    if (adminDeepLinkHandledRef.current === deepLinkMemberId) return;
    const m = members.find((x) => x.id === deepLinkMemberId);
    if (!m) return;
    adminDeepLinkHandledRef.current = deepLinkMemberId;
    setAdminSection("settings");
    openDetail(m);
    onAdminDeepLinkConsumed?.();
  }, [deepLinkMemberId, members, isAdminUser, onAdminDeepLinkConsumed]);

  useEffect(() => {
    if (!recordActivityToast) return;
    const t = setTimeout(() => setRecordActivityToast(null), 4000);
    return () => clearTimeout(t);
  }, [recordActivityToast]);

  /** 他端末・他管理者の attendance 変更を反映（Supabase で Realtime を有効にしている場合） */
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    const ch = supabase
      .channel("admin-attendance-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "attendance" },
        () => {
          void onRefresh();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [onRefresh]);

  const handleDeleteWorkRecord = useCallback(
    async (r: WorkRecord) => {
      if (!window.confirm("本当に削除しますか？")) return;
      setRecordDeletingId(r.id);
      try {
        const res = await deleteAttendanceRecordById(r.id);
        if (!res.ok) {
          setRecordActivityToast({ message: res.error ?? "削除に失敗しました", isError: true });
          return;
        }
        await onRefresh();
        setRecordActivityToast({ message: "削除しました", isError: false });
        if (recordFormRecord?.id === r.id) {
          setRecordFormRecord(null);
          setRecordFormMember(null);
        }
      } finally {
        setRecordDeletingId(null);
      }
    },
    [onRefresh, recordFormRecord]
  );

  /** 管理者：実績がなくても当日・過去日へ活動記録を新規追加できる（一覧・日別実績からの導線） */
  const openAdminActivityRecordModal = useCallback(
    (mem: Member, dateYmd: string, mode: "new" | "edit") => {
      const dayRecs = getRecordsForUserAndDate(allRecords, mem.id, dateYmd).sort((a, b) =>
        a.startRounded.localeCompare(b.startRounded)
      );
      if (mode === "new" || dayRecs.length === 0) {
        setRecordFormMember(mem);
        setRecordFormRecord(null);
        setRecordFormDate(dateYmd);
        setRecordFormStart("09:00");
        setRecordFormEnd("18:00");
        return;
      }
      const toEdit = dayRecs[0]!;
      setRecordFormMember(mem);
      setRecordFormRecord(toEdit);
      setRecordFormDate(dateYmd);
      setRecordFormStart(getTimeFromIso(toEdit.startRounded));
      setRecordFormEnd(getTimeFromIso(toEdit.endRounded));
    },
    [allRecords]
  );

  const targetWeekStart = addWeeksToWeekStart(getMondayOfCalendarWeekForYmd(getTodayJstDateString()), 1);
  const targetWeekDates = getWeekDates(targetWeekStart);
  const deadlineForTargetWeek = getDeadlineForWeek(targetWeekStart);
  const isPastDeadlineForTargetWeek = Date.now() > deadlineForTargetWeek.getTime();
  const membersWithoutEntryThisWeek = activeMembers.filter((m) => {
    const userShifts = getShiftsForUser(allShifts, m.id);
    return !targetWeekDates.some((d) => userShifts.some((s) => s.date === d));
  });

  const shiftRangeNorm = useMemo(() => {
    const a = shiftViewStart <= shiftViewEnd ? shiftViewStart : shiftViewEnd;
    const b = shiftViewStart <= shiftViewEnd ? shiftViewEnd : shiftViewStart;
    return { start: a, end: b };
  }, [shiftViewStart, shiftViewEnd]);

  const shiftViewDateList = useMemo(
    () => getDateStringsInclusive(shiftRangeNorm.start, shiftRangeNorm.end),
    [shiftRangeNorm.start, shiftRangeNorm.end]
  );

  /** シフト管理表・PDF: userId+date でシフトと KPI を突合 */
  const scheduleJoinByUserDate = useMemo(
    () => mergeShiftsAndKpisByUserDate(allShifts, allKpiRecords),
    [allShifts, allKpiRecords]
  );

  const sortedShiftGridMembers = useMemo(() => {
    const list = [...activeMembers];
    if (!shiftScheduleSort) return list;
    if (shiftScheduleSort.column === "name") {
      list.sort((a, b) => {
        const c = a.name.localeCompare(b.name, "ja");
        const primary = shiftScheduleSort.dir === "desc" ? -c : c;
        if (primary !== 0) return primary;
        return a.id.localeCompare(b.id);
      });
    } else {
      const ds = shiftScheduleSort.dateStr;
      list.sort((a, b) => {
        const slotA = scheduleJoinByUserDate.get(`${a.id}\t${ds}`);
        const slotB = scheduleJoinByUserDate.get(`${b.id}\t${ds}`);
        const scoreA = shiftScheduleGridDateColumnScore(slotA?.shift);
        const scoreB = shiftScheduleGridDateColumnScore(slotB?.shift);
        const diff = scoreA - scoreB;
        if (diff !== 0) return shiftScheduleSort.dir === "desc" ? -diff : diff;
        return a.name.localeCompare(b.name, "ja");
      });
    }
    return list;
  }, [activeMembers, shiftScheduleSort, scheduleJoinByUserDate]);

  const shiftEditMemberId = shiftEditMember?.id ?? null;

  /** allShifts の参照が毎レンダー変わっても、期間内シフトの実体が同じなら編集モーダル用 effect を走らせない */
  const shiftEditShiftsFingerprint = useMemo(() => {
    if (shiftEditMemberId == null) return "";
    const inRange = getShiftsForUser(allShifts, shiftEditMemberId).filter(
      (s) => s.date >= shiftRangeNorm.start && s.date <= shiftRangeNorm.end
    );
    return inRange
      .map((s) =>
        [s.date, s.startPlanned, s.endPlanned, s.startPlanned2 ?? "", s.endPlanned2 ?? ""].join("\t")
      )
      .sort()
      .join("|");
  }, [shiftEditMemberId, allShifts, shiftRangeNorm.start, shiftRangeNorm.end]);

  useEffect(() => {
    if (shiftEditMemberId == null) return;
    const dates = getDateStringsInclusive(shiftRangeNorm.start, shiftRangeNorm.end);
    const userShifts = getShiftsForUser(allShifts, shiftEditMemberId);
    const next: Record<string, { s1: string; e1: string; s2: string; e2: string }> = {};
    dates.forEach((dateStr) => {
      if (isWeekendYmd(dateStr)) {
        next[dateStr] = shiftFormWeekendNone();
        return;
      }
      const s = userShifts.find((sh) => sh.date === dateStr);
      const isNone = s && s.startPlanned === ENTRY_NONE;
      next[dateStr] = {
        s1: isNone ? ENTRY_NONE : s ? s.startPlanned : SHIFT_WEEKDAY_DEFAULT_START,
        e1: isNone ? ENTRY_NONE : s ? s.endPlanned : SHIFT_WEEKDAY_DEFAULT_END,
        s2: s && s.startPlanned2 ? s.startPlanned2 : "",
        e2: s && s.endPlanned2 ? s.endPlanned2 : "",
      };
    });
    setShiftWeekForm((prev) => {
      const prevKeys = Object.keys(prev).sort().join("\0");
      const nextKeys = Object.keys(next).sort().join("\0");
      if (prevKeys === nextKeys) {
        let same = true;
        for (const k of Object.keys(next)) {
          const a = prev[k];
          const b = next[k];
          if (!a || !b || a.s1 !== b.s1 || a.e1 !== b.e1 || a.s2 !== b.s2 || a.e2 !== b.e2) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return next;
    });
    // allShifts の参照は不安定なことがあるため、期間内シフトの実体は shiftEditShiftsFingerprint で追う
    // eslint-disable-next-line react-hooks/exhaustive-deps -- allShifts は fingerprint 経由で反映
  }, [shiftEditMemberId, shiftRangeNorm.start, shiftRangeNorm.end, shiftEditShiftsFingerprint]);

  useEffect(() => {
    if (shiftEditMemberId != null) return;
    setShiftWeekForm({});
  }, [shiftRangeNorm.start, shiftRangeNorm.end, shiftEditMemberId]);

  const shiftModalRestrictMorning =
    shiftEditMember != null &&
    !isAdminAccountMember(shiftEditMember) &&
    shiftEditMember.canWorkMorning !== true;

  const shiftModalCanSave = useMemo(() => {
    if (!shiftEditMember) return false;
    return shiftViewDateList.every((dateStr) => {
      if (isWeekendYmd(dateStr)) {
        const f = shiftWeekForm[dateStr] ?? shiftFormWeekendNone();
        return f.s1 === ENTRY_NONE;
      }
      const f = shiftWeekForm[dateStr] || { s1: SHIFT_WEEKDAY_DEFAULT_START, e1: SHIFT_WEEKDAY_DEFAULT_END, s2: "", e2: "" };
      return adminShiftDayCanSave(f, shiftModalRestrictMorning);
    });
  }, [shiftEditMember, shiftViewDateList, shiftWeekForm, shiftModalRestrictMorning]);

  const updateShiftDay = (dateStr: string, field: "s1" | "e1" | "s2" | "e2", value: string) => {
    setShiftWeekForm((prev) => {
      const cur = prev[dateStr] || { s1: SHIFT_WEEKDAY_DEFAULT_START, e1: SHIFT_WEEKDAY_DEFAULT_END, s2: "", e2: "" };
      const next = { ...cur, [field]: value };
      if (field === "s1" && value === ENTRY_NONE) next.e1 = ENTRY_NONE;
      if (field === "e1" && value === ENTRY_NONE) next.s1 = ENTRY_NONE;
      return { ...prev, [dateStr]: next };
    });
  };

  const handleSaveShiftWeek = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shiftEditMember) return;
    if (!shiftModalCanSave) return;
    const dates = shiftViewDateList;
    const userShifts = getShiftsForUser(allShifts, shiftEditMember.id);
    const otherShifts = allShifts.filter((s) => s.userId === shiftEditMember.id && !dates.includes(s.date));
    const newShifts: Shift[] = dates.map((dateStr) => {
      const existing = userShifts.find((sh) => sh.date === dateStr);
      if (isWeekendYmd(dateStr)) {
        return {
          id: existing ? existing.id : crypto.randomUUID(),
          userId: shiftEditMember.id,
          date: dateStr,
          startPlanned: ENTRY_NONE,
          endPlanned: ENTRY_NONE,
          isManualDelete: true,
        };
      }
      const f = shiftWeekForm[dateStr] || { s1: SHIFT_WEEKDAY_DEFAULT_START, e1: SHIFT_WEEKDAY_DEFAULT_END, s2: "", e2: "" };
      const base: Shift = {
        id: existing ? existing.id : crypto.randomUUID(),
        userId: shiftEditMember.id,
        date: dateStr,
        startPlanned: f.s1,
        endPlanned: f.s1 === ENTRY_NONE ? ENTRY_NONE : f.e1,
        isManualDelete: true,
      };
      if (f.s1 !== ENTRY_NONE && f.s2 && f.e2) {
        return { ...base, startPlanned2: f.s2, endPlanned2: f.e2 };
      }
      return base;
    });
    await onSaveMemberShifts(shiftEditMember.id, [...newShifts, ...otherShifts]);
    setShiftEditMember(null);
  };

  const setAdminShiftDayNone = (dateStr: string, none: boolean) => {
    if (!shiftEditMember) return;
    setShiftWeekForm((prev) => ({
      ...prev,
      [dateStr]: none ? { s1: ENTRY_NONE, e1: ENTRY_NONE, s2: "", e2: "" } : { s1: SHIFT_WEEKDAY_DEFAULT_START, e1: SHIFT_WEEKDAY_DEFAULT_END, s2: "", e2: "" },
    }));
  };

  const applyShiftShortcutThisWeek = () => {
    const mon = getMondayOfCalendarWeekContaining(getTodayJstDateString());
    const dates = getWeekDates(mon);
    setShiftViewStart(dates[0]);
    setShiftViewEnd(dates[6]);
  };
  const applyShiftShortcutNextWeek = () => {
    const mon = getMondayOfCalendarWeekContaining(getTodayJstDateString());
    const nextMon = addWeeksToWeekStart(mon, 1);
    const dates = getWeekDates(nextMon);
    setShiftViewStart(dates[0]);
    setShiftViewEnd(dates[6]);
  };
  const applyShiftShortcutNextMonth = () => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    setShiftViewStart(toDateString(first));
    setShiftViewEnd(toDateString(last));
  };

  const scheduleCsvTargetMembers = useMemo(
    () => activeMembers.filter((m) => (m.loginAccount ?? "").toLowerCase() !== "admin"),
    [activeMembers]
  );

  const dailyActualBlocks = useMemo(() => {
    const start = dailyActualStart <= dailyActualEnd ? dailyActualStart : dailyActualEnd;
    const end = dailyActualStart <= dailyActualEnd ? dailyActualEnd : dailyActualStart;
    const dates = getDateStringsInclusive(start, end);
    if (dates.length === 0) return [];
    const reversed = [...dates].reverse();
    const memberList = activeMembers.filter((m) => (m.loginAccount ?? "").toLowerCase() !== "admin");
    type Agg = NonNullable<ReturnType<typeof aggregateUserWorkDaySpan>>;
    const blocks: {
      dateStr: string;
      rows: {
        member: Member;
        shift: Shift | null;
        agg: Agg | null;
        plannedMinutes: number;
        openOnDate: OpenRecord | null;
      }[];
      totalPeople: number;
      totalWorkMinutes: number;
    }[] = [];
    for (const dateStr of reversed) {
      const rows: {
        member: Member;
        shift: Shift | null;
        agg: Agg | null;
        plannedMinutes: number;
        openOnDate: OpenRecord | null;
      }[] = [];
      for (const mem of memberList) {
        if (!userQualifiesForDailyActualView(allRecords, allShifts, mem.id, dateStr, allOpenRecords)) continue;
        const shift = canonicalShiftForUserDate(allShifts, mem.id, dateStr);
        const plannedMinutes = shift != null ? getShiftPlannedMinutes(shift) : 0;
        const agg = aggregateUserWorkDaySpan(allRecords, mem.id, dateStr);
        const openOnDate = allOpenRecords.find((o) => o.userId === mem.id && o.date === dateStr) ?? null;
        rows.push({ member: mem, shift: shift ?? null, agg: agg ?? null, plannedMinutes, openOnDate });
      }
      rows.sort((a, b) => {
        const sa = earliestPlannedShiftStartMinutes(a.shift);
        const sb = earliestPlannedShiftStartMinutes(b.shift);
        if (sa == null && sb == null) return a.member.name.localeCompare(b.member.name, "ja");
        if (sa == null) return 1;
        if (sb == null) return -1;
        if (sa !== sb) return sa - sb;
        return a.member.name.localeCompare(b.member.name, "ja");
      });
      if (rows.length === 0) continue;
      const totalWorkMinutes = rows.reduce((s, r) => s + (r.agg?.totalWorkMinutes ?? 0), 0);
      blocks.push({
        dateStr,
        rows,
        totalPeople: rows.length,
        totalWorkMinutes,
      });
    }
    return blocks;
  }, [dailyActualStart, dailyActualEnd, activeMembers, allRecords, allShifts, allOpenRecords]);

  const dailyActualDisplayBlocks = useMemo(() => {
    return dailyActualBlocks.map((block) => {
      const sort = adminDailyActualSort[block.dateStr];
      if (!sort) return block;
      const rows = [...block.rows];
      rows.sort((a, b) => compareDailyActualBlockRows(a, b, sort.key, sort.dir === "desc"));
      return { ...block, rows };
    });
  }, [dailyActualBlocks, adminDailyActualSort]);

  const kpiDailyRowsGeneral = useMemo(() => {
    const rows = dashboardMemberSplit.general.map((mem) => {
      const dayKpi = getKpiForDate(getKpiForUser(allKpiRecords, mem.id), kpiDate);
      const rates = dayKpi
        ? getKpiRates(dayKpi)
        : { validRate: null as number | null, kcRate: null as number | null, apoRate: null as number | null };
      return { mem, dayKpi, rates };
    });
    if (!kpiDailySort) return rows;
    const { key, dir } = kpiDailySort;
    rows.sort((a, b) => compareAdminKpiDailyRows(a, b, key, dir === "desc"));
    return rows;
  }, [dashboardMemberSplit.general, allKpiRecords, kpiDate, kpiDailySort]);

  const kpiDailyRowsIntern = useMemo(() => {
    const rows = dashboardMemberSplit.intern.map((mem) => {
      const dayKpi = getKpiForDate(getKpiForUser(allKpiRecords, mem.id), kpiDate);
      return { mem, dayKpi };
    });
    rows.sort((a, b) => a.mem.name.localeCompare(b.mem.name, "ja"));
    return rows;
  }, [dashboardMemberSplit.intern, allKpiRecords, kpiDate]);

  const kpiRangeNorm = useMemo(() => {
    const start = rangeStart <= rangeEnd ? rangeStart : rangeEnd;
    const end = rangeStart <= rangeEnd ? rangeEnd : rangeStart;
    return { start, end };
  }, [rangeStart, rangeEnd]);

  const kpiGeneralRangeMetrics = useMemo(
    () =>
      computeGeneralKpiMetricsForRange(
        dashboardMemberSplit.generalIds,
        allKpiRecords,
        allRecords,
        kpiRangeNorm.start,
        kpiRangeNorm.end
      ),
    [dashboardMemberSplit.generalIds, allKpiRecords, allRecords, kpiRangeNorm]
  );

  const kpiInternRangeMetrics = useMemo(
    () =>
      computeInternDashboardMetricsForRange(
        dashboardMemberSplit.intern,
        allKpiRecords,
        kpiRangeNorm.start,
        kpiRangeNorm.end
      ),
    [dashboardMemberSplit.intern, allKpiRecords, kpiRangeNorm]
  );

  const kpiInternRangeRows = useMemo(
    () =>
      buildInternRewardRowsForRange(
        dashboardMemberSplit.intern,
        allKpiRecords,
        kpiRangeNorm.start,
        kpiRangeNorm.end
      ).sort((a, b) => a.member.name.localeCompare(b.member.name, "ja")),
    [dashboardMemberSplit.intern, allKpiRecords, kpiRangeNorm]
  );

  const handleDownloadScheduleCsvForSelectedRange = useCallback(() => {
    const { start, end } = shiftRangeNorm;
    const csv = exportScheduleToCsvString(start, end, allShifts, scheduleCsvTargetMembers);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `稼働予定_${start}_${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [shiftRangeNorm, allShifts, scheduleCsvTargetMembers]);

  const shiftPdfWeekdayDateList = useMemo(
    () => getDateStringsInclusive(shiftRangeNorm.start, shiftRangeNorm.end).filter((d) => !isWeekendYmd(d)),
    [shiftRangeNorm.start, shiftRangeNorm.end]
  );

  const handleShiftRangePdfPrint = useCallback(() => {
    document.body.classList.add("admin-shift-print-range");
    const onAfter = () => document.body.classList.remove("admin-shift-print-range");
    window.addEventListener("afterprint", onAfter, { once: true });
    setTimeout(() => window.print(), 10);
  }, []);

  const navItems: { id: AdminSection; label: string }[] = [
    { id: "dashboard", label: "ダッシュボード" },
    { id: "attendance", label: "稼働状況" },
    { id: "shift", label: "稼働予定管理" },
    { id: "kpi", label: "業務委託KPI" },
    { id: "dailyActual", label: "日別実績（予定・実績）" },
    { id: "planActualGap", label: "予実乖離アーカイブ" },
    ...(isAdminUser
      ? ([
          { id: "roi" as const, label: "生産性分析（ROI）" },
          { id: "productivityExport" as const, label: "生産性CSV" },
        ] as const)
      : []),
    { id: "settings", label: "管理設定" },
  ];
  const invoiceMissingNavCount = membersWithMissingInvoiceNumber.length;

  useEffect(() => {
    if (!isAdminUser && (adminSection === "roi" || adminSection === "productivityExport")) {
      setAdminSection("dashboard");
    }
  }, [isAdminUser, adminSection]);

  useEffect(() => {
    if (adminSection !== "attendance") return;
    requestAnimationFrame(() => {
      attendanceRecordEditorRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
    });
  }, [adminSection]);

  const roiSelectableMonths = useMemo(
    () => getSelectableMonths(allRecords, allShifts, allKpiRecords),
    [allRecords, allShifts, allKpiRecords]
  );

  /** ROI は一般メンバー（時給制）のみ。管理者・インターンは除外 */
  const roiTargetMembers = useMemo(
    () => activeMembers.filter((m) => (m.loginAccount ?? "").toLowerCase() !== "admin" && !isInternMember(m)),
    [activeMembers]
  );

  const roiFilteredMembers = useMemo(() => {
    if (roiSelectedMemberIds == null) return roiTargetMembers;
    const set = new Set(roiSelectedMemberIds);
    return roiTargetMembers.filter((m) => set.has(m.id));
  }, [roiTargetMembers, roiSelectedMemberIds]);

  useEffect(() => {
    const valid = new Set(roiTargetMembers.map((m) => m.id));
    setRoiSelectedMemberIds((prev) => {
      if (prev == null) return null;
      const next = prev.filter((id) => valid.has(id));
      if (next.length === 0) return null;
      return next;
    });
  }, [roiTargetMembers]);

  const roiRange = useMemo(() => normalizeRoiRange(roiStartDate, roiEndDate), [roiStartDate, roiEndDate]);

  const roiMemberRows = useMemo(
    () => buildMemberRoiRowsForRange(roiRange.start, roiRange.end, roiFilteredMembers, allKpiRecords, allRecords),
    [roiRange.start, roiRange.end, roiFilteredMembers, allKpiRecords, allRecords]
  );

  const kpiOutsourceTableRows = useMemo(() => {
    const base = [...roiMemberRows];
    const byMemberOrder = (x: (typeof base)[number], y: (typeof base)[number]) => {
      const ix = roiFilteredMembers.findIndex((m) => m.id === x.memberId);
      const iy = roiFilteredMembers.findIndex((m) => m.id === y.memberId);
      return (ix < 0 ? 9999 : ix) - (iy < 0 ? 9999 : iy);
    };
    if (kpiOutsourceSort == null) {
      return base.sort(byMemberOrder);
    }
    return base.sort((a, b) =>
      compareMemberRoiRowsByKpiOutsourceKey(a, b, kpiOutsourceSort.key, kpiOutsourceSort.dir === "desc")
    );
  }, [roiMemberRows, kpiOutsourceSort, roiFilteredMembers]);

  const onKpiOutsourceHeaderClick = useCallback((k: RoiKpiOutsourceSortKey) => {
    setKpiOutsourceSort((prev) => cycleKpiOutsourceSort(prev, k));
  }, []);

  const roiDailyPoints = useMemo(
    () => buildTeamDailyRoiSeriesForRange(roiRange.start, roiRange.end, roiFilteredMembers, allKpiRecords, allRecords, todayStr),
    [roiRange.start, roiRange.end, roiFilteredMembers, allKpiRecords, allRecords, todayStr]
  );

  const handleRoiMonthChange = (ym: string) => {
    setRoiYearMonth(ym);
    const { start, end } = getMonthDateRange(ym, todayStr);
    setRoiStartDate(start);
    setRoiEndDate(end);
  };

  const handleRoiCsvDownload = () => {
    const rows = buildRoiCsvDayRows(roiRange.start, roiRange.end, roiFilteredMembers, allKpiRecords, allRecords);
    const blob = new Blob([buildRoiCsvContent(rows)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const memPart = roiSelectedMemberIds == null ? "all" : `${roiFilteredMembers.length}mem`;
    a.download = `roi_${roiRange.start}_${roiRange.end}_${memPart}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const peRange = useMemo(() => normalizeRoiRange(peStartDate, peEndDate), [peStartDate, peEndDate]);

  const downloadCsvWithBom = (utf8Content: string, filename: string) => {
    const blob = new Blob([utf8Content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const productivityCsvMemPart =
    roiSelectedMemberIds == null ? "all" : `${roiFilteredMembers.length}mem`;

  const handlePeDailyCsvDownload = () => {
    const rows = buildProductivityDailyCsvRows(
      roiFilteredMembers,
      allRecords,
      allKpiRecords,
      peRange.start,
      peRange.end
    );
    downloadCsvWithBom(
      buildBomUtf8CsvContent(rows),
      `productivity_daily_${peRange.start}_${peRange.end}_${productivityCsvMemPart}.csv`
    );
  };

  const handlePeSummaryCsvDownload = () => {
    const rows = buildProductivityMemberSummaryCsvRows(
      roiFilteredMembers,
      allRecords,
      allKpiRecords,
      peRange.start,
      peRange.end
    );
    downloadCsvWithBom(
      buildBomUtf8CsvContent(rows),
      `productivity_summary_${peRange.start}_${peRange.end}_${productivityCsvMemPart}.csv`
    );
  };

  const handlePeBothCsvDownload = () => {
    handlePeDailyCsvDownload();
    window.setTimeout(() => handlePeSummaryCsvDownload(), 450);
  };

  useEffect(() => {
    if (!roiSlackToast) return;
    const t = setTimeout(() => setRoiSlackToast(null), 4000);
    return () => clearTimeout(t);
  }, [roiSlackToast]);

  useEffect(() => {
    if (!gapActionToast) return;
    const t = setTimeout(() => setGapActionToast(null), 6000);
    return () => clearTimeout(t);
  }, [gapActionToast]);

  const handleSlackManualRoiReport = async () => {
    setRoiSlackToast(null);
    setSlackManualReportSending(true);
    try {
      let loginId = slackAdminAuthMemory.current?.loginId ?? "";
      let password = slackAdminAuthMemory.current?.password ?? "";
      if (!loginId || !password) {
        const fallbackId = adminLoginAccount.trim();
        if (!fallbackId) {
          alert("ログイン情報を確認できません。一度ログアウトして再ログインしてください。");
          return;
        }
        const p = window.prompt("Slackに送信するため、管理者のパスワードを入力してください");
        if (p == null || p === "") {
          alert("送信をキャンセルしました。");
          return;
        }
        loginId = fallbackId;
        password = p;
      }
      const { slackManualReportAction } = await import("@/app/actions/slack-manual-report");
      const data = await slackManualReportAction({
        startDate: roiRange.start,
        endDate: roiRange.end,
        memberIds: roiSelectedMemberIds,
        adminLoginId: loginId,
        adminPassword: password,
      });
      if (!data.ok) {
        const parts = [data.error, data.detail].filter(Boolean);
        setRoiSlackToast({
          message: parts.join(" — ") || "理由不明",
          isError: true,
        });
        return;
      }
      setRoiSlackToast({ message: "Slack に送信し、成功応答を受け取りました。", isError: false });
    } catch (e) {
      setRoiSlackToast({
        message: e instanceof Error ? e.message : String(e),
        isError: true,
      });
    } finally {
      setSlackManualReportSending(false);
    }
  };

  return (
    <>
      {/* 画面・通常印刷では非表示。期間PDF時のみ globals.css で表示（body.admin-shift-print-range） */}
      <div className="shift-range-print-root" aria-hidden>
        <div className="shift-range-print-inner w-full bg-white p-4 text-slate-900 print:p-2">
          <h2 className="shift-range-print-title mb-4 text-center text-2xl font-bold tracking-tight text-slate-900">
            稼働予定表（{shiftRangeNorm.start} 〜 {shiftRangeNorm.end}）
          </h2>
          <p className="mb-3 text-center text-sm text-slate-600 print:text-xs">月〜金のみ表示（土日は除く）</p>
          <div className="overflow-x-auto print:overflow-visible">
            <table className="shift-range-print-table w-full min-w-[480px] border-collapse border border-slate-300 text-left text-xs sm:text-sm print:min-w-0">
              <thead>
                <tr className="border-b border-slate-300 bg-slate-100">
                  <th className="border border-slate-300 px-2 py-2 font-semibold text-slate-800 sm:px-3">メンバー</th>
                  {shiftPdfWeekdayDateList.map((dateStr) => (
                    <th
                      key={dateStr}
                      className="border border-slate-300 px-2 py-2 text-center font-semibold text-slate-800 sm:px-3"
                    >
                      {formatScheduleColumnHeader(dateStr)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scheduleCsvTargetMembers.map((mem) => (
                  <tr key={mem.id}>
                    <td className="border border-slate-300 bg-white px-2 py-2 font-medium text-slate-900 sm:px-3">
                      {mem.name}
                    </td>
                    {shiftPdfWeekdayDateList.map((dateStr) => {
                      const s = scheduleJoinByUserDate.get(`${mem.id}\t${dateStr}`)?.shift;
                      const kind = classifyVisualShiftCell(s);
                      if (kind === "missing") {
                        return (
                          <td
                            key={dateStr}
                            className="border border-slate-300 bg-red-600 px-2 py-2 text-center text-sm font-bold text-white sm:px-3"
                          >
                            未登録
                          </td>
                        );
                      }
                      if (kind === "off") {
                        return (
                          <td
                            key={dateStr}
                            className="border border-slate-300 bg-gray-100 px-2 py-2 text-center text-sm font-medium text-gray-600 sm:px-3"
                          >
                            -
                          </td>
                        );
                      }
                      return (
                        <td
                          key={dateStr}
                          className="border border-slate-300 bg-green-100 px-2 py-2 text-center text-sm font-medium whitespace-pre-line leading-snug text-black sm:px-3"
                        >
                          {s ? formatVisualShiftWorkLabel(s) : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="admin-dashboard-screen-only space-y-6">
      <nav className="flex flex-wrap gap-0 border-b border-slate-200 bg-white shadow-sm">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setAdminSection(item.id)}
            className={`inline-flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition ${adminSection === item.id ? "border-b-2 border-slate-700 text-slate-800" : "text-slate-500 hover:text-slate-700"}`}
          >
            {item.label}
            {item.id === "settings" && invoiceMissingNavCount > 0 ? (
              <span
                className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
                title="請求管理番号未入力のメンバーがいます"
              >
                {invoiceMissingNavCount}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      {adminSection === "dashboard" && (
        <div className="space-y-6">
          {isPastDeadlineForTargetWeek && membersWithoutEntryThisWeek.length > 0 && (
            <section className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold text-amber-900">稼働予定が未登録のメンバーがいます</h2>
              <p className="mb-3 text-xs text-amber-800">前週の日曜 23:59（日本時間）の締め切りを過ぎても、来週分の稼働予定（エントリー）が1日も登録されていないメンバーがいます。「稼働予定管理」から代理登録できます。</p>
              <p className="mb-2 text-sm font-medium text-slate-800">{membersWithoutEntryThisWeek.map((m) => m.name).join("、")}</p>
              <button
                type="button"
                onClick={() => setAdminSection("shift")}
                className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
              >
                稼働予定管理で登録する
              </button>
            </section>
          )}
          {membersWithMissingBankInfo.length > 0 && (
            <section className="rounded-xl border-2 border-red-300 bg-red-50 p-5 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold text-red-800">【重要】振込先情報が未登録のメンバーがいます</h2>
              <p className="mb-3 text-xs text-red-700">以下のメンバーは、振込先・請求管理番号・電話番号のいずれかが未登録です。請求書発行前に「今すぐ編集」から入力してください。</p>
              <p className="mb-4 text-sm text-slate-800">
                {membersWithMissingBankInfo.map((m) => m.name).join("、")}
              </p>
              <button
                type="button"
                onClick={() => {
                  setAdminSection("settings");
                  if (membersWithMissingBankInfo.length > 0) openDetail(membersWithMissingBankInfo[0]);
                }}
                className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                今すぐ編集
              </button>
            </section>
          )}
          {membersWithMissingInvoiceNumber.length > 0 && (
            <section className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold text-amber-900">請求管理番号が未入力のメンバーがいます</h2>
              <p className="mb-3 text-xs text-amber-800">
                保存は可能ですが、請求・管理用の 3 桁番号が空のメンバーがいます。「管理設定」から入力してください。
              </p>
              <p className="mb-4 text-sm font-medium text-slate-800">{membersWithMissingInvoiceNumber.map((m) => m.name).join("、")}</p>
              <button
                type="button"
                onClick={() => {
                  setAdminSection("settings");
                  openDetail(membersWithMissingInvoiceNumber[0]);
                }}
                className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
              >
                管理設定で編集
              </button>
            </section>
          )}
          <section
            className={`rounded-xl border-2 p-6 shadow-sm ${
              unapprovedPlanActualGapCount > 0
                ? "border-amber-400 bg-amber-50/90"
                : "border-slate-200 bg-slate-50/90"
            }`}
          >
            <h2 className="mb-3 text-sm font-semibold text-slate-900">予実乖離（要対応件数）</h2>
            <p className="mb-2 text-xl font-bold leading-snug text-slate-900 sm:text-2xl">
              {unapprovedPlanActualGapCount === 0 ? (
                <span className="text-emerald-800">未確定の予実乖離はありません</span>
              ) : (
                <>
                  未確定の予実乖離が{" "}
                  <span className="tabular-nums text-amber-800">{unapprovedPlanActualGapCount}</span> 件あります
                </>
              )}
            </p>
            <p className="mb-6 max-w-2xl text-xs leading-relaxed text-slate-600">
              直近7日分について、予実乖離アーカイブと同じ条件で数えています。「予定に合わせる」「実績に合わせる」で確定した行はここからも一覧からも消えます。氏名のチェックは詳細画面で行ってください。
            </p>
            <button
              type="button"
              onClick={() => {
                setGapStart(last7DaysForPlanActualGap[0]);
                setGapEnd(last7DaysForPlanActualGap[6]);
                setGapMonthQuick("");
                setGapPage(1);
                setAdminSection("planActualGap");
              }}
              className="w-full rounded-xl bg-slate-900 px-6 py-4 text-center text-base font-semibold text-white shadow-md transition hover:bg-slate-800 sm:w-auto sm:min-w-[20rem]"
            >
              予実乖離・履歴一覧を開いて確定する
            </button>
          </section>

          <section className="rounded-2xl border border-slate-200/80 bg-slate-50 p-6 shadow-sm sm:p-8">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-slate-900">契約形態別パフォーマンス</h2>
                <p className="mt-2 text-sm text-slate-600">
                  {currentYearMonth} の当月集計（管理者アカウント除く）
                </p>
              </div>
              <p className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm ring-1 ring-slate-200/80">
                一般 {dashboardMemberSplit.general.length} 名 · インターン {dashboardMemberSplit.intern.length} 名
              </p>
            </div>

            <div className="space-y-8">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
                <div className="mb-6 flex flex-wrap items-center gap-3">
                  <span className="rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
                    時給制
                  </span>
                  <h3 className="text-sm font-semibold text-slate-800">一般メンバー</h3>
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div className="flex aspect-square max-h-44 flex-col items-center justify-center rounded-2xl border border-slate-100 bg-slate-50 p-5 text-center sm:max-h-none">
                    <p className="text-xs font-medium text-slate-500">合計稼働時間</p>
                    <p className="mt-3 text-3xl font-bold tabular-nums leading-none tracking-tight text-slate-900 sm:text-4xl">
                      {formatDuration(dashboardGeneralMetrics.totalMinutes)}
                    </p>
                  </div>
                  <div className="flex aspect-square max-h-44 flex-col items-center justify-center rounded-2xl border border-slate-100 bg-slate-50 p-5 text-center sm:max-h-none">
                    <p className="text-xs font-medium text-slate-500">有効コールからのKC率</p>
                    <p className="mt-3 text-3xl font-bold tabular-nums leading-none tracking-tight text-slate-900 sm:text-4xl">
                      {dashboardGeneralMetrics.kcRate != null ? dashboardGeneralMetrics.kcRate.toFixed(1) : "—"}
                    </p>
                    {dashboardGeneralMetrics.kcRate != null ? (
                      <p className="mt-2 text-sm font-medium text-slate-500">%（目標 16%）</p>
                    ) : null}
                  </div>
                  <div className="flex aspect-square max-h-44 flex-col items-center justify-center rounded-2xl border border-slate-100 bg-slate-50 p-5 text-center sm:max-h-none">
                    <p className="text-xs font-medium text-slate-500">決アポ数</p>
                    <p className="mt-3 text-3xl font-bold tabular-nums leading-none tracking-tight text-slate-900 sm:text-4xl">
                      {dashboardGeneralMetrics.decisionMakerApo}
                      <span className="ml-1 text-lg font-semibold text-slate-500 sm:text-xl">件</span>
                    </p>
                  </div>
                  <div className="flex aspect-square max-h-44 flex-col items-center justify-center rounded-2xl border border-slate-100 bg-slate-50 p-5 text-center sm:max-h-none">
                    <p className="text-xs font-medium text-slate-500">有効コールからのアポ率</p>
                    <p className="mt-3 text-3xl font-bold tabular-nums leading-none tracking-tight text-slate-900 sm:text-4xl">
                      {dashboardGeneralMetrics.apoRate != null ? dashboardGeneralMetrics.apoRate.toFixed(1) : "—"}
                    </p>
                    {dashboardGeneralMetrics.apoRate != null ? (
                      <p className="mt-2 text-sm font-medium text-slate-500">%（目標 1%）</p>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-violet-200/80 bg-white p-6 sm:p-8">
                <div className="mb-6 flex flex-wrap items-center gap-3">
                  <span className="rounded-lg bg-violet-700 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
                    成果報酬制
                  </span>
                  <h3 className="text-sm font-semibold text-violet-950">インターン生</h3>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="flex min-h-[11rem] flex-col rounded-2xl border border-violet-100 bg-violet-50/60 p-6 sm:min-h-[12rem] sm:p-8">
                    <p className="text-xs font-medium text-violet-800/90">合計確定商談数（管理者確定）</p>
                    <div className="mt-auto grid flex-1 grid-cols-2 items-end gap-4 pt-6">
                      <div className="text-center">
                        <p className="text-4xl font-bold tabular-nums leading-none text-violet-950 sm:text-5xl">
                          {dashboardInternMetrics.confirmedDecision}
                        </p>
                        <p className="mt-2 text-xs font-medium text-slate-500">決裁者</p>
                      </div>
                      <div className="text-center">
                        <p className="text-4xl font-bold tabular-nums leading-none text-violet-950 sm:text-5xl">
                          {dashboardInternMetrics.confirmedNonDecision}
                        </p>
                        <p className="mt-2 text-xs font-medium text-slate-500">非決裁者</p>
                      </div>
                    </div>
                    <p className="mt-4 border-t border-violet-200/60 pt-4 text-center text-sm text-slate-500">
                      合計{" "}
                      <span className="font-semibold tabular-nums text-violet-900">
                        {dashboardInternMetrics.confirmedDecision + dashboardInternMetrics.confirmedNonDecision}
                      </span>{" "}
                      件
                    </p>
                  </div>
                  <div className="flex min-h-[11rem] flex-col justify-center rounded-2xl border border-violet-100 bg-violet-50/60 p-6 sm:min-h-[12rem] sm:p-8">
                    <p className="text-xs font-medium text-violet-800/90">合計発生報酬額（税込・単価適用後）</p>
                    <p className="mt-6 text-4xl font-bold tabular-nums leading-tight tracking-tight text-violet-950 sm:mt-8 sm:text-5xl">
                      {dashboardInternMetrics.totalRewardYen.toLocaleString("ja-JP")}
                      <span className="ml-2 text-xl font-semibold text-violet-700 sm:text-2xl">円</span>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>
          {dashboardMemberSplit.intern.length > 0 && (
            <section className="rounded-xl border-2 border-violet-300 bg-gradient-to-b from-white to-violet-50/50 p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-violet-950">インターン成果確定（管理者用）</h2>
                  <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-600">
                    インターン生のみ表示しています。入力した確定数は kpis テーブル（confirmed_dm / confirmed_non_dm）に保存され、請求書の成果報酬計算（単価適用）に反映されます。
                  </p>
                </div>
                <label className="flex shrink-0 flex-col gap-1">
                  <span className="text-xs font-medium text-violet-800">対象日</span>
                  <input
                    type="date"
                    value={internConfirmedPanelDate}
                    onChange={(e) => setInternConfirmedPanelDate(e.target.value)}
                    className="rounded border border-violet-300 bg-white px-3 py-2 text-sm text-slate-800"
                  />
                </label>
              </div>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <label className="flex min-w-[12rem] flex-1 flex-col gap-1 sm:max-w-md">
                  <span className="text-xs font-medium text-slate-600">名前・管理番号で検索</span>
                  <input
                    type="search"
                    value={internConfirmedSearch}
                    onChange={(e) => setInternConfirmedSearch(e.target.value)}
                    placeholder="例: 山田 / 012"
                    className="rounded border border-violet-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400"
                  />
                </label>
                <p className="text-xs text-slate-500">
                  {internConfirmedPanelMembers.length} / {dashboardMemberSplit.intern.length} 名を表示
                </p>
              </div>
              <div className="overflow-x-auto rounded-lg border border-violet-200 bg-white">
                <table className="w-full min-w-[32rem] text-left text-sm">
                  <thead>
                    <tr className="border-b border-violet-200 bg-violet-100/80 text-xs font-medium text-violet-950">
                      <th className="px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => toggleInternConfirmedSort("name")}
                          className="inline-flex items-center gap-1 hover:text-violet-700"
                        >
                          名前
                          <span className="text-[10px] opacity-70">{adminTableSortIcon(internConfirmedSort, "name")}</span>
                        </button>
                      </th>
                      <th className="px-2 py-2.5 text-center">
                        <button
                          type="button"
                          onClick={() => toggleInternConfirmedSort("invoice")}
                          className="inline-flex items-center gap-1 hover:text-violet-700"
                        >
                          管理番号
                          <span className="text-[10px] opacity-70">{adminTableSortIcon(internConfirmedSort, "invoice")}</span>
                        </button>
                      </th>
                      <th className="px-2 py-2.5 text-center whitespace-nowrap">決裁者確定</th>
                      <th className="px-2 py-2.5 text-center whitespace-nowrap">非決裁者確定</th>
                      <th className="px-2 py-2.5 text-right w-24" />
                    </tr>
                  </thead>
                  <tbody>
                    {internConfirmedPanelMembers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                          検索条件に一致するインターン生がいません
                        </td>
                      </tr>
                    ) : (
                      internConfirmedPanelMembers.map(({ mem }) => (
                        <InternConfirmedDashboardRow
                          key={mem.id}
                          member={mem}
                          dateYmd={internConfirmedPanelDate}
                          allKpiRecords={allKpiRecords}
                          busy={confirmedSaveBusyKey === `${mem.id}:${internConfirmedPanelDate}`}
                          onSave={(patch) => handleAdminSaveConfirmedApps(mem.id, internConfirmedPanelDate, patch)}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[11px] text-slate-500">
                各フィールドはフォーカスを外すと自動保存されます。「保存」で両方をまとめて保存できます。
              </p>
            </section>
          )}

          {dashboardMemberSplit.intern.length > 0 && (
            <section className="rounded-xl border border-violet-200 bg-white p-5 shadow-sm">
              <h2 className="mb-1 text-sm font-semibold text-violet-950">インターン確定商談の推移</h2>
              <p className="mb-4 text-xs text-slate-500">
                {currentYearMonth} の日別集計（confirmed_dm / confirmed_non_dm）。棒は左が決裁者・右が非決裁者です。
              </p>
              <InternConfirmedBarChart points={internConfirmedDailySeries} />
            </section>
          )}

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center gap-4">
              <h2 className="text-sm font-medium text-slate-700">チーム成果</h2>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-500">表示日付</span>
                <input
                  type="date"
                  value={dashboardDate}
                  onChange={(e) => setDashboardDate(e.target.value)}
                  className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-800"
                />
            </label>
            </div>
            <div className="mb-4 flex flex-wrap gap-4">
              <div className="rounded-lg bg-emerald-700 px-4 py-3 text-white">
                <div className="text-xs text-emerald-100">決裁者アポ合計</div>
                <div className="text-2xl font-bold">{dateDecision} 件</div>
              </div>
              <div className="rounded-lg bg-teal-700 px-4 py-3 text-white">
                <div className="text-xs text-teal-100">非決裁者アポ合計</div>
                <div className="text-2xl font-bold">{dateNonDecision} 件</div>
              </div>
              <div className="rounded-lg bg-amber-600 px-4 py-3 text-white">
                <div className="text-xs text-amber-100">本日の活動人数</div>
                <div className="text-2xl font-bold">{workingCountForDate} 名</div>
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-slate-500">アポ取得一覧（決裁者 or 非決裁者1件以上のメンバー、決裁者アポ多い順）</div>
              {apoListForDate.length === 0 ? (
                <p className="rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-500">指定された日のアポ獲得者はまだいません</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {apoListForDate.map(({ mem, dec, non }) => (
                    <span key={mem.id} className="inline-flex items-center rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-800">
                      <span className="font-medium">{mem.name}</span>
                      <span className="ml-1.5 text-slate-600">：決裁者{dec}件 / 非決裁者{non}件</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium text-slate-700">生産性指標（一般メンバー・時給制）</h2>
                <p className="mt-1 text-xs text-slate-500">
                  一般メンバー（インターン除く）の決裁者アポ1件あたりの活動時間。数値が小さいほど効率が良いです。週は月曜〜日曜で集計します。
                </p>
              </div>
              <label className="flex shrink-0 flex-col gap-1">
                <span className="text-xs font-medium text-slate-500">表示期間を選択</span>
                <select
                  value={productivityPeriodKey}
                  onChange={(e) => setProductivityPeriodKey(e.target.value)}
                  className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                >
                  {productivityPeriodOptions.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-6">
              <div className="rounded-lg bg-slate-800 px-4 py-3 text-white">
                <div className="text-xs text-slate-300">
                  {selectedProductivityPeriod.label} のアポ取得単価（一般メンバー）
                </div>
                <div className="mt-1 text-xl font-bold">
                  {dashboardProductivityGeneral.rangeApoCostMinutes != null ? `${formatDuration(Math.round(dashboardProductivityGeneral.rangeApoCostMinutes))}/件` : "—"}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  活動時間 {formatDuration(dashboardProductivityGeneral.rangeMinutes)} / 決裁者アポ {dashboardProductivityGeneral.rangeTotals.decisionMakerApo} 件
                </div>
              </div>
              {selectedProductivityPeriod.isMonth && selectedProductivityPeriod.monthLabel && (
                <div className="rounded-lg border-2 border-slate-600 bg-slate-700 px-4 py-3 text-white">
                  <div className="text-xs text-slate-300">
                    {(() => {
                      const [y, m] = selectedProductivityPeriod.monthLabel.split("-").map(Number);
                      const monthName = new Date(y, m - 1, 1).toLocaleDateString("ja-JP", { month: "long", year: "numeric" });
                      return `${monthName} の月間生産性スコア`;
                    })()}
                  </div>
                  <div className="mt-1 text-xl font-bold">
                    {dashboardProductivityGeneral.rangeApoCostMinutes != null
                      ? `${formatDuration(Math.round(dashboardProductivityGeneral.rangeApoCostMinutes))}/件`
                      : "—"}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    総活動時間 {formatDuration(dashboardProductivityGeneral.rangeMinutes)} / 決裁者アポ合計{" "}
                    {dashboardProductivityGeneral.rangeTotals.decisionMakerApo} 件
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {adminSection === "attendance" && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <header className="mb-6">
            <h2 className="text-sm font-medium text-slate-700">稼働状況（本日）</h2>
            <p className="mt-1 text-xs text-slate-500">まずメンバーを選んで活動記録を編集するか、下で本日の予定と稼働状況を確認できます。</p>
          </header>

          <div
            ref={attendanceRecordEditorRef}
            id="admin-attendance-record-editor"
            className="scroll-mt-24 mb-10 rounded-xl border-2 border-slate-300 bg-slate-50/95 p-5 shadow-md ring-1 ring-slate-200/80 sm:p-6"
          >
            <h3 className="text-sm font-semibold text-slate-900">活動記録の追加・編集</h3>
            <p className="mb-5 mt-1 text-xs text-slate-600">
              メンバーを選択し、記録の追加または既存記録の編集ができます。保存後は合計業務遂行時間・請求金額に即反映されます。
            </p>
            <div className="mb-4 flex flex-wrap items-end gap-4">
              <label className="flex min-w-[12rem] flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-700">メンバー</span>
                <select
                  value={recordListMemberId ?? ""}
                  onChange={(e) => setRecordListMemberId(e.target.value || null)}
                  className="rounded-lg border-2 border-slate-400 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 shadow-sm outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-300"
                >
                  <option value="">選択してください</option>
                  {activeMembers.map((mem) => (
                    <option key={mem.id} value={mem.id}>
                      {mem.name}
                    </option>
                  ))}
                </select>
              </label>
              {recordListMemberId && (
                <button
                  type="button"
                  disabled={!!recordFormMember || recordFormSaving}
                  onClick={() => {
                    const mem = members.find((m) => m.id === recordListMemberId);
                    if (mem) {
                      setRecordFormMember(mem);
                      setRecordFormRecord(null);
                      setRecordFormDate(getTodayJstDateString());
                      setRecordFormStart("09:00");
                      setRecordFormEnd("18:00");
                    }
                  }}
                  className="rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  活動記録を追加
                </button>
              )}
            </div>
            {recordListMemberId &&
              (() => {
                const userRecords = getRecordsForUser(allRecords, recordListMemberId);
                const sorted = [...userRecords].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);
                const mem = members.find((m) => m.id === recordListMemberId);
                return (
                  <div className="overflow-x-auto rounded-lg border border-slate-200/90 bg-white">
                    <table className="w-full min-w-[480px] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-100/90">
                          <th className="px-3 py-2.5 text-left font-medium text-slate-600">日付</th>
                          <th className="px-3 py-2.5 text-left font-medium text-slate-600">業務開始</th>
                          <th className="px-3 py-2.5 text-left font-medium text-slate-600">業務終了</th>
                          <th className="px-3 py-2.5 text-right font-medium text-slate-600">時間</th>
                          <th className="px-3 py-2.5 text-right font-medium text-slate-600">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sorted.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                              {mem?.name ?? ""} の記録はまだありません
                            </td>
                          </tr>
                        ) : (
                          sorted.map((r) => (
                            <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                              <td className="px-3 py-2.5 text-slate-800">{formatDisplayDate(r.date)}</td>
                              <td className="px-3 py-2.5 tabular-nums text-slate-700">{getTimeFromIso(r.startRounded)}</td>
                              <td className="px-3 py-2.5 tabular-nums text-slate-700">{getTimeFromIso(r.endRounded)}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{formatDuration(r.durationMinutes)}</td>
                              <td className="px-3 py-2.5 text-right">
                                <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
                                  <button
                                    type="button"
                                    disabled={recordFormSaving}
                                    onClick={() => {
                                      setRecordFormRecord(r);
                                      setRecordFormMember(members.find((m) => m.id === r.userId) ?? null);
                                      setRecordFormDate(r.date);
                                      setRecordFormStart(getTimeFromIso(r.startRounded));
                                      setRecordFormEnd(getTimeFromIso(r.endRounded));
                                    }}
                                    className="text-slate-600 underline hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    編集
                                  </button>
                                  <button
                                    type="button"
                                    disabled={recordDeletingId === r.id || recordFormSaving}
                                    onClick={() => void handleDeleteWorkRecord(r)}
                                    className="text-red-600 underline hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {recordDeletingId === r.id ? "削除中..." : "削除"}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
          </div>

          <div className="space-y-5 border-t border-slate-200 pt-8">
            <h3 className="text-sm font-medium text-slate-700">本日の稼働予定・状況</h3>
            <div className="rounded-lg border border-slate-200 bg-slate-50/90 p-4">
              <p className="mb-3 text-sm font-medium text-slate-800">
                👥 本日の稼働予定：合計 {todayPlannedShiftList.length}名
              </p>
              {todayPlannedShiftList.length === 0 ? (
                <p className="text-xs text-slate-600">本日、実際の稼働予定が入っているメンバーはいません。</p>
              ) : (
                <ul className="space-y-4 text-sm text-slate-800">
                  {todayPlannedShiftList.map((row) => (
                    <li key={row.userId} className="border-b border-slate-200/80 pb-4 last:border-0 last:pb-0">
                      <div>・{row.name} さん</div>
                      <div className="mt-1 whitespace-pre-wrap pl-1 text-slate-600">　予定：{row.plannedLabel}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <AdminSortableTh
                      label="名前"
                      sortKey="name"
                      sort={attendanceTodaySort}
                      onSort={(k) => toggleAttendanceTodaySort(k as AttendanceTodaySortKey)}
                      align="left"
                    />
                    <AdminSortableTh
                      label="ステータス"
                      sortKey="status"
                      sort={attendanceTodaySort}
                      onSort={(k) => toggleAttendanceTodaySort(k as AttendanceTodaySortKey)}
                      align="center"
                    />
                    <AdminSortableTh
                      label="当日の活動時間"
                      sortKey="minutes"
                      sort={attendanceTodaySort}
                      onSort={(k) => toggleAttendanceTodaySort(k as AttendanceTodaySortKey)}
                      align="right"
                    />
                    <th className="px-3 py-2.5 text-center text-xs font-medium text-slate-600 whitespace-nowrap">活動記録</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-slate-600">KPI</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAttendanceStatusRows.map(({ mem, open, todayMin }) => (
                    <tr key={mem.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                      <td className="px-3 py-2.5 font-medium text-slate-800">{mem.name}</td>
                      <td className="px-3 py-2.5 text-center">
                        {open ? (
                          <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">活動中</span>
                        ) : (
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">活動なし</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{formatDuration(todayMin)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openAdminActivityRecordModal(mem, todayStr, "new")}
                            className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-50 sm:text-xs"
                          >
                            新規登録
                          </button>
                          <button
                            type="button"
                            onClick={() => openAdminActivityRecordModal(mem, todayStr, "edit")}
                            className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-50 sm:text-xs"
                          >
                            編集
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            setAdminKpiModalTarget({ userId: mem.id, dateYmd: todayStr, memberName: mem.name, isIntern: mem.isIntern === true })
                          }
                          className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50"
                        >
                          KPI入力
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {recordFormMember && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (recordFormSaving) return;
            setRecordFormMember(null);
            setRecordFormRecord(null);
          }}
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-sm font-semibold text-slate-800">{recordFormRecord ? "活動記録を編集" : "活動記録を追加"}</h3>
            <p className="mb-2 text-xs text-slate-600">{recordFormMember.name}</p>
            <p className="mb-3 text-xs text-slate-500">
              過去に実績がなくても保存で新規登録されます。打刻ルールは管理者保存では適用されません。
            </p>
            <div className="mb-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">日付</span>
                <input type="date" value={recordFormDate} onChange={(e) => setRecordFormDate(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
                {isWeekendYmdJst(recordFormDate) && (
                  <p className="mt-1 text-xs font-medium text-amber-800">{JST_WEEKEND_WORK_REJECTED_MESSAGE}</p>
                )}
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">業務開始時間</span>
                <select value={recordFormStart} onChange={(e) => setRecordFormStart(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm">
                  {get15MinOptions().map((t) => (<option key={t} value={t}>{t}</option>))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">業務終了時間</span>
                <select value={recordFormEnd} onChange={(e) => setRecordFormEnd(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm">
                  {get15MinOptions().map((t) => (<option key={t} value={t}>{t}</option>))}
                </select>
              </label>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={recordFormSaving || isWeekendYmdJst(recordFormDate)}
                onClick={async () => {
                  if (isWeekendYmdJst(recordFormDate)) {
                    alert(JST_WEEKEND_WORK_REJECTED_MESSAGE);
                    return;
                  }
                  if (recordFormStart === recordFormEnd) {
                    alert(WORK_RECORD_SAME_START_END_MESSAGE);
                    return;
                  }
                  if (timeToMinutes(recordFormEnd) <= timeToMinutes(recordFormStart)) {
                    alert(WORK_RECORD_END_NOT_AFTER_START_MESSAGE);
                    return;
                  }
                  const built = buildWorkRecordFromTimes(recordFormDate, recordFormStart, recordFormEnd, recordFormMember.id, recordFormRecord?.id);
                  if (!built) {
                    alert(
                      `${WORK_RECORD_SAME_START_END_MESSAGE}（または丸め後に稼働が0分以下・同一日内に収まらない場合も保存できません）`
                    );
                    return;
                  }
                  if (built.durationMinutes > WORK_DURATION_SOFT_CONFIRM_MINUTES) {
                    const ok = window.confirm(
                      `稼働時間が ${formatDuration(WORK_DURATION_SOFT_CONFIRM_MINUTES)} を超えています（${formatDuration(built.durationMinutes)}）。この内容で保存しますか？`
                    );
                    if (!ok) return;
                  }
                  const userRecords = getRecordsForUser(allRecords, recordFormMember.id);
                  const next = recordFormRecord
                    ? userRecords.map((r) => (r.id === recordFormRecord.id ? built : r))
                    : [built, ...userRecords];
                  setRecordFormSaving(true);
                  try {
                    await onSaveMemberRecords(recordFormMember.id, next);
                    setRecordActivityToast({ message: "保存しました！", isError: false });
                    setRecordFormMember(null);
                    setRecordFormRecord(null);
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    setRecordActivityToast({ message: msg || "保存に失敗しました", isError: true });
                  } finally {
                    setRecordFormSaving(false);
                  }
                }}
                className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {recordFormSaving ? "保存中..." : "保存"}
              </button>
              <button
                type="button"
                disabled={recordFormSaving}
                onClick={() => {
                  setRecordFormMember(null);
                  setRecordFormRecord(null);
                }}
                className="rounded border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      <AdminKpiProxyModal
        target={adminKpiModalTarget}
        allKpiRecords={allKpiRecords}
        onClose={() => setAdminKpiModalTarget(null)}
        onSave={onSaveMemberKpi}
      />

      {adminSection === "shift" && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="mb-3 text-sm font-medium text-slate-700">稼働予定管理</h2>
          <p className="mb-3 text-xs text-slate-500">
            表示期間を選び、メンバー×日付のシフト表で確認できます。各セルに予定に加え、KPI（稼働実績）が入力されている日は実稼働時間（活動記録の合計）を表示します（KPI 未入力の日はグレー、入力済みは青系）。「今週」「来週」は月曜〜日曜の7日間です。メンバー行をタップすると、選択中の期間をまとめて編集できます。土曜・日曜は稼働予定の登録はできません（保存時は自動で「稼働予定なし」になります）。
          </p>
          <div className="mb-5 flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-[200px]">
              <span className="text-xs font-medium text-slate-600">開始日</span>
              <input
                type="date"
                value={shiftViewStart}
                onChange={(e) => setShiftViewStart(e.target.value)}
                className="w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800"
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-[200px]">
              <span className="text-xs font-medium text-slate-600">終了日</span>
              <input
                type="date"
                value={shiftViewEnd}
                onChange={(e) => setShiftViewEnd(e.target.value)}
                className="w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={applyShiftShortcutThisWeek}
                className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:text-sm"
              >
                今週
              </button>
              <button
                type="button"
                onClick={applyShiftShortcutNextWeek}
                className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:text-sm"
              >
                来週
              </button>
              <button
                type="button"
                onClick={applyShiftShortcutNextMonth}
                className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:text-sm"
              >
                来月
              </button>
              <button
                type="button"
                onClick={handleDownloadScheduleCsvForSelectedRange}
                className="rounded border border-emerald-600 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900 hover:bg-emerald-100 sm:text-sm"
              >
                CSVで出力
              </button>
              <button
                type="button"
                onClick={handleShiftRangePdfPrint}
                className="rounded border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-white hover:bg-slate-900 sm:text-sm"
              >
                PDFで出力（月〜金）
              </button>
            </div>
            <div className="flex flex-col gap-2 border-t border-slate-200 pt-3 sm:flex-row sm:flex-wrap sm:items-center">
              <button
                type="button"
                onClick={handleShiftRemindTestSend}
                disabled={shiftRemindTestSending}
                className="rounded border border-amber-500 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-50 sm:text-sm"
              >
                {shiftRemindTestSending ? "送信中…" : "【テスト】未入力者への催促通知を今すぐ飛ばす"}
              </button>
              {shiftRemindTestFeedback != null && (
                <div
                  className={`min-w-0 max-w-xl whitespace-pre-wrap text-xs font-medium sm:text-sm ${
                    shiftRemindTestFeedback.variant === "success"
                      ? "text-green-700"
                      : shiftRemindTestFeedback.variant === "info"
                        ? "text-slate-600"
                        : "text-red-700"
                  }`}
                  role="status"
                >
                  {shiftRemindTestFeedback.variant === "error"
                    ? `送信失敗\n${shiftRemindTestFeedback.message}`
                    : shiftRemindTestFeedback.message}
                </div>
              )}
              <p className="w-full text-[11px] text-slate-500 sm:text-xs">
                来週（月〜日）にシフトが1件もないメンバーへ、Cron と同じロジックで Slack に送ります。テストは曜日・時刻に関係なく即時に抽出・送信します。対象がいない場合は送信しません。
              </p>
            </div>
          </div>
          <p className="mb-4 text-xs font-medium text-slate-600">
            表示中: {formatDisplayDate(shiftRangeNorm.start)} ～ {formatDisplayDate(shiftRangeNorm.end)}（{shiftViewDateList.length}日間）
          </p>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[640px] border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <AdminSortableTh
                    label="名前"
                    sortKey="name"
                    sort={shiftScheduleSort?.column === "name" ? { key: "name", dir: shiftScheduleSort.dir } : null}
                    onSort={() => toggleShiftScheduleSort("name")}
                    align="left"
                    className="sticky left-0 z-20 min-w-[6rem] border-r border-slate-200 bg-slate-50 px-2 sm:px-3"
                  />
                  {shiftViewDateList.map((dateStr) => {
                    const active = shiftScheduleSort?.column === "date" && shiftScheduleSort.dateStr === dateStr;
                    const icon = adminTableSortIcon(active ? { key: "d", dir: shiftScheduleSort.dir } : null, "d");
                    return (
                      <th
                        key={dateStr}
                        className="min-w-[7.5rem] whitespace-nowrap px-2 py-2.5 text-center font-medium text-slate-600 sm:min-w-[8.5rem] sm:px-3"
                      >
                        <button
                          type="button"
                          onClick={() => toggleShiftScheduleSort("date", dateStr)}
                          title="クリック: 降順 → 昇順 → 元の順"
                          className="inline-flex w-full flex-col items-center gap-0.5 text-slate-600 hover:text-slate-900"
                        >
                          <span className="whitespace-pre-wrap">{formatScheduleColumnHeader(dateStr)}</span>
                          <span className="select-none text-slate-400" aria-hidden>
                            {icon}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedShiftGridMembers.map((mem) => (
                  <tr
                    key={mem.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setShiftEditMember(mem)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setShiftEditMember(mem);
                      }
                    }}
                    className="cursor-pointer border-b border-slate-100 last:border-b-0 hover:bg-slate-50/80 focus:bg-slate-100 focus:outline-none"
                  >
                    <td className="sticky left-0 z-10 border-r border-slate-100 bg-white px-2 py-2 font-medium text-slate-800 sm:px-3">
                      {mem.name}
                    </td>
                    {shiftViewDateList.map((dateStr) => {
                      const slot = scheduleJoinByUserDate.get(`${mem.id}\t${dateStr}`);
                      const s = slot?.shift;
                      const kpi = slot?.kpi;
                      const labor = getUserDayLaborSignals(allRecords, allOpenRecords, mem.id, dateStr);
                      const primary = formatAdminShiftSchedulePrimaryLine(s, labor);
                      const secondary = formatAdminShiftScheduleSecondaryLine(kpi, labor);
                      return (
                        <td
                          key={dateStr}
                          className={`align-top px-2 py-2 text-slate-600 sm:px-3 ${
                            secondary.highlight ? "bg-sky-50/80" : "bg-slate-50/50"
                          }`}
                        >
                          <div className="flex flex-col gap-0.5">
                            <span className="break-words text-slate-800">{primary}</span>
                            <span
                              className={`text-[10px] leading-tight sm:text-[11px] ${
                                secondary.highlight ? "font-medium text-blue-700" : "text-slate-400"
                              }`}
                            >
                              {secondary.text}
                            </span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {shiftEditMember !== null && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4" aria-modal="true" role="dialog">
              <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-lg sm:p-5">
                <h3 className="mb-1 text-sm font-semibold text-slate-800">{shiftEditMember.name} の稼働予定（エントリー）を編集</h3>
                <p className="mb-4 text-xs text-slate-500">
                  期間: {formatDisplayDate(shiftRangeNorm.start)} ～ {formatDisplayDate(shiftRangeNorm.end)}
                </p>
                <form onSubmit={handleSaveShiftWeek} className="space-y-3">
                  {shiftViewDateList.map((dateStr) => {
                    const f = shiftWeekForm[dateStr] || { s1: SHIFT_WEEKDAY_DEFAULT_START, e1: SHIFT_WEEKDAY_DEFAULT_END, s2: "", e2: "" };
                    const dayNone = f.s1 === ENTRY_NONE;
                    const morningStartOpts = shiftModalRestrictMorning
                      ? { minimumStartMinutes: SHIFT_PLANNED_NEW_MEMBER_EARLIEST_START_MINUTES }
                      : undefined;
                    const primaryStartOpts = buildShiftPrimaryPlannedStartSelectOptions(f.s1, morningStartOpts);
                    const primaryEndOpts = buildShiftPrimaryPlannedEndSelectOptions(f.e1, f.s1);
                    const secondaryStartOpts = buildShiftSecondaryPlannedStartSelectOptions(f.s2, morningStartOpts);
                    const secondaryEndOpts = buildShiftSecondaryPlannedEndSelectOptions(f.e2, f.s2);
                    const a = analyzeAdminShiftDay(f);
                    const weekend = isWeekendYmd(dateStr);
                    const actualGuard =
                      !isAdminUser &&
                      shiftEditMember !== null &&
                      dateHasShiftActualData(shiftEditMember.id, dateStr, allRecords, allKpiRecords, allOpenRecords);
                    return (
                      <div key={dateStr} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                        <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <span className="text-xs font-medium text-slate-700">{formatShiftSectionDateHeading(dateStr)}</span>
                          {!weekend && (
                            <label
                              className={`flex items-center gap-2 text-xs ${actualGuard ? "cursor-not-allowed text-slate-400" : "cursor-pointer text-slate-600"}`}
                              title={
                                actualGuard
                                  ? "この日は活動記録または KPI 実績があるため、稼働予定を「なし」にできません"
                                  : undefined
                              }
                            >
                              <input
                                type="checkbox"
                                checked={dayNone}
                                onChange={(e) => setAdminShiftDayNone(dateStr, e.target.checked)}
                                disabled={actualGuard}
                                className="rounded border-slate-300"
                              />
                              この日の稼働予定なし
                            </label>
                          )}
                        </div>
                        {!weekend && actualGuard && (
                          <p className="mb-2 text-[11px] text-sky-800">
                            実績データがある日のため、予定の削除（稼働予定なしへの変更）はできません。
                          </p>
                        )}
                        {weekend && (
                          <p className="text-xs font-medium text-slate-600">土曜・日曜は稼働予定を登録できません（自動で「稼働予定なし」として保存されます）。</p>
                        )}
                        {!weekend && !dayNone && (
                          <>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
                                <span className="w-10 shrink-0 text-xs text-slate-500 sm:w-12">予定1</span>
                                <select
                                  value={f.s1}
                                  onChange={(e) => updateShiftDay(dateStr, "s1", e.target.value)}
                                  className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 py-1.5 text-xs sm:px-2 sm:text-sm"
                                >
                                  {primaryStartOpts.map((o) => (
                                    <option key={`${o.value}-${o.disabled ? "d" : "e"}`} value={o.value} disabled={o.disabled}>
                                      {o.label ?? o.value}
                                    </option>
                                  ))}
                                </select>
                                <span className="shrink-0 text-slate-400">～</span>
                                <select
                                  value={f.e1}
                                  onChange={(e) => updateShiftDay(dateStr, "e1", e.target.value)}
                                  className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 py-1.5 text-xs sm:px-2 sm:text-sm"
                                >
                                  {primaryEndOpts.map((o) => (
                                    <option key={`${o.value}-${o.disabled ? "d" : "e"}`} value={o.value} disabled={o.disabled}>
                                      {o.label ?? o.value}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
                                <span className="w-10 shrink-0 text-xs text-slate-500 sm:w-12">予定2</span>
                                <select
                                  value={f.s2}
                                  onChange={(e) => updateShiftDay(dateStr, "s2", e.target.value)}
                                  className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 py-1.5 text-xs sm:px-2 sm:text-sm"
                                >
                                  {secondaryStartOpts.map((o) => (
                                    <option key={`${o.value || "__empty__"}-${o.disabled ? "d" : "e"}`} value={o.value} disabled={o.disabled}>
                                      {o.label ?? (o.value === "" ? "—" : o.value)}
                                    </option>
                                  ))}
                                </select>
                                <span className="shrink-0 text-slate-400">～</span>
                                <select
                                  value={f.e2}
                                  onChange={(e) => updateShiftDay(dateStr, "e2", e.target.value)}
                                  className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 py-1.5 text-xs sm:px-2 sm:text-sm"
                                >
                                  {secondaryEndOpts.map((o) => (
                                    <option key={`${o.value || "__empty__"}-${o.disabled ? "d" : "e"}`} value={o.value} disabled={o.disabled}>
                                      {o.label ?? (o.value === "" ? "—" : o.value)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <div className="mt-2 space-y-1">
                              {a.slot1Inverted && (
                                <p className="text-xs font-medium text-red-600">終了時間は開始時間より後の時刻にしてください</p>
                              )}
                              {a.slot2Incomplete && (
                                <p className="text-xs font-medium text-red-600">予定2は開始・終了を両方指定するか、両方空にしてください</p>
                              )}
                              {a.slot2Inverted && (
                                <p className="text-xs font-medium text-red-600">予定2: 終了時間は開始時間より後の時刻にしてください</p>
                              )}
                              {a.slotWindowEarly && (
                                <p className="text-xs font-medium text-red-600">{SHIFT_PLANNED_START_BUSINESS_RULE_MESSAGE}</p>
                              )}
                              {a.slotWindowLate && (
                                <p className="text-xs font-medium text-red-600">{SHIFT_PLANNED_LATEST_BUSINESS_RULE_MESSAGE}</p>
                              )}
                              <p
                                className={`text-xs font-medium ${!dayNone && a.totalMinutes <= 0 ? "text-red-600" : "text-slate-600"}`}
                              >
                                合計稼働時間（目安）: {dayNone ? "—" : formatDuration(a.totalMinutes)}
                                {!dayNone && a.totalMinutes <= 0 && !a.slot1Inverted && (
                                  <span className="ml-1">（0時間以下のため保存できません）</span>
                                )}
                              </p>
                            </div>
                          </>
                        )}
                        {!weekend && dayNone && <p className="text-xs text-slate-500">稼働予定なし</p>}
                      </div>
                    );
                  })}
                  <div className="flex flex-col gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end sm:gap-2">
                    <button
                      type="button"
                      onClick={() => setShiftEditMember(null)}
                      className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      キャンセル
                    </button>
                    <button
                      type="submit"
                      disabled={!shiftModalCanSave}
                      className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      保存
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </section>
      )}

      {adminSection === "kpi" && (
        <section className="space-y-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <h2 className="mb-4 text-sm font-medium text-slate-700">期間指定（カスタム集計）</h2>
            <div className="mb-4 flex flex-wrap items-end gap-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">開始日</span>
                <input
                  type="date"
                  value={rangeStart}
                  onChange={(e) => setRangeStart(e.target.value)}
                  className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-800"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">終了日</span>
                <input
                  type="date"
                  value={rangeEnd}
                  onChange={(e) => setRangeEnd(e.target.value)}
                  className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-800"
                />
              </label>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              集計期間: {kpiRangeNorm.start} ～ {kpiRangeNorm.end}（一般メンバー・時給制のみ。インターンは下部の成果報酬集計を参照）
            </p>
            {(() => {
              const { totals: rangeTotals, totalMinutes: summaryTotalMinutes, aposPerHour } =
                kpiGeneralRangeMetrics;
              const rangeValidRate = safeRatePercent(rangeTotals.validCalls, rangeTotals.totalCalls);
              const rangeKcRate = safeRatePercent(rangeTotals.kcCount, rangeTotals.validCalls);
              const rangeApoRate = safeRatePercent(rangeTotals.decisionMakerApo, rangeTotals.validCalls);
              const summaryTotalPay = dashboardMemberSplit.general.reduce((s, mem) => {
                const mins = getTotalMinutesForUserInDateRange(
                  allRecords,
                  mem.id,
                  kpiRangeNorm.start,
                  kpiRangeNorm.end
                );
                return s + calcMonthlyPay(mins, mem.hourlyRate ?? DEFAULT_HOURLY_RATE);
              }, 0);
              const rangeDecisionApoUnitYen = decisionMakerApoUnitYenFromPay(
                summaryTotalPay,
                rangeTotals.decisionMakerApo
              );
              return (
                <>
                  <div className="mb-4 flex flex-wrap gap-3">
                    <div className="min-w-[8.5rem] flex-1 rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm">
                      <div className="text-xs font-medium text-slate-600">総稼働時間</div>
                      <div className="mt-1 text-lg font-bold tabular-nums text-slate-900 sm:text-xl">
                        {formatDuration(summaryTotalMinutes)}
                      </div>
                    </div>
                    <div className="min-w-[8.5rem] flex-1 rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm">
                      <div className="text-xs font-medium text-slate-600">総支払額（時給）</div>
                      <div className="mt-1 text-lg font-bold tabular-nums text-slate-900 sm:text-xl">
                        {summaryTotalPay.toLocaleString("ja-JP")}円
                      </div>
                    </div>
                    <div className="min-w-[8.5rem] flex-1 rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm">
                      <div className="text-xs font-medium text-slate-600">決アポ数</div>
                      <div className="mt-1 text-lg font-bold tabular-nums text-slate-900 sm:text-xl">
                        {rangeTotals.decisionMakerApo} 件
                      </div>
                    </div>
                    <div className="min-w-[8.5rem] flex-1 rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm">
                      <div className="text-xs font-medium text-slate-600">時間あたりアポ率</div>
                      <div className="mt-1 text-lg font-bold tabular-nums text-slate-900 sm:text-xl">
                        {aposPerHour != null ? `${aposPerHour.toFixed(2)} 件/時間` : "—"}
                      </div>
                    </div>
                    <div className="min-w-[8.5rem] flex-1 rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm">
                      <div className="text-xs font-medium text-slate-600">合計アポ数</div>
                      <div className="mt-1 text-lg font-bold tabular-nums text-slate-900 sm:text-xl">
                        {rangeTotals.totalApo} 件
                      </div>
                    </div>
                    <div className="min-w-[8.5rem] flex-1 rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm">
                      <div className="text-xs font-medium text-slate-600">決アポ単価</div>
                      <div className="mt-1 text-lg font-bold tabular-nums text-slate-900 sm:text-xl">
                        {rangeDecisionApoUnitYen != null
                          ? `${Math.round(rangeDecisionApoUnitYen).toLocaleString("ja-JP")}円`
                          : "—"}
                      </div>
                    </div>
                  </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-lg bg-slate-800 p-4 text-white">
                    <div className="text-xs text-slate-300">総コール数</div>
                    <div className="text-2xl font-bold">{rangeTotals.totalCalls}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">総有効コール数</div>
                    <div className="text-2xl font-bold">{rangeTotals.validCalls}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">決裁者アポ数</div>
                    <div className="text-2xl font-bold">{rangeTotals.decisionMakerApo}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">有効率</div>
                    <div className="text-2xl font-bold">{rangeValidRate != null ? `${rangeValidRate}%` : "—"}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">有効コールからのKC率（目標 16%）</div>
                    <div className="text-2xl font-bold">{rangeKcRate != null ? `${rangeKcRate.toFixed(1)}%` : "—"}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">有効コールからのアポ率（目標 1%）</div>
                    <div className="text-2xl font-bold">{rangeApoRate != null ? `${rangeApoRate.toFixed(1)}%` : "—"}</div>
                  </div>
                </div>
                </>
              );
            })()}
          </div>

          <div className="border-t border-slate-200 pt-6">
          <h2 className="mb-4 text-sm font-medium text-slate-700">業務委託KPI（日別・一般メンバー）</h2>
          <p className="mb-3 max-w-3xl text-xs text-slate-500">
            時給制メンバーのみ表示しています。行をクリックすると KPI 入力フォームが開きます。インターン生は下部の確定数一覧を参照してください。
          </p>
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">表示日付</span>
              <input
                type="date"
                value={kpiDate}
                onChange={(e) => setKpiDate(e.target.value)}
                className="rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <AdminSortableTh
                    label="名前"
                    sortKey="name"
                    sort={kpiDailySort}
                    onSort={(k) => toggleKpiDailySort(k as AdminKpiDailySortKey)}
                    align="left"
                  />
                  <AdminSortableTh
                    label="総コール数"
                    sortKey="totalCalls"
                    sort={kpiDailySort}
                    onSort={(k) => toggleKpiDailySort(k as AdminKpiDailySortKey)}
                    align="right"
                  />
                  <AdminSortableTh
                    label="総有効コール数"
                    sortKey="validCalls"
                    sort={kpiDailySort}
                    onSort={(k) => toggleKpiDailySort(k as AdminKpiDailySortKey)}
                    align="right"
                  />
                  <AdminSortableTh
                    label="KC"
                    sortKey="kc"
                    sort={kpiDailySort}
                    onSort={(k) => toggleKpiDailySort(k as AdminKpiDailySortKey)}
                    align="right"
                  />
                  <AdminSortableTh
                    label="追いかけ"
                    sortKey="followUp"
                    sort={kpiDailySort}
                    onSort={(k) => toggleKpiDailySort(k as AdminKpiDailySortKey)}
                    align="right"
                  />
                  <AdminSortableTh
                    label="決裁者アポ"
                    sortKey="decisionApo"
                    sort={kpiDailySort}
                    onSort={(k) => toggleKpiDailySort(k as AdminKpiDailySortKey)}
                    align="right"
                  />
                  <AdminSortableTh
                    label="非決裁者アポ"
                    sortKey="nonDecisionApo"
                    sort={kpiDailySort}
                    onSort={(k) => toggleKpiDailySort(k as AdminKpiDailySortKey)}
                    align="right"
                  />
                  <AdminSortableTh
                    label="有効率"
                    sortKey="validRate"
                    sort={kpiDailySort}
                    onSort={(k) => toggleKpiDailySort(k as AdminKpiDailySortKey)}
                    align="right"
                  />
                  <AdminSortableTh
                    label="KC率"
                    sortKey="kcRate"
                    sort={kpiDailySort}
                    onSort={(k) => toggleKpiDailySort(k as AdminKpiDailySortKey)}
                    align="right"
                  />
                  <AdminSortableTh
                    label="アポ率"
                    sortKey="apoRate"
                    sort={kpiDailySort}
                    onSort={(k) => toggleKpiDailySort(k as AdminKpiDailySortKey)}
                    align="right"
                  />
                </tr>
              </thead>
              <tbody>
                {kpiDailyRowsGeneral.map(({ mem, dayKpi, rates }) => {
                  const openAdminKpiModal = () =>
                    setAdminKpiModalTarget({ userId: mem.id, dateYmd: kpiDate, memberName: mem.name, isIntern: mem.isIntern === true });
                  const cellBtn =
                    "w-full min-w-[2.5rem] rounded px-1 py-0.5 text-right tabular-nums hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-400";
                  return (
                    <tr key={mem.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                      <td className="px-3 py-2.5 font-medium text-slate-800">
                        <button type="button" onClick={openAdminKpiModal} className="text-left font-medium underline decoration-slate-300 underline-offset-2 hover:bg-slate-100 hover:no-underline rounded px-0.5 -mx-0.5">
                          {mem.name}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                        <button type="button" onClick={openAdminKpiModal} className={cellBtn}>
                          {dayKpi ? dayKpi.totalCalls : "—"}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                        <button type="button" onClick={openAdminKpiModal} className={cellBtn}>
                          {dayKpi ? dayKpi.validCalls : "—"}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                        <button type="button" onClick={openAdminKpiModal} className={cellBtn}>
                          {dayKpi ? dayKpi.kcCount : "—"}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                        <button type="button" onClick={openAdminKpiModal} className={cellBtn}>
                          {dayKpi ? dayKpi.followUpCreated : "—"}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                        <button type="button" onClick={openAdminKpiModal} className={cellBtn}>
                          {dayKpi ? dayKpi.decisionMakerApo : "—"}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                        <button type="button" onClick={openAdminKpiModal} className={cellBtn}>
                          {dayKpi ? dayKpi.nonDecisionMakerApo : "—"}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                        <button type="button" onClick={openAdminKpiModal} className={cellBtn}>
                          {rates.validRate != null ? `${rates.validRate}%` : "—"}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                        <button type="button" onClick={openAdminKpiModal} className={cellBtn}>
                          {rates.kcRate != null ? `${rates.kcRate}%` : "—"}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                        <button type="button" onClick={openAdminKpiModal} className={cellBtn}>
                          {rates.apoRate != null ? `${rates.apoRate}%` : "—"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

          <div className="mt-8 border-t border-violet-200 pt-8">
            <h2 className="mb-1 text-base font-semibold text-violet-950">インターン成果報酬集計</h2>
            <p className="mb-4 max-w-3xl text-xs text-slate-500">
              期間 {kpiRangeNorm.start} ～ {kpiRangeNorm.end} の管理者確定数（confirmed_dm / confirmed_non_dm）と、メンバー別単価に基づく発生報酬額です。稼働時間・アポ率は含みません。
            </p>
            <div className="mb-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-violet-800 p-4 text-white">
                <div className="text-xs text-violet-200">決裁者商談確定（合計）</div>
                <div className="mt-1 text-2xl font-bold tabular-nums">{kpiInternRangeMetrics.confirmedDecision} 件</div>
              </div>
              <div className="rounded-lg bg-violet-700 p-4 text-white">
                <div className="text-xs text-violet-200">非決裁者商談確定（合計）</div>
                <div className="mt-1 text-2xl font-bold tabular-nums">{kpiInternRangeMetrics.confirmedNonDecision} 件</div>
              </div>
              <div className="rounded-lg bg-violet-900 p-4 text-white">
                <div className="text-xs text-violet-200">発生報酬額（税込）</div>
                <div className="mt-1 text-2xl font-bold tabular-nums">
                  {kpiInternRangeMetrics.totalRewardYen.toLocaleString("ja-JP")} 円
                </div>
              </div>
            </div>
            {dashboardMemberSplit.intern.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-violet-200">
                <table className="w-full min-w-[28rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-violet-200 bg-violet-50 text-xs font-medium text-violet-950">
                      <th className="px-3 py-2.5 text-left">名前</th>
                      <th className="px-3 py-2.5 text-right">決裁者確定</th>
                      <th className="px-3 py-2.5 text-right">非決裁者確定</th>
                      <th className="px-3 py-2.5 text-right">発生報酬額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kpiInternRangeRows.map(({ member, confirmedDecision, confirmedNonDecision, rewardYen }) => (
                      <tr key={member.id} className="border-b border-violet-100 hover:bg-violet-50/40">
                        <td className="px-3 py-2.5 font-medium text-slate-800">{member.name}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{confirmedDecision}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{confirmedNonDecision}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                          {rewardYen.toLocaleString("ja-JP")} 円
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-lg bg-violet-50 px-4 py-3 text-sm text-slate-600">インターン生が登録されていません。</p>
            )}

            <h3 className="mb-3 mt-8 text-sm font-medium text-violet-950">インターン（日別・確定数のみ）</h3>
            <p className="mb-3 text-xs text-slate-500">表示日 {kpiDate}。クリックで商談確定数を入力できます。</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[24rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-violet-200 bg-violet-50">
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-violet-950">名前</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-violet-950">決裁者確定</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-violet-950">非決裁者確定</th>
                  </tr>
                </thead>
                <tbody>
                  {kpiDailyRowsIntern.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-sm text-slate-500">
                        インターン生がいません
                      </td>
                    </tr>
                  ) : (
                    kpiDailyRowsIntern.map(({ mem, dayKpi }) => {
                      const open = () =>
                        setAdminKpiModalTarget({
                          userId: mem.id,
                          dateYmd: kpiDate,
                          memberName: mem.name,
                          isIntern: true,
                        });
                      const btn =
                        "w-full min-w-[2.5rem] rounded px-1 py-0.5 text-right tabular-nums hover:bg-violet-100";
                      return (
                        <tr key={mem.id} className="border-b border-violet-100 hover:bg-violet-50/30">
                          <td className="px-3 py-2.5">
                            <button type="button" onClick={open} className="font-medium text-violet-950 underline decoration-violet-300 underline-offset-2">
                              {mem.name}
                            </button>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <button type="button" onClick={open} className={btn}>
                              {dayKpi?.confirmedDecisionMakerApps ?? 0}
                            </button>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <button type="button" onClick={open} className={btn}>
                              {dayKpi?.confirmedNonDecisionMakerApps ?? 0}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          </div>
          </div>
        </section>
      )}

      {adminSection === "dailyActual" && (
        <section className="space-y-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <h2 className="text-sm font-medium text-slate-700">日別実績（予定・実績）</h2>
            <p className="mt-1 max-w-3xl text-xs text-slate-500">
              <strong className="font-medium text-slate-600">shifts</strong> にその日の稼働予定があるメンバーは、活動記録がなくても一覧に表示します（左結合相当）。
              予定のみで実績がない日は <strong className="font-medium text-amber-800">実績 0h（未入力）</strong> と表示し、入力漏れに気づきやすくしています。
              <span className="mt-1 block text-slate-500">
                氏名をクリックすると、その日付の KPI を管理者として入力・修正できます。
              </span>
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">開始日</span>
                <input
                  type="date"
                  value={dailyActualStart}
                  onChange={(e) => setDailyActualStart(e.target.value)}
                  className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-800"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">終了日</span>
                <input
                  type="date"
                  value={dailyActualEnd}
                  onChange={(e) => setDailyActualEnd(e.target.value)}
                  className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-800"
                />
              </label>
            </div>
          </div>
          {dailyActualDisplayBlocks.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
              この期間に、稼働予定または実稼働がある日はありません。
            </p>
          ) : (
            <div className="space-y-8">
              {dailyActualDisplayBlocks.map((block) => (
                <div key={block.dateStr} className="overflow-hidden rounded-xl border border-slate-200">
                  <div className="flex flex-col gap-1 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-sm font-semibold text-slate-800">{formatScheduleColumnHeader(block.dateStr)}</h3>
                    <p className="text-xs text-slate-600">
                      稼働人数 <span className="font-semibold tabular-nums text-slate-900">{block.totalPeople}</span> 名
                      <span className="mx-2 text-slate-300">/</span>
                      合計実稼働{" "}
                      <span className="font-semibold tabular-nums text-slate-900">
                        {formatDuration(block.totalWorkMinutes)}
                      </span>
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1000px] border-collapse text-left text-xs sm:text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-white">
                          <AdminSortableTh
                            label="氏名"
                            sortKey="name"
                            sort={adminDailyActualSort[block.dateStr] ?? null}
                            onSort={(k) => toggleDailyActualSort(block.dateStr, k as DailyActualSortKey)}
                            align="left"
                          />
                          <AdminSortableTh
                            label="稼働予定"
                            sortKey="planned"
                            sort={adminDailyActualSort[block.dateStr] ?? null}
                            onSort={(k) => toggleDailyActualSort(block.dateStr, k as DailyActualSortKey)}
                            align="left"
                          />
                          <AdminSortableTh
                            label="稼働開始（実績）"
                            sortKey="start"
                            sort={adminDailyActualSort[block.dateStr] ?? null}
                            onSort={(k) => toggleDailyActualSort(block.dateStr, k as DailyActualSortKey)}
                            align="left"
                          />
                          <AdminSortableTh
                            label="稼働終了（実績）"
                            sortKey="end"
                            sort={adminDailyActualSort[block.dateStr] ?? null}
                            onSort={(k) => toggleDailyActualSort(block.dateStr, k as DailyActualSortKey)}
                            align="left"
                          />
                          <AdminSortableTh
                            label="休憩時間"
                            sortKey="break"
                            sort={adminDailyActualSort[block.dateStr] ?? null}
                            onSort={(k) => toggleDailyActualSort(block.dateStr, k as DailyActualSortKey)}
                            align="left"
                          />
                          <AdminSortableTh
                            label="実稼働時間"
                            sortKey="work"
                            sort={adminDailyActualSort[block.dateStr] ?? null}
                            onSort={(k) => toggleDailyActualSort(block.dateStr, k as DailyActualSortKey)}
                            align="left"
                          />
                          <th className="px-3 py-2.5 text-center text-xs font-medium text-slate-600 whitespace-nowrap">
                            決裁者商談確定
                          </th>
                          <th className="px-3 py-2.5 text-center text-xs font-medium text-slate-600 whitespace-nowrap">
                            非決裁者商談確定
                          </th>
                          <th className="px-3 py-2.5 text-right text-xs font-medium text-slate-600 whitespace-nowrap">
                            活動記録
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {block.rows.map(({ member, shift, agg, plannedMinutes, openOnDate }) => {
                          const missingActual = agg == null && !openOnDate && plannedMinutes > 0;
                          return (
                            <tr
                              key={member.id}
                              className={`border-b border-slate-100 last:border-b-0 hover:bg-slate-50/80 ${
                                missingActual ? "bg-amber-50/60" : ""
                              }`}
                            >
                              <td className="px-3 py-2.5 font-medium text-slate-800">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setAdminKpiModalTarget({
                                      userId: member.id,
                                      dateYmd: block.dateStr,
                                      memberName: member.name,
                                      isIntern: member.isIntern === true,
                                    })
                                  }
                                  className="text-left font-medium text-slate-800 underline decoration-slate-300 underline-offset-2 hover:bg-slate-100 hover:no-underline rounded px-0.5 -mx-0.5"
                                >
                                  {member.name}
                                </button>
                              </td>
                              <td className="whitespace-pre-line px-3 py-2.5 font-mono tabular-nums text-slate-700">
                                {formatShiftPlannedForDailyActualCell(shift)}
                              </td>
                              <td className="px-3 py-2.5 tabular-nums text-slate-700">
                                {agg
                                  ? formatTimeForReport(agg.earliestStartIso)
                                  : openOnDate
                                    ? formatTimeForReport(openOnDate.startRounded)
                                    : "—"}
                              </td>
                              <td className="px-3 py-2.5 tabular-nums text-slate-700">
                                {agg ? formatTimeForReport(agg.latestEndIso) : openOnDate ? "—（未終了）" : "—"}
                              </td>
                              <td className="px-3 py-2.5 tabular-nums text-slate-700">
                                {agg && agg.breakOrGapMinutes > 0 ? formatDuration(agg.breakOrGapMinutes) : "—"}
                              </td>
                              <td className="px-3 py-2.5 font-medium tabular-nums text-slate-900">
                                {agg ? (
                                  formatDuration(agg.totalWorkMinutes)
                                ) : openOnDate ? (
                                  <span className="text-sky-800">集計中（終了打刻待ち）</span>
                                ) : plannedMinutes > 0 ? (
                                  <span className="text-amber-800">実績 0h（未入力）</span>
                                ) : (
                                  <span className="text-slate-500">実績 0h</span>
                                )}
                              </td>
                              <td className="px-2 py-2.5 text-center align-middle">
                                <input
                                  type="number"
                                  min={0}
                                  defaultValue={
                                    getKpiForDate(getKpiForUser(allKpiRecords, member.id), block.dateStr)
                                      ?.confirmedDecisionMakerApps ?? 0
                                  }
                                  key={`cdm-${member.id}-${block.dateStr}-${
                                    getKpiForDate(getKpiForUser(allKpiRecords, member.id), block.dateStr)
                                      ?.confirmedDecisionMakerApps ?? 0
                                  }`}
                                  disabled={confirmedSaveBusyKey === `${member.id}:${block.dateStr}`}
                                  onBlur={(e) =>
                                    void handleAdminSaveConfirmedApps(member.id, block.dateStr, {
                                      confirmedDecisionMakerApps: parseKpiFieldStringToInt(e.target.value),
                                    })
                                  }
                                  className="w-14 rounded border border-slate-300 px-1 py-1 text-center text-xs tabular-nums"
                                  aria-label={`${member.name} 決裁者商談確定`}
                                />
                              </td>
                              <td className="px-2 py-2.5 text-center align-middle">
                                <input
                                  type="number"
                                  min={0}
                                  defaultValue={
                                    getKpiForDate(getKpiForUser(allKpiRecords, member.id), block.dateStr)
                                      ?.confirmedNonDecisionMakerApps ?? 0
                                  }
                                  key={`cndm-${member.id}-${block.dateStr}-${
                                    getKpiForDate(getKpiForUser(allKpiRecords, member.id), block.dateStr)
                                      ?.confirmedNonDecisionMakerApps ?? 0
                                  }`}
                                  disabled={confirmedSaveBusyKey === `${member.id}:${block.dateStr}`}
                                  onBlur={(e) =>
                                    void handleAdminSaveConfirmedApps(member.id, block.dateStr, {
                                      confirmedNonDecisionMakerApps: parseKpiFieldStringToInt(e.target.value),
                                    })
                                  }
                                  className="w-14 rounded border border-slate-300 px-1 py-1 text-center text-xs tabular-nums"
                                  aria-label={`${member.name} 非決裁者商談確定`}
                                />
                              </td>
                              <td className="px-3 py-2.5 text-right align-middle">
                                <div className="flex flex-wrap justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => openAdminActivityRecordModal(member, block.dateStr, "new")}
                                    className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium text-slate-800 hover:bg-slate-50 sm:text-[11px]"
                                  >
                                    新規登録
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openAdminActivityRecordModal(member, block.dateStr, "edit")}
                                    className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium text-slate-800 hover:bg-slate-50 sm:text-[11px]"
                                  >
                                    編集
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {adminSection === "planActualGap" && (
        <section className="space-y-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <h2 className="text-sm font-medium text-slate-700">予実乖離アーカイブ</h2>
            <p className="mt-1 max-w-3xl text-xs text-slate-500">
              <strong className="font-medium text-slate-600">shifts</strong>の稼働予定分数と、
              <strong className="font-medium text-slate-600">活動記録（attendance）</strong>の当日合計分数を比較します。
              差が<strong className="font-medium text-slate-700">{PLAN_ACTUAL_TIME_TOLERANCE_MIN}分以上</strong>
              、または<strong className="font-medium text-slate-700">予定があるのに実績が0分</strong>の日を一覧します。
              あわせて<strong className="font-medium text-slate-600">KPI</strong>が未入力（全指標0）の日も同じ行で表示します。
              乖離が<strong className="font-medium text-red-700">{PLAN_ACTUAL_LARGE_GAP_MIN}分以上</strong>
              または実績なしは赤字で強調します。
              <strong className="font-medium text-slate-600">予実調整</strong>では、
              <strong className="font-medium text-sky-800">予定に合わせる</strong>（活動記録を予定枠で上書き）、
              <strong className="font-medium text-amber-900">実績に合わせる</strong>（稼働予定を実績時刻に更新）、
              <strong className="font-medium text-violet-900">稼働なし</strong>
              （欠勤・実績0分として確定し、当該日の稼働予定を「なし」に変更）、または管理者向けの
              <strong className="font-medium text-emerald-900">手動で時間を編集</strong>
              （開始・終了・休憩を1分単位で指定して活動記録を上書き）が選べます。
              確定後はダッシュボードの未対応件数からも除外されます（実績がない日のみ「稼働なし」可。実績がある日は「実績に合わせる」）。
              <span className="mt-1 block text-violet-800">
                インターン生（成果報酬型）は出退勤打刻の管理対象外のため、この一覧には表示しません。
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              登録データ上の最古日: <span className="font-mono tabular-nums">{gapDataEarliest}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50/80 p-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">開始日</span>
              <input
                type="date"
                value={gapStart}
                min={gapDataEarliest}
                max={gapEnd || todayStr}
                onChange={(e) => setGapStart(e.target.value)}
                className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">終了日</span>
              <input
                type="date"
                value={gapEnd}
                min={gapStart || gapDataEarliest}
                max={todayStr}
                onChange={(e) => setGapEnd(e.target.value)}
                className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
              />
            </label>
            <label className="flex min-w-[10rem] flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">月別に期間を設定</span>
              <select
                value={gapMonthQuick}
                onChange={(e) => {
                  const ym = e.target.value;
                  setGapMonthQuick(ym);
                  if (!ym) return;
                  const r = getMonthDateRange(ym, todayStr);
                  setGapStart(r.start);
                  setGapEnd(r.end);
                }}
                className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
              >
                <option value="">選択してください</option>
                {roiSelectableMonths.map((ym) => (
                  <option key={ym} value={ym}>
                    {ym}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                setGapStart(gapDataEarliest);
                setGapEnd(todayStr);
                setGapMonthQuick("");
                setGapPage(1);
              }}
              className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              全履歴（最古日〜今日）
            </button>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="flex min-w-[12rem] max-w-md flex-1 flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">氏名・日付で絞り込み</span>
              <input
                type="search"
                value={gapSearch}
                onChange={(e) => setGapSearch(e.target.value)}
                placeholder="例: 田中 / 2026-03"
                className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-800"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                const blob = new Blob([buildPlanActualGapCsv(gapFiltered)], {
                  type: "text/csv;charset=utf-8;",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `plan_actual_gap_${gapStart}_${gapEnd}.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
              }}
              className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600"
            >
              CSVダウンロード（絞り込み反映）
            </button>
          </div>

          <p className="text-xs text-slate-600">
            該当 <span className="font-semibold tabular-nums text-slate-900">{gapFiltered.length}</span> 件
            <span className="mx-2 text-slate-300">/</span>
            {gapFiltered.length === 0
              ? "表示する行はありません"
              : `${(gapPageClamped - 1) * gapPageSize + 1}〜${Math.min(gapPageClamped * gapPageSize, gapFiltered.length)} 件目を表示`}
          </p>

          {gapFiltered.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
              この条件では予実乖離・KPI未入力に該当する行はありません。
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[1180px] border-collapse text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-3 py-2.5 font-medium text-slate-600">日付</th>
                    <th className="px-3 py-2.5 font-medium text-slate-600">氏名</th>
                    <th className="px-3 py-2.5 font-medium text-slate-600">予定時間</th>
                    <th className="px-3 py-2.5 font-medium text-slate-600">実績時間</th>
                    <th className="px-3 py-2.5 font-medium text-slate-600">乖離</th>
                    <th className="px-3 py-2.5 font-medium text-slate-600">KPI</th>
                    <th className="px-3 py-2.5 font-medium text-slate-600">予定枠</th>
                    <th className="px-3 py-2.5 font-medium text-slate-600">予実調整</th>
                  </tr>
                </thead>
                <tbody>
                  {gapPageRows.map((r) => {
                    const rowStress = r.severeTime;
                    const rowWarn = !rowStress && (r.timeMismatch || r.kpiMissing);
                    const gapApproveKey = planActualGapApprovalKey(r.userId, r.date);
                    const isGapApproved = planActualGapApprovedKeys.has(gapApproveKey);
                    const gapResolution = planActualGapResolutionByKey.get(gapApproveKey) ?? null;
                    return (
                      <tr
                        key={`${r.userId}-${r.date}`}
                        className={`border-b last:border-b-0 ${
                          isGapApproved
                            ? "border-slate-200 bg-slate-100/95 text-slate-600"
                            : rowStress
                              ? "border-slate-100 bg-red-50/90 text-red-800"
                              : rowWarn
                                ? "border-slate-100 bg-amber-50/80 text-amber-950"
                                : "border-slate-100 text-slate-800"
                        }`}
                      >
                        <td className="px-3 py-2.5 font-mono text-xs tabular-nums sm:text-sm">{r.date}</td>
                        <td className="px-3 py-2.5 font-medium">{r.memberName}</td>
                        <td className="px-3 py-2.5 tabular-nums">{formatDuration(r.plannedMinutes)}</td>
                        <td className="px-3 py-2.5 tabular-nums">
                          {r.actualMinutes > 0 ? formatDuration(r.actualMinutes) : "—"}
                        </td>
                        <td
                          className={`px-3 py-2.5 font-semibold tabular-nums ${
                            isGapApproved ? "text-slate-600" : rowStress ? "text-red-700" : rowWarn ? "text-amber-900" : ""
                          }`}
                        >
                          {formatPlanActualGapDiffLabel(r)}
                        </td>
                        <td className="px-3 py-2.5">
                          {r.kpiMissing ? (
                            <span className="rounded bg-amber-200/80 px-2 py-0.5 text-xs font-medium text-amber-950">
                              未入力
                            </span>
                          ) : (
                            <span className="text-slate-600">入力あり</span>
                          )}
                        </td>
                        <td className="max-w-[200px] px-3 py-2.5 text-xs text-slate-600">{r.plannedTimeLabel}</td>
                        <td className="min-w-[17rem] max-w-[22rem] px-3 py-2.5 align-top">
                          {isGapApproved ? (
                            <div className="flex flex-col gap-2">
                              <div className="flex flex-wrap gap-1.5">
                                <span
                                  className={`inline-flex rounded border px-2 py-1 text-[11px] font-medium sm:text-xs ${
                                    gapResolution === "planned"
                                      ? "border-sky-700 bg-sky-200 text-sky-950"
                                      : "border-slate-200 bg-slate-50 text-slate-400"
                                  }`}
                                  title="活動記録を予定枠の時刻・分数に揃えます"
                                >
                                  予定に合わせる
                                </span>
                                <span
                                  className={`inline-flex rounded border px-2 py-1 text-[11px] font-medium sm:text-xs ${
                                    gapResolution === "actual"
                                      ? "border-amber-700 bg-amber-200 text-amber-950"
                                      : "border-slate-200 bg-slate-50 text-slate-400"
                                  }`}
                                  title="稼働予定を打刻の実績時刻に合わせて更新します"
                                >
                                  実績に合わせる
                                </span>
                                <span
                                  className={`inline-flex rounded border px-2 py-1 text-[11px] font-medium sm:text-xs ${
                                    gapResolution === "absent"
                                      ? "border-violet-700 bg-violet-200 text-violet-950"
                                      : "border-slate-200 bg-slate-50 text-slate-400"
                                  }`}
                                  title="実績0分として欠勤確定し、予定を「なし」にします"
                                >
                                  稼働なし
                                </span>
                                <span
                                  className={`inline-flex rounded border px-2 py-1 text-[11px] font-medium sm:text-xs ${
                                    gapResolution === "manual"
                                      ? "border-emerald-700 bg-emerald-200 text-emerald-950"
                                      : "border-slate-200 bg-slate-50 text-slate-400"
                                  }`}
                                  title="管理者が開始・終了・休憩を直接指定して活動記録を確定しました"
                                >
                                  手動確定
                                </span>
                              </div>
                              <p className="text-[11px] font-medium leading-snug text-slate-700 sm:text-xs">
                                {gapResolution === "planned" &&
                                  "予定で確定済み（活動記録を予定枠に合わせました。欠勤・早退等は予定分数で処理）"}
                                {gapResolution === "actual" &&
                                  "実績で確定済み（稼働予定を実績時刻に更新。残業・延長等は実績を正）"}
                                {gapResolution === "absent" &&
                                  "稼働なしで確定済み（欠勤として0時間扱い。当該日の稼働予定は「なし」に更新しました）"}
                                {gapResolution === "manual" &&
                                  "手動確定済み（管理者が入力した開始・終了・休憩に基づき活動記録を上書き。集計は確定時間を採用）"}
                                {gapResolution === null && "確定済み（従来の承認データ／解決方法は未記録）"}
                              </p>
                              {isAdminUser && onApplyManualPlanActualGap && (
                                <button
                                  type="button"
                                  disabled={gapApprovalBusy}
                                  onClick={() => toggleGapManualEditor(r)}
                                  className="self-start text-left text-[11px] font-medium text-emerald-800 underline decoration-emerald-400 decoration-1 underline-offset-2 hover:text-emerald-950 disabled:opacity-40"
                                >
                                  {gapManualEditor?.key === gapApproveKey ? "手動入力を閉じる" : "時刻を手動で再編集"}
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col gap-2">
                              <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
                                <div className="flex flex-wrap gap-1.5">
                                  <button
                                    type="button"
                                    disabled={gapApprovalBusy}
                                    title="打刻を予定枠に合わせ直し、請求・集計は予定の時間を正とします"
                                    onClick={() => void handleResolvePlanActualGapRow(r.userId, r.date, "planned")}
                                    className="rounded border border-sky-600 bg-sky-50 px-2 py-1.5 text-[11px] font-medium text-sky-950 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50 sm:text-xs"
                                  >
                                    予定に合わせる
                                  </button>
                                  <button
                                    type="button"
                                    disabled={gapApprovalBusy || r.actualMinutes <= 0}
                                    title={
                                      r.actualMinutes <= 0
                                        ? "実績（打刻）がないため使えません"
                                        : "稼働予定を実際の打刻時刻に合わせて上書きします"
                                    }
                                    onClick={() => void handleResolvePlanActualGapRow(r.userId, r.date, "actual")}
                                    className="rounded border border-amber-600 bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40 sm:text-xs"
                                  >
                                    実績に合わせる
                                  </button>
                                  <button
                                    type="button"
                                    disabled={gapApprovalBusy || r.actualMinutes > 0}
                                    title={
                                      r.actualMinutes > 0
                                        ? "打刻がある日は選べません（実績に合わせるか、記録削除後に利用）"
                                        : "欠勤として0時間で確定し、この日の稼働予定を「なし」にします（予定はあったが一度も打刻されなかった日向け）"
                                    }
                                    onClick={() => void handleResolvePlanActualGapRow(r.userId, r.date, "absent")}
                                    className="rounded border border-violet-600 bg-violet-50 px-2 py-1.5 text-[11px] font-medium text-violet-950 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40 sm:text-xs"
                                  >
                                    稼働なし（欠勤）
                                  </button>
                                </div>
                                {isAdminUser && onApplyManualPlanActualGap && (
                                  <button
                                    type="button"
                                    disabled={gapApprovalBusy}
                                    onClick={() => toggleGapManualEditor(r)}
                                    className="text-[11px] font-medium text-emerald-800 underline decoration-emerald-400 decoration-1 underline-offset-2 hover:text-emerald-950 disabled:opacity-40 sm:text-xs"
                                  >
                                    {gapManualEditor?.key === gapApproveKey ? "入力欄を閉じる" : "手動で時間を編集"}
                                  </button>
                                )}
                              </div>
                              <p className="text-[10px] leading-snug text-slate-500 sm:text-[11px]">
                                ホバーで各ボタンの意味を表示します。実績0分の日は「稼働なし」で欠勤確定できます。
                              </p>
                            </div>
                          )}
                          {gapManualEditor?.key === gapApproveKey && isAdminUser && onApplyManualPlanActualGap && (
                            <div className="mt-2 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/40 p-2.5">
                              <p className="text-[10px] leading-snug text-emerald-950 sm:text-[11px]">
                                開始・終了・休憩（分）を1分単位で指定し、当日の活動記録を1件に差し替えます。保存すると予実は「手動確定」となり、修正前の活動記録とKPIは監査ログに残ります。
                              </p>
                              <div className="flex flex-wrap items-end gap-2">
                                <label className="flex flex-col gap-0.5 text-[10px] font-medium text-slate-700">
                                  開始
                                  <input
                                    type="time"
                                    step={60}
                                    value={gapManualEditor.start}
                                    onChange={(e) =>
                                      setGapManualEditor((prev) =>
                                        prev && prev.key === gapApproveKey
                                          ? { ...prev, start: e.target.value }
                                          : prev
                                      )
                                    }
                                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                                  />
                                </label>
                                <label className="flex flex-col gap-0.5 text-[10px] font-medium text-slate-700">
                                  終了
                                  <input
                                    type="time"
                                    step={60}
                                    value={gapManualEditor.end}
                                    onChange={(e) =>
                                      setGapManualEditor((prev) =>
                                        prev && prev.key === gapApproveKey
                                          ? { ...prev, end: e.target.value }
                                          : prev
                                      )
                                    }
                                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                                  />
                                </label>
                                <label className="flex flex-col gap-0.5 text-[10px] font-medium text-slate-700">
                                  休憩（分）
                                  <input
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={gapManualEditor.breakMin}
                                    onChange={(e) =>
                                      setGapManualEditor((prev) =>
                                        prev && prev.key === gapApproveKey
                                          ? { ...prev, breakMin: e.target.value }
                                          : prev
                                      )
                                    }
                                    className="w-20 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                                  />
                                </label>
                                <button
                                  type="button"
                                  disabled={gapApprovalBusy}
                                  onClick={() => void handleGapManualSave()}
                                  className="rounded bg-emerald-700 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 sm:text-xs"
                                >
                                  保存して確定
                                </button>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {gapFiltered.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <span className="text-xs text-slate-600">
                ページ {gapPageClamped} / {gapTotalPages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={gapPageClamped <= 1}
                  onClick={() => setGapPage((p) => Math.max(1, p - 1))}
                  className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  前へ
                </button>
                <button
                  type="button"
                  disabled={gapPageClamped >= gapTotalPages}
                  onClick={() => setGapPage((p) => Math.min(gapTotalPages, p + 1))}
                  className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  次へ
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {adminSection === "roi" && isAdminUser && (
        <section className="space-y-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <h2 className="text-sm font-medium text-slate-700">生産性分析（ROI）</h2>
            <p className="mt-1 max-w-2xl text-xs text-slate-500">
              創出価値額＝総コール×{ROI_YEN_PER_CALL}円＋追いかけ作成×{ROI_YEN_PER_FOLLOWUP}円＋非決裁者アポ×
              {ROI_YEN_PER_NON_DECISION_APO}円＋決裁者アポ×{ROI_YEN_PER_DECISION_APO.toLocaleString()}円。総コスト＝稼働時間×各自の委託料単価（給与相当）＋固定費
              {ROI_PER_PERSON_FIXED_COST_YEN.toLocaleString()}円／人（オートコール{ROI_FIXED_COST_AUTOCALL_YEN.toLocaleString()}円＋管理
              {ROI_FIXED_COST_ADMIN_YEN.toLocaleString()}円）。ROI＝創出価値÷総コスト。
            </p>
            <p className="mt-2 text-xs font-medium text-slate-700">
              集計期間: {roiRange.start} ～ {roiRange.end}
              <span className="ml-2 text-slate-600">
                ／ 対象メンバー: {roiFilteredMembers.length}名
                {roiSelectedMemberIds == null ? "（全員）" : roiFilteredMembers.length === 0 ? "（未選択）" : "（指定）"}
              </span>
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-700">集計するメンバー</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setRoiSelectedMemberIds(null)}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  全員
                </button>
                <button
                  type="button"
                  onClick={() => setRoiSelectedMemberIds(roiTargetMembers.map((m) => m.id))}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  全選択
                </button>
                <button
                  type="button"
                  onClick={() => setRoiSelectedMemberIds([])}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  全解除
                </button>
              </div>
            </div>
            <p className="mb-3 text-xs text-slate-500">チェックを外すとそのメンバーを集計から除外します。「全員」は委託メンバー全員が対象です。</p>
            <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
              {roiTargetMembers.map((m) => {
                const checked =
                  roiSelectedMemberIds == null ? true : roiSelectedMemberIds.includes(m.id);
                return (
                  <label
                    key={m.id}
                    className="flex cursor-pointer items-center gap-2 rounded border border-transparent px-2 py-1 hover:bg-white/80"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setRoiSelectedMemberIds((prev) => {
                          if (prev == null) {
                            return roiTargetMembers.map((x) => x.id).filter((id) => id !== m.id);
                          }
                          if (prev.includes(m.id)) {
                            return prev.filter((id) => id !== m.id);
                          }
                          return [...prev, m.id];
                        });
                      }}
                      className="rounded border-slate-300 text-slate-700"
                    />
                    <span className="text-sm text-slate-800">{m.name}</span>
                    <span className="text-xs text-slate-400">{m.loginAccount || ""}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-4 border-b border-slate-100 pb-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">対象月（プリセット）</span>
              <select
                value={roiYearMonth}
                onChange={(e) => handleRoiMonthChange(e.target.value)}
                className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
              >
                {Array.from(new Set([...roiSelectableMonths, roiYearMonth]))
                  .sort()
                  .reverse()
                  .map((ym) => {
                    const [yy, mm] = ym.split("-");
                    return (
                      <option key={ym} value={ym}>
                        {yy}年{mm}月
                      </option>
                    );
                  })}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">期間指定・開始日</span>
              <input
                type="date"
                value={roiStartDate}
                onChange={(e) => setRoiStartDate(e.target.value)}
                className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-800"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">期間指定・終了日</span>
              <input
                type="date"
                value={roiEndDate}
                onChange={(e) => setRoiEndDate(e.target.value)}
                className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-800"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setRoiEndDate(todayStr);
                setRoiStartDate(addCalendarDays(todayStr, -6));
                setRoiYearMonth(todayStr.slice(0, 7));
              }}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              直近1週間
            </button>
            <button
              type="button"
              onClick={() => {
                const start = firstDayOfRollingCalendarMonths(todayStr, 3);
                setRoiStartDate(start);
                setRoiEndDate(todayStr);
                setRoiYearMonth(todayStr.slice(0, 7));
              }}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              直近3ヶ月
            </button>
            <button
              type="button"
              onClick={() => {
                const start = firstDayOfRollingCalendarMonths(todayStr, 10);
                setRoiStartDate(start);
                setRoiEndDate(todayStr);
                setRoiYearMonth(todayStr.slice(0, 7));
              }}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              直近10ヶ月
            </button>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="mb-2 text-xs font-medium text-slate-600">ROI 判定（信号機）</p>
            <ul className="space-y-1.5 text-xs text-slate-600">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
                <span>赤（ROI 1.0未満）: 支払った総コスト（給与＋固定費）に見合う創出価値が低い（要フォロー・契約見直しの検討材料）</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400" />
                <span>黄（1.0以上〜2.0未満）: 最低限の貢献（教育・オペ改善の余地）</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                <span>緑（2.0以上）: 貢献度が高い</span>
              </li>
              <li className="text-slate-500">
                固定費を含むため、稼働ゼロでも総コストは最低{ROI_PER_PERSON_FIXED_COST_YEN.toLocaleString()}円／人となり、ROI＝創出価値÷総コストで算出されます
              </li>
            </ul>
          </div>

          <div className="overflow-x-auto rounded border border-slate-200">
            <div className="flex flex-wrap items-center justify-end gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
              <button
                type="button"
                onClick={handleRoiCsvDownload}
                className="rounded bg-slate-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-600"
              >
                CSVをダウンロード
              </button>
              <button
                type="button"
                onClick={() => void handleSlackManualRoiReport()}
                disabled={slackManualReportSending}
                className="rounded bg-[#611f69] px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-[#4a1548] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {slackManualReportSending ? "送信中..." : "Slackにレポートを送信"}
              </button>
            </div>
            <table className="w-full min-w-[1100px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <RoiKpiOutsourceTh
                    label="氏名"
                    sortKey="name"
                    sort={kpiOutsourceSort}
                    onSort={onKpiOutsourceHeaderClick}
                    align="left"
                  />
                  <RoiKpiOutsourceTh
                    label="実稼働合計"
                    sublabel="（期間内）"
                    sortKey="workMinutes"
                    sort={kpiOutsourceSort}
                    onSort={onKpiOutsourceHeaderClick}
                  />
                  <RoiKpiOutsourceTh label="総コール" sortKey="totalCalls" sort={kpiOutsourceSort} onSort={onKpiOutsourceHeaderClick} />
                  <RoiKpiOutsourceTh label="有効コール" sortKey="validCalls" sort={kpiOutsourceSort} onSort={onKpiOutsourceHeaderClick} />
                  <RoiKpiOutsourceTh label="アポ数" sublabel="（決裁+非）" sortKey="totalApo" sort={kpiOutsourceSort} onSort={onKpiOutsourceHeaderClick} />
                  <RoiKpiOutsourceTh label="決アポ数" sublabel="（決裁者）" sortKey="decisionApo" sort={kpiOutsourceSort} onSort={onKpiOutsourceHeaderClick} />
                  <RoiKpiOutsourceTh label="有効率" sublabel="（%）" sortKey="validRate" sort={kpiOutsourceSort} onSort={onKpiOutsourceHeaderClick} />
                  <RoiKpiOutsourceTh label="アポ率" sublabel="（決裁者÷KC）" sortKey="apoRateKc" sort={kpiOutsourceSort} onSort={onKpiOutsourceHeaderClick} />
                  <RoiKpiOutsourceTh label="決アポ率" sublabel="（決裁÷有効）" sortKey="decisionApoOverValid" sort={kpiOutsourceSort} onSort={onKpiOutsourceHeaderClick} />
                  <RoiKpiOutsourceTh label="生産性" sublabel="（有効/ h）" sortKey="productivity" sort={kpiOutsourceSort} onSort={onKpiOutsourceHeaderClick} />
                  <RoiKpiOutsourceTh
                    label="合計委託料"
                    sublabel="（稼働×単価）"
                    sortKey="commissionYen"
                    sort={kpiOutsourceSort}
                    onSort={onKpiOutsourceHeaderClick}
                  />
                  <th className="px-2 py-2.5 text-right font-medium text-slate-600 sm:px-3">創出価値</th>
                  <RoiKpiOutsourceTh
                    label="総コスト"
                    sublabel="（給与／固定）"
                    sortKey="totalCostYen"
                    sort={kpiOutsourceSort}
                    onSort={onKpiOutsourceHeaderClick}
                  />
                  <RoiKpiOutsourceTh label="ROI" sortKey="roi" sort={kpiOutsourceSort} onSort={onKpiOutsourceHeaderClick} />
                  <th className="px-2 py-2.5 text-center font-medium text-slate-600 sm:px-3">信号</th>
                  <th className="px-2 py-2.5 text-right font-medium text-slate-600 sm:px-3">
                    決裁÷総
                    <span className="block text-[10px] font-normal text-slate-500">（参考）</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {kpiOutsourceTableRows.map((row) => (
                  <tr
                    key={row.memberId}
                    className={`border-b border-slate-100 ${
                      row.signal === "red"
                        ? "bg-red-50/90"
                        : row.signal === "yellow"
                          ? "bg-amber-50/90"
                          : row.signal === "green"
                            ? "bg-emerald-50/90"
                            : ""
                    }`}
                  >
                    <td className="px-2 py-2.5 font-medium text-slate-800 sm:px-3">{row.name}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-700 sm:px-3">
                      {formatDuration(row.totalMinutes)}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-700 sm:px-3">{row.kpiTotalCalls}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-700 sm:px-3">{row.kpiValidCalls}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-700 sm:px-3">{row.kpiTotalApo}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-700 sm:px-3">{row.kpiDecisionApo}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-700 sm:px-3">
                      {row.kpiValidRate != null ? `${row.kpiValidRate}%` : "—"}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-700 sm:px-3">
                      {row.kpiApoRateKc != null ? `${row.kpiApoRateKc}%` : "—"}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-700 sm:px-3">
                      {row.kpiDecisionApoOverValid != null ? `${row.kpiDecisionApoOverValid}%` : "—"}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-700 sm:px-3">
                      {row.productivityValidPerHour != null ? row.productivityValidPerHour.toFixed(2) : "—"}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-700 sm:px-3">
                      ¥{row.laborCommissionYen.toLocaleString("ja-JP")}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-700 sm:px-3">¥{row.valueYen.toLocaleString("ja-JP")}</td>
                    <td className="px-2 py-2.5 text-right text-xs tabular-nums leading-snug text-slate-700 sm:px-3">
                      <span className="font-medium">¥{row.costYen.toLocaleString("ja-JP")}</span>
                      <span className="mt-0.5 block text-[11px] font-normal text-slate-500">
                        給与: ¥{row.laborCostYen.toLocaleString("ja-JP")} / 固定: ¥
                        {row.fixedCostYen.toLocaleString("ja-JP")}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums font-medium text-slate-800 sm:px-3">
                      {row.roi != null ? row.roi.toFixed(2) : "—"}
                    </td>
                    <td className="px-2 py-2.5 text-center sm:px-3">
                      {row.signal === "red" && (
                        <span className="inline-flex rounded-full bg-red-600 px-2 py-0.5 text-xs font-medium text-white">赤</span>
                      )}
                      {row.signal === "yellow" && (
                        <span className="inline-flex rounded-full bg-amber-500 px-2 py-0.5 text-xs font-medium text-white">黄</span>
                      )}
                      {row.signal === "green" && (
                        <span className="inline-flex rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white">緑</span>
                      )}
                      {row.signal === "neutral" && <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-600 sm:px-3">
                      {row.decisionApoRate != null ? `${row.decisionApoRate}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="mb-1 text-sm font-medium text-slate-700">
              トレンド：チーム日次 ROI（{roiRange.start} ～ {roiRange.end}）
            </h3>
            <p className="mb-4 text-xs text-slate-500">
              その日のチーム全体の創出価値÷コスト（給与＋固定費の日別按分）。伸び・下落の傾向を把握するための目安です。
            </p>
            <RoiTrendChart points={roiDailyPoints} />
          </div>
        </section>
      )}

      {adminSection === "productivityExport" && isAdminUser && (
        <section className="space-y-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <h2 className="text-sm font-medium text-slate-800">生産性データ CSV（全メンバー）</h2>
            <p className="mt-1 max-w-3xl text-xs text-slate-500">
              指定した期間について、業務委託メンバー（管理者アカウント除外）の KPI・稼働実績を CSV で出力します。文字コードは{" "}
              <span className="font-medium text-slate-700">BOM 付き UTF-8</span>
              のため、Excel でそのまま開いても日本語が文字化けしにくい設定です。
            </p>
            <p className="mt-2 text-xs font-medium text-slate-700">
              出力期間: {peRange.start} ～ {peRange.end}{" "}
              <span className="font-normal text-slate-500">
                ／ 対象: {roiFilteredMembers.length}名
                {roiSelectedMemberIds == null ? "（ROI タブと同様「全員」）" : "（ROI タブで指定したメンバーのみ）"}
              </span>
            </p>
            <p className="mt-1 text-xs text-amber-800/90">
              メンバーの絞り込みは「生産性分析（ROI）」タブのチェックボックスと共通です。変更後はこの画面に戻ってダウンロードしてください。
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-slate-50/80 p-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">開始日</span>
              <input
                type="date"
                value={peStartDate}
                onChange={(e) => setPeStartDate(e.target.value)}
                className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">終了日</span>
              <input
                type="date"
                value={peEndDate}
                onChange={(e) => setPeEndDate(e.target.value)}
                className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setPeEndDate(todayStr);
                  setPeStartDate(addCalendarDays(todayStr, -6));
                }}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                直近1週間
              </button>
              <button
                type="button"
                onClick={() => {
                  const ym = todayStr.slice(0, 7);
                  const { start, end } = getMonthDateRange(ym, todayStr);
                  setPeStartDate(start);
                  setPeEndDate(end);
                }}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                今月（暦）
              </button>
              <button
                type="button"
                onClick={() => {
                  setPeStartDate(roiRange.start);
                  setPeEndDate(roiRange.end);
                }}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                ROI と同じ期間
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="mb-3 text-xs font-medium text-slate-700">ダウンロード</p>
            <ul className="mb-4 list-inside list-disc space-y-1 text-xs text-slate-600">
              <li>
                <strong className="text-slate-800">日次明細</strong>
                ：メンバー×日付。業務委託KPI の全項目（総コール〜非決裁者アポ）と、画面上と同じ式の有効率・KC率・アポ率（決裁/KC）に加え、派生の率・決アポ単価・生産性などを含みます。
              </li>
              <li>
                <strong className="text-slate-800">メンバー別集計</strong>
                ：期間をメンバーごとに合算した1行。集計の率は「期間指定（カスタム集計）」ブロックと同じく合計値から算出します。
              </li>
              <li>
                <strong className="text-slate-800">両方</strong>
                ：上記2ファイルを続けて保存（ブラウザにより2回目の保存確認が出ることがあります）。
              </li>
            </ul>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handlePeDailyCsvDownload}
                disabled={roiFilteredMembers.length === 0}
                className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                日次明細 CSV
              </button>
              <button
                type="button"
                onClick={handlePeSummaryCsvDownload}
                disabled={roiFilteredMembers.length === 0}
                className="rounded-lg border border-slate-400 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                メンバー別集計 CSV
              </button>
              <button
                type="button"
                onClick={handlePeBothCsvDownload}
                disabled={roiFilteredMembers.length === 0}
                className="rounded-lg border border-emerald-600 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                両方ダウンロード
              </button>
            </div>
          </div>
        </section>
      )}

      {adminSection === "settings" && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-medium text-slate-700">管理設定（メンバー追加・編集）</h2>
          {invoiceSaveHint ? (
            <div
              className="mb-4 flex flex-wrap items-start justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              role="status"
            >
              <p className="min-w-0 flex-1">{invoiceSaveHint}</p>
              <button
                type="button"
                className="shrink-0 text-xs font-medium text-amber-800 underline hover:text-amber-950"
                onClick={() => setInvoiceSaveHint(null)}
              >
                閉じる
              </button>
            </div>
          ) : null}
          <p className="mb-4 text-xs text-slate-500">
            無効化したメンバーの復元・完全削除は{" "}
            <a href="/admin/members/archived" className="font-medium text-slate-700 underline hover:text-slate-900">
              アーカイブ一覧
            </a>
            からも行えます。
          </p>

          <div className="mb-6 flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50/50 p-4">
            <span className="text-xs font-medium text-slate-600">
              Slack 稼働予定者通知（日本時間 朝 8:00 前後の本番 Cron と同じ内容・Vercel Cron は CRON_SECRET 必須）
            </span>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-3">
              <label className="flex min-w-0 flex-col gap-1 sm:max-w-[12rem]">
                <span className="text-xs font-medium text-slate-600">テスト送信する日付</span>
                <input
                  type="date"
                  value={slackDailyTestDate}
                  onChange={(e) => setSlackDailyTestDate(e.target.value)}
                  className="rounded border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800"
                />
              </label>
              <button
                type="button"
                onClick={() => void handleSlackTestSend()}
                disabled={slackTestSending}
                className="w-fit rounded bg-slate-600 px-4 py-2 text-sm font-medium text-white hover:bg-slate-500 disabled:opacity-50"
              >
                {slackTestSending ? "送信中…" : "その日付でテスト送信"}
              </button>
            </div>
            {slackTestFeedback != null && (
              <div
                className={`min-w-0 max-w-xl whitespace-pre-wrap text-sm font-medium ${
                  slackTestFeedback.variant === "success"
                    ? "text-green-700"
                    : slackTestFeedback.variant === "info"
                      ? "text-slate-600"
                      : "text-red-600"
                }`}
                role="status"
              >
                {slackTestFeedback.variant === "error" ? `送信失敗\n${slackTestFeedback.message}` : slackTestFeedback.message}
              </div>
            )}
            <p className="text-xs text-slate-500">
              自動送信は <code className="rounded bg-slate-200 px-1">/api/slack-daily</code>（GET）のみ。Cron では土曜・日曜（JST の当日）は送信しません。手動で土日に送る場合は{" "}
              <code className="rounded bg-slate-200 px-1">?test=true</code> 付き GET または POST の{" "}
              <code className="rounded bg-slate-200 px-1">{`{"test":true}`}</code>。上のテストは<strong className="font-medium text-slate-700">選択した日付</strong>の予定一覧を土日も含め送信します。環境変数{" "}
              <code className="rounded bg-slate-200 px-1">SLACK_WEBHOOK_URL</code>（共通）または日次通知専用{" "}
              <code className="rounded bg-slate-200 px-1">SLACK_WEBHOOK_DAILY_URL</code>、および{" "}
              <code className="rounded bg-slate-200 px-1">CRON_SECRET</code> を Vercel に設定してください。他の Slack 通知は{" "}
              <code className="rounded bg-slate-200 px-1">.env.example</code> の用途別 Webhook を参照してください。
            </p>
          </div>

          <div className="mb-6 flex flex-col gap-3 rounded-lg border border-slate-200 bg-amber-50/40 p-4 ring-1 ring-amber-200/60">
            <span className="text-xs font-medium text-slate-800">
              生産性低下アラート（KPI 保存直後・即時／1時間あたり有効コール10件未満・SLACK_WEBHOOK_PRODUCTIVITY_URL）
            </span>
            <p className="text-xs text-slate-600">
              指定メンバー・指定日の打刻と KPI から判定し、本番と同じ体裁で Slack に送ります（メンション付き）。通常は閾値未満のときだけ送信します。
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="flex min-w-0 flex-col gap-1 sm:max-w-[14rem]">
                <span className="text-xs font-medium text-slate-600">メンバー</span>
                <select
                  value={productivitySlackTestMemberId}
                  onChange={(e) => setProductivitySlackTestMemberId(e.target.value)}
                  className="rounded border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800"
                >
                  {productivitySlackTestCandidates.length === 0 ? (
                    <option value="">（管理者以外のメンバーがありません）</option>
                  ) : (
                    productivitySlackTestCandidates.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="flex min-w-0 flex-col gap-1 sm:max-w-[12rem]">
                <span className="text-xs font-medium text-slate-600">対象日</span>
                <input
                  type="date"
                  value={productivitySlackTestDate}
                  onChange={(e) => setProductivitySlackTestDate(e.target.value)}
                  className="rounded border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800"
                />
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={productivitySlackTestForce}
                  onChange={(e) => setProductivitySlackTestForce(e.target.checked)}
                  className="rounded border-slate-300"
                />
                閾値に関係なく送信（Slack の見え方・メンション確認）
              </label>
              <button
                type="button"
                onClick={() => void handleProductivitySlackTest()}
                disabled={productivitySlackTestSending || productivitySlackTestCandidates.length === 0}
                className="w-fit rounded bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-900 disabled:opacity-50"
              >
                {productivitySlackTestSending ? "送信中…" : "この条件でテスト送信"}
              </button>
            </div>
            {productivitySlackTestFeedback != null && (
              <div
                className={`min-w-0 max-w-xl whitespace-pre-wrap text-sm font-medium ${
                  productivitySlackTestFeedback.variant === "success"
                    ? "text-green-800"
                    : productivitySlackTestFeedback.variant === "info"
                      ? "text-slate-700"
                      : "text-red-700"
                }`}
                role="status"
              >
                {productivitySlackTestFeedback.variant === "error"
                  ? `送信失敗\n${productivitySlackTestFeedback.message}`
                  : productivitySlackTestFeedback.message}
              </div>
            )}
          </div>

          <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-5 sm:p-6">
            <p className="mb-4 text-sm font-medium text-slate-700">新規メンバー追加</p>
            <p className="mb-4 text-xs text-slate-600">
              請求管理番号は登録時に、既存メンバーの最大値 + 1 が自動で付与されます（詳細編集で手動変更も可能）。
            </p>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5 lg:gap-6">
              <div className="flex min-w-0 flex-col gap-2">
                <label className="text-xs font-medium text-slate-600">名前</label>
                <input type="text" value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)} placeholder="表示名" className="h-10 w-full min-w-0 rounded border border-slate-300 px-3 py-2 text-sm" />
                {newMemberFieldErrors?.name ? <p className="text-xs text-red-600">{newMemberFieldErrors.name}</p> : null}
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <label className="text-xs font-medium text-slate-600">ユーザー名（ログイン用・任意）</label>
                <input type="text" value={newMemberLogin} onChange={(e) => setNewMemberLogin(e.target.value)} placeholder="空でも登録できます" className="h-10 w-full min-w-0 rounded border border-slate-300 px-3 py-2 text-sm" />
                {newMemberFieldErrors?.login ? <p className="text-xs text-red-600">{newMemberFieldErrors.login}</p> : null}
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <label className="text-xs font-medium text-slate-600">パスワード</label>
                <input
                  type="text"
                  autoComplete="off"
                  value={newMemberPassword}
                  onChange={(e) => setNewMemberPassword(e.target.value)}
                  placeholder="初期値 12345（変更可）"
                  className="h-10 w-full min-w-0 rounded border border-slate-300 px-3 py-2 text-sm font-mono"
                />
                {newMemberFieldErrors?.password ? <p className="text-xs text-red-600">{newMemberFieldErrors.password}</p> : null}
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <label className="text-xs font-medium text-slate-600">委託料単価（円/時間）</label>
                <input type="number" min={0} value={newMemberHourlyRate} onChange={(e) => setNewMemberHourlyRate(parseInt(e.target.value, 10) || 0)} className="h-10 w-full min-w-0 rounded border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="flex min-w-0 flex-col gap-2 lg:justify-end">
                <label className="text-xs font-medium text-slate-600 lg:invisible">操作</label>
                <button
                  type="button"
                  disabled={newMemberAdding}
                  onClick={() => void handleAdd()}
                  className="h-10 w-full rounded bg-slate-700 px-4 text-sm font-medium text-white hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60 lg:w-full"
                >
                  {newMemberAdding ? "追加中…" : "追加"}
                </button>
              </div>
            </div>
            {newMemberFieldErrors?.form ? <p className="mt-3 text-sm text-red-600">{newMemberFieldErrors.form}</p> : null}
          </div>

          {memberDetailSaveError && detailId === null ? (
            <p className="mb-2 text-sm text-red-600">{memberDetailSaveError}</p>
          ) : null}

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={morningBulkBusy || morningBulkSelectedIds.length === 0}
              onClick={() => void handleBulkAllowMorning()}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {morningBulkBusy ? "更新中…" : "選択したメンバーの午前稼働をまとめて許可する"}
            </button>
          </div>

          <div className="max-h-[min(75vh,840px)] overflow-auto rounded border border-slate-200">
            <table className="min-w-[1280px] w-full border-collapse text-[11px] leading-snug sm:text-xs sm:leading-snug">
              <thead>
                <tr>
                  <th
                    className="sticky top-0 z-30 w-10 min-w-[2.5rem] border-b border-slate-200 bg-slate-50 px-1.5 py-2 text-center font-medium text-slate-600"
                    title="一括で午前稼働を許可する対象に含める"
                  >
                    <input
                      type="checkbox"
                      className="rounded border-slate-300"
                      checked={morningBulkAllSelected}
                      disabled={adminMorningSelectableIds.length === 0 || morningBulkBusy}
                      onChange={(e) => toggleMorningBulkSelectAll(e.target.checked)}
                      aria-label="メンバーをまとめて選択"
                    />
                  </th>
                  <th className="sticky top-0 z-30 w-14 min-w-[3.5rem] border-b border-slate-200 bg-slate-50 px-1.5 py-2 text-center font-medium text-slate-600">
                    <button
                      type="button"
                      onClick={() => toggleAdminMemberTableSort("morning")}
                      className="mx-auto flex w-full min-w-0 items-center justify-center gap-1 rounded px-0.5 py-0.5 hover:bg-slate-200/80"
                      title={
                        adminMemberTableSort?.key === "morning"
                          ? `午前稼働 ${adminMemberTableSort.dir === "asc" ? "昇順（許可なし→あり）" : "降順（許可ありを上）"}・クリックで切替`
                          : "午前稼働で並べ替え（初回クリック: 許可ありを上）"
                      }
                    >
                      <span className="whitespace-nowrap">午前</span>
                      <span
                        className={`inline-flex shrink-0 text-[10px] font-normal leading-none ${
                          adminMemberTableSort?.key === "morning" ? "text-slate-900" : "text-slate-400"
                        }`}
                        aria-hidden
                      >
                        {adminMemberTableSortGlyph(adminMemberTableSort, "morning")}
                      </span>
                    </button>
                  </th>
                  <th
                    className="sticky top-0 z-30 w-14 min-w-[3.5rem] border-b border-slate-200 bg-slate-50 px-1.5 py-2 text-center font-medium text-slate-600"
                    title="インターン（成果報酬型請求）"
                  >
                    <button
                      type="button"
                      onClick={() => toggleAdminMemberTableSort("intern")}
                      className="mx-auto flex w-full min-w-0 items-center justify-center gap-1 rounded px-0.5 py-0.5 hover:bg-slate-200/80"
                      title={
                        adminMemberTableSort?.key === "intern"
                          ? `インターン ${adminMemberTableSort.dir === "asc" ? "昇順（OFF→ON）" : "降順（ONを上）"}・クリックで切替`
                          : "インターンで並べ替え（初回クリック: インターンを上）"
                      }
                    >
                      <span className="whitespace-nowrap">インターン</span>
                      <span
                        className={`inline-flex shrink-0 text-[10px] font-normal leading-none ${
                          adminMemberTableSort?.key === "intern" ? "text-slate-900" : "text-slate-400"
                        }`}
                        aria-hidden
                      >
                        {adminMemberTableSortGlyph(adminMemberTableSort, "intern")}
                      </span>
                    </button>
                  </th>
                  <th className="sticky top-0 z-30 min-w-[6.5rem] border-b border-slate-200 bg-slate-50 px-2 py-2 text-left font-medium text-slate-600">
                    <button
                      type="button"
                      onClick={() => toggleAdminMemberTableSort("invoice")}
                      className="flex w-full min-w-0 items-center justify-start gap-1.5 rounded px-0.5 py-0.5 text-left hover:bg-slate-200/80"
                      title={
                        adminMemberTableSort?.key === "invoice"
                          ? `管理番号 ${adminMemberTableSort.dir === "asc" ? "昇順（001から）" : "降順"}・クリックで切替`
                          : "管理番号で並べ替え（初回クリック: 001から昇順）"
                      }
                    >
                      <span className="whitespace-nowrap">管理番号</span>
                      <span
                        className={`inline-flex shrink-0 pl-0.5 text-[10px] font-normal leading-none ${
                          adminMemberTableSort?.key === "invoice" ? "text-slate-900" : "text-slate-400"
                        }`}
                        aria-hidden
                      >
                        {adminMemberTableSortGlyph(adminMemberTableSort, "invoice")}
                      </span>
                    </button>
                  </th>
                  <th className="sticky top-0 z-30 min-w-[10rem] border-b border-slate-200 bg-slate-50 px-2 py-2 text-left font-medium text-slate-600">
                    <button
                      type="button"
                      onClick={() => toggleAdminMemberTableSort("name")}
                      className="flex w-full min-w-0 items-center justify-start gap-1.5 rounded px-0.5 py-0.5 text-left hover:bg-slate-200/80"
                      title={
                        adminMemberTableSort?.key === "name"
                          ? `名前 ${adminMemberTableSort.dir === "asc" ? "昇順" : "降順"}・クリックで切替`
                          : "名前で並べ替え（初回クリック: 昇順）"
                      }
                    >
                      <span className="whitespace-nowrap">名前</span>
                      <span
                        className={`inline-flex shrink-0 pl-0.5 text-[10px] font-normal leading-none ${
                          adminMemberTableSort?.key === "name" ? "text-slate-900" : "text-slate-400"
                        }`}
                        aria-hidden
                      >
                        {adminMemberTableSortGlyph(adminMemberTableSort, "name")}
                      </span>
                    </button>
                  </th>
                  <th className="sticky top-0 z-30 min-w-[4.5rem] border-b border-slate-200 bg-slate-50 px-2 py-2 text-right font-medium text-slate-600">
                    <span className="inline-block whitespace-nowrap">時給</span>
                    <span className="mt-0.5 block text-[9px] font-normal text-slate-400">時給制</span>
                  </th>
                  <th
                    className="sticky top-0 z-30 min-w-[4.5rem] border-b border-violet-100 bg-violet-50/90 px-2 py-2 text-right font-medium text-violet-900"
                    title="インターン請求：決裁者商談確定の単価（円/件・税込）"
                  >
                    <span className="inline-block whitespace-nowrap">決裁単価</span>
                    <span className="mt-0.5 block text-[9px] font-normal text-violet-600">成果報酬</span>
                  </th>
                  <th
                    className="sticky top-0 z-30 min-w-[4.5rem] border-b border-violet-100 bg-violet-50/90 px-2 py-2 text-right font-medium text-violet-900"
                    title="インターン請求：非決裁者商談確定の単価（円/件・税込）"
                  >
                    <span className="inline-block whitespace-nowrap">非決裁単価</span>
                    <span className="mt-0.5 block text-[9px] font-normal text-violet-600">成果報酬</span>
                  </th>
                  <th className="sticky top-0 z-30 min-w-[7rem] border-b border-slate-200 bg-slate-50 px-2 py-2 text-left font-medium text-slate-600">
                    <span className="inline-block whitespace-nowrap">ログイン名</span>
                  </th>
                  <th className="sticky top-0 z-30 min-w-[4rem] border-b border-slate-200 bg-slate-50 px-2 py-2 text-left font-medium text-slate-600">
                    <span className="inline-block whitespace-nowrap">PW</span>
                  </th>
                  <th className="sticky top-0 z-30 min-w-[6.5rem] border-b border-slate-200 bg-slate-50 px-2 py-2 text-right font-medium text-slate-600">
                    <button
                      type="button"
                      onClick={() => toggleAdminMemberTableSort("minutes")}
                      className="ml-auto flex w-full min-w-0 items-center justify-end gap-1.5 rounded px-0.5 py-0.5 hover:bg-slate-200/80"
                      title={
                        adminMemberTableSort?.key === "minutes"
                          ? `活動時間 ${adminMemberTableSort.dir === "asc" ? "昇順（短い順）" : "降順（長い順）"}・クリックで切替`
                          : "活動時間で並べ替え（初回クリック: 長い順）"
                      }
                    >
                      <span className="whitespace-nowrap">活動時間</span>
                      <span
                        className={`inline-flex shrink-0 pl-0.5 text-[10px] font-normal leading-none ${
                          adminMemberTableSort?.key === "minutes" ? "text-slate-900" : "text-slate-400"
                        }`}
                        aria-hidden
                      >
                        {adminMemberTableSortGlyph(adminMemberTableSort, "minutes")}
                      </span>
                    </button>
                  </th>
                  <th className="sticky top-0 z-30 min-w-[5.5rem] border-b border-slate-200 bg-slate-50 px-2 py-2 text-right font-medium text-slate-600">
                    <button
                      type="button"
                      onClick={() => toggleAdminMemberTableSort("pay")}
                      className="ml-auto flex w-full min-w-0 items-center justify-end gap-1.5 rounded px-0.5 py-0.5 hover:bg-slate-200/80"
                      title={
                        adminMemberTableSort?.key === "pay"
                          ? `委託料 ${adminMemberTableSort.dir === "asc" ? "昇順（小さい順）" : "降順（大きい順）"}・クリックで切替`
                          : "委託料で並べ替え（初回クリック: 支払額が大きい順）"
                      }
                    >
                      <span className="whitespace-nowrap">委託料</span>
                      <span
                        className={`inline-flex shrink-0 pl-0.5 text-[10px] font-normal leading-none ${
                          adminMemberTableSort?.key === "pay" ? "text-slate-900" : "text-slate-400"
                        }`}
                        aria-hidden
                      >
                        {adminMemberTableSortGlyph(adminMemberTableSort, "pay")}
                      </span>
                    </button>
                  </th>
                  <th className="sticky top-0 z-30 min-w-[8.5rem] border-b border-slate-200 bg-slate-50 px-2 py-2 text-right font-medium text-slate-600">
                    <span className="inline-block whitespace-nowrap">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRowsForAdminMemberSettingsTable.map(({ mem, monthMin, pay, invDisplay }) => {
                  const pw = mem.password || "—";
                  const nameLine = invDisplay ? `${invDisplay} ${mem.name}` : mem.name;
                  const adminRow = isAdminAccountMember(mem);
                  const morningAllowed = mem.canWorkMorning === true;
                  const rowMorningBusy = morningRowBusyId === mem.id;
                  const internRates = getInternUnitRates(mem);
                  const isInternRow = mem.isIntern === true;
                  return (
                    <tr
                      key={mem.id}
                      className={`border-b border-slate-100 hover:bg-slate-50/50 ${isInternRow ? "bg-violet-50/40" : ""}`}
                    >
                      <td className="px-1.5 py-1.5 text-center align-middle">
                        {!adminRow ? (
                          <input
                            type="checkbox"
                            className="rounded border-slate-300"
                            checked={morningBulkSelectedIds.includes(mem.id)}
                            disabled={morningBulkBusy}
                            onChange={(e) => toggleMorningBulkSelect(mem.id, e.target.checked)}
                            aria-label={`${mem.name} を一括選択`}
                          />
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-1.5 py-1.5 text-center align-middle">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={morningAllowed}
                          disabled={adminRow || rowMorningBusy || morningBulkBusy}
                          onClick={() => void handleRowCanWorkMorningToggle(mem, !morningAllowed)}
                          title={adminRow ? "管理者アカウント" : undefined}
                          className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                            morningAllowed ? "bg-emerald-600" : "bg-slate-300"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
                              morningAllowed ? "translate-x-4" : "translate-x-0.5"
                            }`}
                          />
                        </button>
                      </td>
                      <td className="px-1.5 py-1.5 text-center align-middle">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={mem.isIntern === true}
                          disabled={adminRow || internRowBusyId === mem.id || morningBulkBusy || invoiceZipBusy}
                          onClick={() => void handleRowIsInternToggle(mem, mem.isIntern !== true)}
                          title={adminRow ? "管理者アカウント" : "インターン（成果報酬請求）"}
                          className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                            mem.isIntern === true ? "bg-violet-600" : "bg-slate-300"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
                              mem.isIntern === true ? "translate-x-4" : "translate-x-0.5"
                            }`}
                          />
                        </button>
                      </td>
                      <td className="px-2 py-1.5 font-mono tabular-nums text-slate-600 whitespace-nowrap" title={invDisplay ?? ""}>
                        {invDisplay ?? "—"}
                      </td>
                      <td className="min-w-0 px-2 py-1.5 font-medium text-slate-800" title={nameLine}>
                        <div className="truncate">{mem.name}</div>
                        {mem.isIntern === true ? (
                          <span className="mt-0.5 inline-block rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-800">インターン</span>
                        ) : null}
                        {isMemberMissingInvoiceNumber(mem) ? (
                          <div className="text-[10px] font-medium text-amber-700">請求番号未</div>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 text-right align-middle">
                        {isInternRow ? (
                          <input
                            type="number"
                            readOnly
                            value={0}
                            disabled
                            tabIndex={-1}
                            className="w-full max-w-[5rem] cursor-not-allowed rounded border border-slate-200 bg-slate-100 px-1 py-1 text-right text-[11px] tabular-nums text-slate-500"
                            aria-label={`${mem.name} の時給（成果報酬型のため未使用）`}
                            title="成果報酬型のため時給は使用しません"
                          />
                        ) : (
                          <input
                            type="number"
                            min={0}
                            step={1}
                            disabled={
                              adminRow || hourlyRateRowBusyId === mem.id || morningBulkBusy || invoiceZipBusy
                            }
                            defaultValue={mem.hourlyRate ?? DEFAULT_HOURLY_RATE}
                            key={`hr-${mem.id}-${mem.hourlyRate ?? DEFAULT_HOURLY_RATE}`}
                            onBlur={(e) => void handleHourlyRateBlur(mem, e.target.value)}
                            className="w-full max-w-[5rem] rounded border border-slate-300 px-1 py-1 text-right text-[11px] tabular-nums disabled:opacity-50"
                            aria-label={`${mem.name} の時給（円/時）`}
                          />
                        )}
                      </td>
                      <td
                        className={`px-2 py-1.5 text-right align-middle ${isInternRow ? "bg-violet-50/80" : ""}`}
                      >
                        {isInternRow ? (
                          <input
                            type="number"
                            min={0}
                            step={1}
                            disabled={
                              adminRow ||
                              internRateRowBusyKey === `${mem.id}:dm` ||
                              morningBulkBusy ||
                              invoiceZipBusy
                            }
                            defaultValue={internRates.decisionMaker}
                            key={`irdm-${mem.id}-${internRates.decisionMaker}`}
                            onBlur={(e) =>
                              void handleInternRateBlur(mem, "internRateDecisionMakerApps", e.target.value)
                            }
                            className="w-full max-w-[4.5rem] rounded border-2 border-violet-400 bg-white px-1 py-1 text-right text-[11px] font-medium tabular-nums text-violet-950 shadow-sm disabled:opacity-50"
                            aria-label={`${mem.name} の決裁者アポ単価（成果報酬）`}
                          />
                        ) : (
                          <span className="inline-block min-w-[4.5rem] px-1 text-center text-[11px] text-slate-400" title="時給制">
                            —
                          </span>
                        )}
                      </td>
                      <td
                        className={`px-2 py-1.5 text-right align-middle ${isInternRow ? "bg-violet-50/80" : ""}`}
                      >
                        {isInternRow ? (
                          <input
                            type="number"
                            min={0}
                            step={1}
                            disabled={
                              adminRow ||
                              internRateRowBusyKey === `${mem.id}:ndm` ||
                              morningBulkBusy ||
                              invoiceZipBusy
                            }
                            defaultValue={internRates.nonDecisionMaker}
                            key={`irndm-${mem.id}-${internRates.nonDecisionMaker}`}
                            onBlur={(e) =>
                              void handleInternRateBlur(mem, "internRateNonDecisionMakerApps", e.target.value)
                            }
                            className="w-full max-w-[4.5rem] rounded border-2 border-violet-400 bg-white px-1 py-1 text-right text-[11px] font-medium tabular-nums text-violet-950 shadow-sm disabled:opacity-50"
                            aria-label={`${mem.name} の非決裁者アポ単価（成果報酬）`}
                          />
                        ) : (
                          <span className="inline-block min-w-[4.5rem] px-1 text-center text-[11px] text-slate-400" title="時給制">
                            —
                          </span>
                        )}
                      </td>
                      <td className="min-w-0 overflow-hidden px-2 py-1.5 font-mono text-slate-600 truncate" title={mem.loginAccount || ""}>{mem.loginAccount || "—"}</td>
                      <td className="min-w-0 overflow-hidden px-2 py-1.5 font-mono text-slate-600 truncate" title={pw}>{pw}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-700 whitespace-nowrap">{formatDuration(monthMin)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium text-slate-800 whitespace-nowrap">¥{pay.toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-right align-middle">
                        <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:justify-end">
                          <button type="button" onClick={() => openDetail(mem)} className="rounded bg-slate-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-600 shrink-0">編集</button>
                          <button type="button" onClick={() => openReport(mem)} className="rounded bg-slate-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-500 shrink-0">PDF</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {detailId !== null && (() => {
            const editingMember = members.find((m) => m.id === detailId);
            const editingIsIntern = editingMember?.isIntern === true;
            return (
            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <h3 className="mb-3 text-sm font-medium text-slate-700">メンバー詳細設定（編集）</h3>
              {editingIsIntern ? (
                <p className="mb-3 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900">
                  契約形態: <strong>成果報酬型（インターン）</strong> — 時給は使用せず、下記の商談確定単価で請求します。
                </p>
              ) : (
                <p className="mb-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                  契約形態: <strong>時給制（一般）</strong> — 委託料単価（円/時間）で請求します。
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-0.5 block text-xs text-slate-500">名前</label>
                  <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-slate-500">ログイン用アカウント名</label>
                  <input type="text" value={editLogin} onChange={(e) => setEditLogin(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-slate-500">パスワード</label>
                  <input type="password" value={editPass} onChange={(e) => setEditPass(e.target.value)} placeholder="変更時のみ。空欄で変更しません" className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-slate-500">委託料単価（円/時間）</label>
                  {editingIsIntern ? (
                    <input
                      type="number"
                      readOnly
                      value={0}
                      disabled
                      className="w-full cursor-not-allowed rounded border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500"
                      title="成果報酬型のため時給は使用しません"
                    />
                  ) : (
                    <input
                      type="number"
                      min={0}
                      value={editRate}
                      onChange={(e) => setEditRate(parseInt(e.target.value, 10) || 0)}
                      className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  )}
                </div>
                {editingIsIntern ? (
                  <>
                    <div className="rounded-lg border-2 border-violet-300 bg-violet-50/60 p-3">
                      <label className="mb-0.5 block text-xs font-medium text-violet-900">決裁者アポ単価（円/件・税込）</label>
                      <input
                        type="number"
                        min={0}
                        value={editInternRateDm}
                        onChange={(e) => setEditInternRateDm(parseInt(e.target.value, 10) || 0)}
                        className="w-full rounded border border-violet-400 bg-white px-3 py-2 text-sm font-medium text-violet-950"
                      />
                    </div>
                    <div className="rounded-lg border-2 border-violet-300 bg-violet-50/60 p-3">
                      <label className="mb-0.5 block text-xs font-medium text-violet-900">非決裁者アポ単価（円/件・税込）</label>
                      <input
                        type="number"
                        min={0}
                        value={editInternRateNdm}
                        onChange={(e) => setEditInternRateNdm(parseInt(e.target.value, 10) || 0)}
                        className="w-full rounded border border-violet-400 bg-white px-3 py-2 text-sm font-medium text-violet-950"
                      />
                    </div>
                  </>
                ) : null}
                <div className="sm:col-span-2">
                  <label className="mb-0.5 block text-xs text-slate-500">初回稼働日</label>
                  <input
                    type="date"
                    value={editFirstWorkDate}
                    onChange={(e) => setEditFirstWorkDate(e.target.value)}
                    className="w-full max-w-xs rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    初めて日付を保存したときだけ、担当者へ Slack で通知されます（環境変数 SLACK_WEBHOOK_URL）。
                  </p>
                </div>
              </div>
              <h4 className="mt-4 mb-2 text-xs font-medium text-slate-600">振込先・インボイス</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-0.5 block text-xs text-slate-500">郵便番号</label>
                  <input type="text" value={editPostalCode} onChange={(e) => setEditPostalCode(e.target.value)} placeholder="例: 100-0001" className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-0.5 block text-xs text-slate-500">住所</label>
                  <input type="text" value={editAddress} onChange={(e) => setEditAddress(e.target.value)} placeholder="住所" className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-slate-500">銀行名</label>
                  <input type="text" value={editBankName} onChange={(e) => setEditBankName(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-slate-500">支店名</label>
                  <input type="text" value={editBranchName} onChange={(e) => setEditBranchName(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-slate-500">口座種別</label>
                  <select value={editAccountType} onChange={(e) => setEditAccountType(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm">
                    <option value="普通">普通</option>
                    <option value="当座">当座</option>
                  </select>
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-slate-500">口座番号</label>
                  <input type="text" value={editAccountNumber} onChange={(e) => setEditAccountNumber(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-0.5 block text-xs text-slate-500">口座名義</label>
                  <input type="text" value={editAccountHolder} onChange={(e) => setEditAccountHolder(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-slate-500">請求管理番号（3桁）</label>
                  <input type="text" inputMode="numeric" maxLength={3} value={editInvoiceNumber} onChange={(e) => setEditInvoiceNumber(e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="001" className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
                  <p className="mt-0.5 text-[11px] text-amber-800/90">未入力でも保存できます。空のまま保存すると管理者向けに通知・ログに記録されます。</p>
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-0.5 block text-xs text-slate-500">適格請求書発行事業者登録番号</label>
                  <input
                    type="text"
                    value={editInvoiceRegistrationNumber}
                    onChange={(e) =>
                      setEditInvoiceRegistrationNumber(sanitizeInvoiceRegistrationInput(e.target.value))
                    }
                    placeholder="T1234567890123"
                    maxLength={14}
                    className="w-full max-w-md rounded border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    任意。入力する場合は T + 13桁（例: T1234567890123）。未入力の場合は請求書に表示しません。
                  </p>
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-slate-500">電話番号</label>
                  <input type="text" value={editPhoneNumber} onChange={(e) => setEditPhoneNumber(e.target.value)} placeholder="03-1234-5678" className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
                </div>
              </div>
              {memberDetailSaveError ? <p className="mt-3 text-sm text-red-600">{memberDetailSaveError}</p> : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void saveDetail()} className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600">保存</button>
                <button
                  type="button"
                  onClick={() => {
                    setDetailId(null);
                    setMemberDetailSaveError(null);
                    setInvoiceSaveHint(null);
                  }}
                  className="rounded border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  キャンセル
                </button>
                {detailId && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm("このメンバーを無効にしますか？一覧から非表示になりログインできなくなります。データは残り、後から「有効に戻す」で復元できます。")) return;
                      try {
                        await updateMember(detailId, { isActive: false });
                        setDetailId(null);
                        setMemberDetailSaveError(null);
                        const mems = await loadMembers();
                        setMembers(mems ?? []);
                        onRefresh();
                      } catch (e) {
                        alert(e instanceof Error ? e.message : String(e));
                      }
                    }}
                    className="rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 hover:bg-amber-100"
                  >
                    このメンバーを無効にする
                  </button>
                )}
              </div>
            </div>
            );
          })()}

          {archivedMembers.length > 0 && (
            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50/70 p-4">
              <h3 className="mb-2 text-xs font-medium text-slate-600">無効にしたメンバー（アーカイブ）</h3>
              <p className="mb-3 text-xs text-slate-500">一覧から非表示にしたメンバーです。有効に戻すとログイン・一覧表示が再度可能になります。</p>
              <ul className="space-y-2">
                {archivedMembers.map((mem) => (
                  <li key={mem.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-100 bg-white px-3 py-2 text-sm">
                    <span className="font-medium text-slate-700">{mem.name}</span>
                    <span className="text-slate-500">{mem.loginAccount || "—"}</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await updateMember(mem.id, { isActive: true });
                            const mems = await loadMembers();
                            setMembers(mems ?? []);
                            onRefresh();
                          } catch (e) {
                            alert(e instanceof Error ? e.message : String(e));
                          }
                        }}
                        className="rounded bg-slate-600 px-3 py-1 text-xs font-medium text-white hover:bg-slate-500"
                      >
                        有効に戻す
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!window.confirm("本当にこのメンバーを完全に削除しますか？この操作は取り消せません。")) return;
                          try {
                            const res = await fetch(`/api/members/${encodeURIComponent(mem.id)}`, { method: "DELETE" });
                            const data = (await res.json().catch(() => ({}))) as { error?: string };
                            if (!res.ok) throw new Error(data.error || "削除に失敗しました");
                            if (detailId === mem.id) {
                              setDetailId(null);
                              setMemberDetailSaveError(null);
                            }
                            const mems = await loadMembers();
                            setMembers(mems ?? []);
                            onRefresh();
                          } catch (e) {
                            alert(e instanceof Error ? e.message : String(e));
                          }
                        }}
                        className="rounded border border-red-300 bg-red-50 px-3 py-1 text-xs font-medium text-red-800 hover:bg-red-100"
                      >
                        完全に削除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-8 overflow-hidden rounded-lg border border-emerald-200/90 bg-white shadow-sm">
            <button
              type="button"
              id="invoice-bulk-toggle"
              aria-expanded={invoiceBulkSectionOpen}
              aria-controls="invoice-bulk-panel"
              onClick={() => setInvoiceBulkSectionOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-emerald-50/60"
            >
              <span className="flex min-w-0 items-center gap-2.5 text-sm font-semibold text-slate-800">
                <span
                  className={`inline-flex shrink-0 text-emerald-700 transition-transform duration-300 ease-out ${
                    invoiceBulkSectionOpen ? "rotate-180" : ""
                  }`}
                  aria-hidden
                >
                  ▼
                </span>
                <span>請求書を一括発行する</span>
              </span>
              <span className="hidden shrink-0 text-xs font-normal text-slate-500 sm:inline">ZIP・PDF</span>
            </button>
            <div
              className={`grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out ${
                invoiceBulkSectionOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              }`}
            >
              <div className="min-h-0">
                <div
                  id="invoice-bulk-panel"
                  role="region"
                  aria-labelledby="invoice-bulk-toggle"
                  aria-hidden={!invoiceBulkSectionOpen}
                  className="border-t border-emerald-100 bg-emerald-50/30 px-4 pb-5 pt-4 sm:px-5"
                >
                  <p className="mb-3 text-xs text-slate-600">
                    メンバーがダウンロードする「請求書＋実績報告」と同一のPDFをZIPにまとめます（時給・実稼働・KPI
                    を反映）。PDF のファイル名は{" "}
                    <code className="rounded bg-slate-200 px-1 text-[11px] whitespace-pre-wrap">
                      【請求書】氏名_YYYY年MM月分_請求書No.pdf
                    </code>{" "}
                    に統一されています。
                  </p>
                  <div className="mb-4 flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-slate-600">対象月</span>
                      <select
                        value={invoiceBulkMonth}
                        onChange={(e) => setInvoiceBulkMonth(e.target.value)}
                        className="rounded border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800"
                      >
                        {invoiceBulkMonthOptions.map((ym) => (
                          <option key={ym} value={ym}>
                            {ym}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => toggleInvoiceZipSelectAll(!invoiceZipAllSelected)}
                      disabled={invoiceZipBusy || invoiceZipPanelMembers.length === 0}
                      className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {invoiceZipAllSelected ? "全解除" : "全選択"}
                    </button>
                    <button
                      type="button"
                      disabled={invoiceZipBusy || invoiceZipSelectedIds.length === 0}
                      onClick={() => void handleInvoiceZipDownload()}
                      className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {invoiceZipBusy ? "PDF生成中…" : "選択したPDFをZIPでダウンロード（請求・実績）"}
                    </button>
                  </div>
                  <div className="overflow-x-auto rounded border border-slate-200 bg-white">
                    <table className="w-full min-w-[520px] table-fixed border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <th className="w-[8%] px-1 py-1.5 text-center font-medium text-slate-600">
                            <input
                              type="checkbox"
                              className="rounded border-slate-300"
                              checked={invoiceZipAllSelected}
                              disabled={invoiceZipBusy || invoiceZipPanelMembers.length === 0}
                              onChange={(e) => toggleInvoiceZipSelectAll(e.target.checked)}
                              aria-label="請求書ZIPの対象を全選択"
                            />
                          </th>
                          <th className="px-2 py-1.5 text-left font-medium text-slate-600">名前</th>
                          <th className="w-[14%] px-2 py-1.5 text-right font-medium text-slate-600">稼働時間</th>
                          <th className="w-[16%] px-2 py-1.5 text-right font-medium text-slate-600">税込請求額（参考）</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoiceZipPanelMembers.map((mem) => {
                          const ym = invoiceBulkMonth;
                          const mins = getTotalMinutesForMonthByUser(allRecords, mem.id, ym);
                          const taxIncl = calcMemberMonthlyPayYen(
                            mem,
                            mins,
                            allKpiRecords,
                            ym,
                            DEFAULT_HOURLY_RATE
                          );
                          return (
                            <tr key={mem.id} className="border-b border-slate-100">
                              <td className="px-1 py-1.5 text-center">
                                <input
                                  type="checkbox"
                                  className="rounded border-slate-300"
                                  checked={invoiceZipSelectedIds.includes(mem.id)}
                                  disabled={invoiceZipBusy}
                                  onChange={(e) => toggleInvoiceZipSelect(mem.id, e.target.checked)}
                                  aria-label={`${mem.name} をZIPに含める`}
                                />
                              </td>
                              <td className="px-2 py-1.5 font-medium text-slate-800">
                                {mem.name}
                                {mem.isIntern === true ? (
                                  <span className="ml-1 inline-block rounded bg-violet-100 px-1 py-0.5 text-[10px] font-medium text-violet-800">
                                    インターン
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">
                                {mem.isIntern === true ? "—" : formatDuration(mins)}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums font-medium text-slate-800">
                                ¥{taxIncl.toLocaleString()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 border-t border-slate-100 pt-6">
            {!backupExpanded ? (
              <button
                type="button"
                onClick={() => setBackupExpanded(true)}
                className="text-xs text-slate-400 hover:text-slate-600 underline"
              >
                バックアップ・高度な設定を表示
              </button>
            ) : (
              <div className="rounded border border-slate-100 bg-slate-50/50 p-4">
                <p className="mb-2 text-xs text-slate-500">データのバックアップ・復元（Supabase のデータをJSONで出し入れできます）</p>
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const data = await exportAllDataFromSupabase();
                        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `kado-backup-${data.exportedAt.slice(0, 10)}-${Date.now()}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                      } catch (e) {
                        alert("エクスポートに失敗しました。");
                      }
                    }}
                    className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    バックアップをダウンロード
                  </button>
                  <label className="flex cursor-pointer items-center rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
                    <span>ファイルから復元</span>
                    <input
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = async () => {
                          try {
                            const data = JSON.parse(reader.result as string);
                            if (!data || typeof data !== "object") throw new Error("不正な形式です");
                            await importAllDataToSupabase(data);
                            onRefresh();
                            const mems = await loadMembers();
                            setMembers(mems ?? []);
                            alert("復元が完了しました。画面を更新します。");
                            window.location.reload();
                          } catch (err) {
                            alert("復元に失敗しました。正しいバックアップファイルか確認してください。");
                          }
                        };
                        reader.readAsText(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <button type="button" onClick={() => setBackupExpanded(false)} className="text-xs text-slate-400 hover:text-slate-600 underline">
                    閉じる
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {roiSlackToast ? (
        <div
          className={`fixed bottom-6 left-1/2 z-[60] max-w-[min(90vw,28rem)] -translate-x-1/2 rounded-lg px-5 py-2.5 text-sm font-medium shadow-lg ${
            roiSlackToast.isError ? "bg-red-800 text-white" : "bg-slate-900 text-white"
          }`}
          role="status"
        >
          {roiSlackToast.isError ? `Slack送信失敗：${roiSlackToast.message}` : roiSlackToast.message}
        </div>
      ) : null}

      {gapActionToast ? (
        <div
          className={`fixed bottom-36 left-1/2 z-[60] max-w-[min(90vw,28rem)] -translate-x-1/2 whitespace-pre-wrap rounded-lg px-5 py-2.5 text-center text-sm font-medium shadow-lg ${
            gapActionToast.isError ? "bg-red-800 text-white" : "bg-emerald-800 text-white"
          }`}
          role="status"
        >
          {gapActionToast.isError ? `保存に失敗しました\n${gapActionToast.message}` : gapActionToast.message}
        </div>
      ) : null}

      {recordActivityToast ? (
        <div
          className={`fixed bottom-24 left-1/2 z-[60] max-w-[min(90vw,28rem)] -translate-x-1/2 rounded-lg px-5 py-2.5 text-sm font-medium shadow-lg ${
            recordActivityToast.isError ? "bg-red-800 text-white" : "bg-emerald-800 text-white"
          }`}
          role="status"
        >
          {recordActivityToast.message}
        </div>
      ) : null}

      {reportMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setReportMember(null)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-auto rounded-xl border border-slate-200 bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-sm font-semibold text-slate-800">PDFダウンロード（請求書・実績レポート）</h3>
            <p className="mb-2 text-xs text-slate-600">
              {reportMember.name} の対象月について、メンバーが提出するPDFと同一の「請求書＋実績報告」を1ファイルでダウンロードします。
            </p>
            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium text-slate-600">対象月</label>
              <input
                type="month"
                max={adminPdfSelectableMonthMax}
                value={reportMonth > adminPdfSelectableMonthMax ? adminPdfSelectableMonthMax : reportMonth}
                onChange={(e) => setReportMonth(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-800"
              />
              <p className="mt-1.5 text-xs text-slate-500">
                管理者は当月を含めいつでもプレビューできます（メンバー画面は翌月1日以降に限り前月まで）。
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void handleDownloadCombinedPdfAdmin()}
                className="rounded bg-slate-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-600"
              >
                PDFをダウンロード（請求書・実績レポート）
              </button>
              <button
                type="button"
                onClick={() => setReportMember(null)}
                className="rounded border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}

function HistorySection(props: {
  monthRecords: WorkRecord[];
  monthShifts: Shift[];
  monthKpi: KpiRecord[];
  currentYearMonth: string;
  isCurrentMonth: boolean;
}) {
  const { monthRecords, monthShifts, monthKpi, currentYearMonth, isCurrentMonth } = props;
  const dateToShifts = new Map<string, Shift[]>();
  monthShifts.forEach((s) => {
    const list = dateToShifts.get(s.date) || [];
    list.push(s);
    dateToShifts.set(s.date, list);
  });
  const dateToRecords = new Map<string, WorkRecord[]>();
  monthRecords.forEach((r) => {
    const list = dateToRecords.get(r.date) || [];
    list.push(r);
    dateToRecords.set(r.date, list);
  });
  const dateToKpi = new Map<string, KpiRecord>();
  monthKpi.forEach((k) => dateToKpi.set(k.date, k));
  const allDates = new Set<string>();
  dateToShifts.forEach((_, key) => allDates.add(key));
  dateToRecords.forEach((_, key) => allDates.add(key));
  dateToKpi.forEach((_, key) => allDates.add(key));
  const sortedDates = Array.from(allDates).sort();

  return (
    <section className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200/80">
      <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 sm:px-5 sm:py-4">
        活動記録一覧（予定 vs 実績・KPI）
        {!isCurrentMonth ? `（${currentYearMonth}）` : ""}
      </h2>
      <div className="divide-y divide-slate-100">
        {sortedDates.length === 0 ? (
          <div className="px-4 py-8 text-center text-slate-500 sm:px-5">この月の履歴はありません</div>
        ) : (
          sortedDates.map((dateStr) => {
            const dayShifts = dateToShifts.get(dateStr) || [];
            const dayRecords = dateToRecords.get(dateStr) || [];
            const dayKpi = dateToKpi.get(dateStr);
            const plannedTotal = dayShifts.reduce((sum, s) => sum + getShiftPlannedMinutes(s), 0);
            const actualTotal = dayRecords.reduce((sum, r) => sum + r.durationMinutes, 0);
            const rates = dayKpi ? getKpiRates(dayKpi) : null;
            return (
              <div key={dateStr} className="px-4 py-4 sm:px-5">
                <div className="mb-2 font-medium text-slate-800">{formatDisplayDate(dateStr)}</div>
                <div className="mb-2 flex flex-wrap gap-4 text-sm">
                  <span className="text-slate-600">予定: {plannedTotal > 0 ? formatDuration(plannedTotal) : "—"}</span>
                  <span className="font-medium text-slate-800">実績: {formatDuration(actualTotal)}</span>
                </div>
                {dayKpi && (
                  <div className="mb-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <span className="font-medium text-slate-700">KPI: </span>
                    総コール数 {dayKpi.totalCalls} / 総有効コール数 {dayKpi.validCalls} / KC {dayKpi.kcCount} / 追いかけ {dayKpi.followUpCreated} / 決裁者アポ {dayKpi.decisionMakerApo} / 非決裁者アポ {dayKpi.nonDecisionMakerApo}
                    {rates && (
                      <div className="mt-1 text-slate-500">
                        有効率 {rates.validRate != null ? `${rates.validRate}%` : "—"} / KC率 {rates.kcRate != null ? `${rates.kcRate}%` : "—"} / アポ率 {rates.apoRate != null ? `${rates.apoRate}%` : "—"}
                      </div>
                    )}
                  </div>
                )}
                <ul className="space-y-1.5 pl-0">
                  {dayRecords.map((r) => (
                    <li key={r.id} className="flex justify-between text-sm text-slate-600">
                      <span>
                        {formatTime(r.startRounded)} ～ {formatTime(r.endRounded)}
                      </span>
                      <span className="font-medium text-slate-700">{formatDuration(r.durationMinutes)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

const ENTRY_NONE = "なし";

type WeekFormState = Record<string, { s1: string; e1: string; s2: string; e2: string }>;

function ShiftDeadlineCountdown({ todayJstYmd }: { todayJstYmd: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const thisMon = getMondayOfCalendarWeekForYmd(todayJstYmd);
  const nextWeekMon = addWeeksToWeekStart(thisMon, 1);
  const deadline = getDeadlineForWeek(nextWeekMon);
  const msLeft = deadline.getTime() - Date.now();
  if (msLeft <= 0) {
    return (
      <section className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-5 shadow-sm sm:p-6">
        <p className="text-center text-sm font-medium text-slate-600">
          来週分のシフト提出期限（前週の日曜 23:59）を過ぎました。再来週分は「稼働予定」タブから登録できます。
        </p>
      </section>
    );
  }
  const urgent = msLeft < 24 * 60 * 60 * 1000;
  const totalM = Math.ceil(msLeft / 60_000);
  const days = Math.floor(totalM / (60 * 24));
  const hours = Math.floor((totalM - days * 60 * 24) / 60);
  const mins = Math.max(1, Math.ceil(msLeft / 60_000));
  const timeLabel =
    msLeft < 60 * 60 * 1000
      ? `あと ${mins} 分`
      : `あと ${days} 日 ${hours} 時間`;
  return (
    <section
      className={`mb-6 rounded-xl border-2 p-5 shadow-md sm:p-6 ${urgent ? "border-red-400 bg-red-50" : "border-sky-300 bg-sky-50"}`}
    >
      <p className={`text-center text-base font-bold sm:text-lg ${urgent ? "text-red-800" : "text-sky-900"}`}>
        来週のシフト提出期限まで
        <span className="mx-1 tabular-nums">{timeLabel}</span>
      </p>
      <p className={`mt-2 text-center text-xs sm:text-sm ${urgent ? "text-red-700" : "text-sky-800"}`}>
        締切は前週の日曜 23:59（日本時間）です。{urgent ? "まもなく締め切りです。" : ""}
      </p>
    </section>
  );
}

function ShiftTab(props: {
  userId: string;
  shifts: Shift[];
  onSave: (s: Shift[]) => Promise<boolean>;
  todayJstYmd: string;
  /** このユーザーの活動記録（日別集計・削除制限用） */
  guardWorkRecords?: WorkRecord[];
  /** このユーザーの KPI 一覧（削除制限用） */
  guardKpiRecords?: KpiRecord[];
  /** 管理者アカウントのとき、実績があっても予定の「なし」化を許可 */
  isAdminUser?: boolean;
  /** false のとき開始は 14:00 以降のみ（管理者ログインで編集する場合は指定しない／false） */
  restrictMorningStart?: boolean;
}) {
  const {
    userId,
    shifts,
    onSave,
    todayJstYmd,
    guardWorkRecords = [],
    guardKpiRecords = [],
    isAdminUser = false,
    restrictMorningStart = false,
  } = props;
  const [weekStart, setWeekStart] = useState("");
  const [weekForm, setWeekForm] = useState<WeekFormState>({});
  const [weekSaveLoading, setWeekSaveLoading] = useState(false);
  const [shiftSaveToast, setShiftSaveToast] = useState<string | null>(null);

  useEffect(() => {
    if (!shiftSaveToast) return;
    const t = window.setTimeout(() => setShiftSaveToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [shiftSaveToast]);

  const shiftsDedupedForList = useMemo(() => {
    const mine = shifts.filter((s) => s.userId === userId);
    const byDate = new Map<string, Shift>();
    for (const s of mine) {
      const cur = byDate.get(s.date);
      if (!cur || s.id < cur.id) byDate.set(s.date, s);
    }
    return Array.from(byDate.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [shifts, userId]);

  const thisMon = getMondayOfCalendarWeekForYmd(todayJstYmd);
  const weekOptions = getOrderedSubmittableShiftWeeks(thisMon);
  const wNext = addWeeksToWeekStart(thisMon, 1);
  const wNext2 = addWeeksToWeekStart(thisMon, 2);
  const defaultOpen = getFirstOpenShiftWeekStart(thisMon);
  const targetStart =
    weekStart && weekOptions.includes(weekStart) ? weekStart : defaultOpen || weekOptions[0] || "";
  const weekDates = useMemo(() => (targetStart ? getWeekDates(targetStart) : []), [targetStart]);
  /** 表示中の週に JST の「今日」が含まれる＝今週扱いで締切なし（月曜文字列の不一致で誤って締切済みにしない） */
  const isViewingWeekContainingTodayJst =
    weekDates.length > 0 && todayJstYmd >= weekDates[0] && todayJstYmd <= weekDates[6];
  const isPastDeadline =
    !!targetStart &&
    !isViewingWeekContainingTodayJst &&
    Date.now() > getDeadlineForWeek(targetStart).getTime();
  const byDate = targetStart ? getShiftsByDateForWeek(shifts, targetStart, userId) : new Map<string, Shift>();

  const memberShiftWeekCanSubmit = useMemo(() => {
    if (!targetStart || weekDates.length === 0) return true;
    return weekDates.every((dateStr) => {
      if (isWeekendYmd(dateStr)) return true;
      if (isViewingWeekContainingTodayJst && dateStr <= todayJstYmd) return true;
      if (dateStr < todayJstYmd) return true;
      const f =
        weekForm[dateStr] || { s1: SHIFT_WEEKDAY_DEFAULT_START, e1: SHIFT_WEEKDAY_DEFAULT_END, s2: "", e2: "" };
      return adminShiftDayCanSave(f, restrictMorningStart);
    });
  }, [targetStart, weekDates, weekForm, isViewingWeekContainingTodayJst, todayJstYmd, restrictMorningStart]);

  useEffect(() => {
    if (!targetStart) return;
    const dates = getWeekDates(targetStart);
    const viewingContainsTodayJst =
      dates.length > 0 && todayJstYmd >= dates[0] && todayJstYmd <= dates[6];
    const map = getShiftsByDateForWeek(shifts, targetStart, userId);
    const next: WeekFormState = {};
    dates.forEach((dateStr) => {
      if (isWeekendYmd(dateStr)) {
        next[dateStr] = shiftFormWeekendNone();
        return;
      }
      if (viewingContainsTodayJst && dateStr <= todayJstYmd) {
        const s = map.get(dateStr);
        if (s) {
          const isNone = s.startPlanned === ENTRY_NONE;
          next[dateStr] = {
            s1: isNone ? ENTRY_NONE : s.startPlanned,
            e1: isNone ? ENTRY_NONE : s.endPlanned,
            s2: s.startPlanned2 ?? "",
            e2: s.endPlanned2 ?? "",
          };
          return;
        }
        next[dateStr] = { s1: ENTRY_NONE, e1: ENTRY_NONE, s2: "", e2: "" };
        return;
      }
      const s = map.get(dateStr);
      const isNone = s && s.startPlanned === ENTRY_NONE;
      next[dateStr] = {
        s1: isNone ? ENTRY_NONE : s ? s.startPlanned : SHIFT_WEEKDAY_DEFAULT_START,
        e1: isNone ? ENTRY_NONE : s ? s.endPlanned : SHIFT_WEEKDAY_DEFAULT_END,
        s2: s && s.startPlanned2 ? s.startPlanned2 : "",
        e2: s && s.endPlanned2 ? s.endPlanned2 : "",
      };
    });
    setWeekForm((prev) => {
      const merged: WeekFormState = { ...next, ...prev };
      dates.forEach((d) => {
        if (isWeekendYmd(d)) merged[d] = shiftFormWeekendNone();
        else if (viewingContainsTodayJst && d <= todayJstYmd) {
          const s = map.get(d);
          if (s) {
            const isNone = s.startPlanned === ENTRY_NONE;
            merged[d] = {
              s1: isNone ? ENTRY_NONE : s.startPlanned,
              e1: isNone ? ENTRY_NONE : s.endPlanned,
              s2: s.startPlanned2 ?? "",
              e2: s.endPlanned2 ?? "",
            };
          } else {
            merged[d] = { s1: ENTRY_NONE, e1: ENTRY_NONE, s2: "", e2: "" };
          }
        }
      });
      return merged;
    });
  }, [targetStart, shifts, todayJstYmd, userId, guardWorkRecords, guardKpiRecords]);

  const updateDay = (dateStr: string, field: "s1" | "e1" | "s2" | "e2", value: string) => {
    if ((field === "s1" || field === "e1") && value === ENTRY_NONE) {
      const mins = getTotalMinutesForDate(guardWorkRecords, dateStr);
      const k = getKpiForDate(guardKpiRecords, dateStr);
      if (mins > 0 || kpiRecordHasOperationalMetrics(k)) return;
    }
    setWeekForm((prev) => {
      const cur = prev[dateStr] || { s1: SHIFT_WEEKDAY_DEFAULT_START, e1: SHIFT_WEEKDAY_DEFAULT_END, s2: "", e2: "" };
      const next = { ...cur, [field]: value };
      if (field === "s1" && value === ENTRY_NONE) next.e1 = ENTRY_NONE;
      if (field === "e1" && value === ENTRY_NONE) next.s1 = ENTRY_NONE;
      return { ...prev, [dateStr]: next };
    });
  };

  const setDayNone = (dateStr: string, none: boolean) => {
    if (none) {
      const mins = getTotalMinutesForDate(guardWorkRecords, dateStr);
      const k = getKpiForDate(guardKpiRecords, dateStr);
      if (mins > 0 || kpiRecordHasOperationalMetrics(k)) return;
    }
    setWeekForm((prev) => ({
      ...prev,
      [dateStr]: none ? { s1: ENTRY_NONE, e1: ENTRY_NONE, s2: "", e2: "" } : { s1: SHIFT_WEEKDAY_DEFAULT_START, e1: SHIFT_WEEKDAY_DEFAULT_END, s2: "", e2: "" },
    }));
  };

  const copyPreviousWeek = () => {
    if (!targetStart || isPastDeadline) return;
    const prevMon = addWeeksToWeekStart(targetStart, -1);
    const prevMap = getShiftsByDateForWeek(shifts, prevMon, userId);
    const curDates = getWeekDates(targetStart);
    const prevDates = getWeekDates(prevMon);
    const viewingContainsTodayJst =
      curDates.length > 0 && todayJstYmd >= curDates[0] && todayJstYmd <= curDates[6];
    setWeekForm((prev) => {
      const next = { ...prev };
      curDates.forEach((dateStr, i) => {
        if (isWeekendYmd(dateStr)) {
          next[dateStr] = shiftFormWeekendNone();
          return;
        }
        const skipPast =
          (viewingContainsTodayJst && dateStr <= todayJstYmd) || (!viewingContainsTodayJst && dateStr < todayJstYmd);
        if (skipPast) return;
        const ps = prevMap.get(prevDates[i]);
        const isNone = ps && ps.startPlanned === ENTRY_NONE;
        next[dateStr] = {
          s1: isNone ? ENTRY_NONE : ps ? ps.startPlanned : SHIFT_WEEKDAY_DEFAULT_START,
          e1: isNone ? ENTRY_NONE : ps ? ps.endPlanned : SHIFT_WEEKDAY_DEFAULT_END,
          s2: ps?.startPlanned2 ?? "",
          e2: ps?.endPlanned2 ?? "",
        };
      });
      return next;
    });
  };

  const handleSubmitWeek = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetStart || isPastDeadline || weekSaveLoading || !memberShiftWeekCanSubmit) return;
    const otherShifts = shifts.filter((s) => s.userId === userId && !weekDates.includes(s.date));
    const newShifts: Shift[] = weekDates.flatMap((dateStr) => {
      const existing = byDate.get(dateStr);
      if (isWeekendYmd(dateStr)) {
        return [
          {
            id: existing ? existing.id : crypto.randomUUID(),
            userId,
            date: dateStr,
            startPlanned: ENTRY_NONE,
            endPlanned: ENTRY_NONE,
          },
        ];
      }
      if (isViewingWeekContainingTodayJst && dateStr <= todayJstYmd) {
        return existing ? [existing] : [];
      }
      if (dateStr < todayJstYmd) {
        return existing ? [existing] : [];
      }
      const f = weekForm[dateStr] || { s1: SHIFT_WEEKDAY_DEFAULT_START, e1: SHIFT_WEEKDAY_DEFAULT_END, s2: "", e2: "" };
      const mins0 = getTotalMinutesForDate(guardWorkRecords, dateStr);
      const k0 = getKpiForDate(guardKpiRecords, dateStr);
      if (
        f.s1 === ENTRY_NONE &&
        (mins0 > 0 || kpiRecordHasOperationalMetrics(k0)) &&
        existing &&
        shiftHasConcretePrimaryPlanned(existing)
      ) {
        return [existing];
      }
      const base = {
        id: existing ? existing.id : crypto.randomUUID(),
        userId,
        date: dateStr,
        startPlanned: f.s1,
        endPlanned: f.s1 === ENTRY_NONE ? ENTRY_NONE : f.e1,
      };
      if (f.s1 !== ENTRY_NONE && f.s2 && f.e2) {
        return [{ ...base, startPlanned2: f.s2, endPlanned2: f.e2 }];
      }
      return [base];
    });
    setWeekSaveLoading(true);
    try {
      const ok = await onSave([...newShifts, ...otherShifts]);
      if (ok) setShiftSaveToast("保存が完了しました！");
    } finally {
      setWeekSaveLoading(false);
    }
  };

  return (
    <>
      {shiftSaveToast ? (
        <div
          className="fixed left-1/2 top-4 z-[70] max-w-[min(90vw,24rem)] -translate-x-1/2 rounded-lg bg-emerald-800 px-5 py-2.5 text-center text-sm font-medium text-white shadow-lg"
          role="status"
        >
          {shiftSaveToast}
        </div>
      ) : null}
      <section className="mb-6 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80 sm:p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-slate-700">稼働可能日時の登録</h2>
          <p className="text-xs text-slate-500">「今週」は締切なし。来週・再来週は従来どおり前週日曜23:59までです</p>
        </div>
        <p className="mb-3 text-xs text-slate-600">
          土曜・日曜は稼働予定の入力はできません（常に「稼働予定なし」として扱います）。「今週」を選んだときは、明日以降の平日のみ編集できます。今日を含む過去の平日は画面上変更できませんが、保存しても登録済みの予定は消えません。来週・再来週では、今日より前の日は変更できません。
        </p>
        {!targetStart && (
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            現在、提出を受け付けている週はありません。次の提出サイクルをお待ちください。
          </div>
        )}
        {targetStart && weekOptions.length > 1 && (
          <div className="mb-4">
            <label className="mb-1 block text-sm text-slate-600">対象週（今週・来週・再来週から選択）</label>
            <select
              value={targetStart}
              onChange={(e) => setWeekStart(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800 sm:max-w-xs"
            >
              {weekOptions.map((ws) => {
                const [yy, mm, dd] = ws.split("-").map(Number);
                const mon = new Date(yy, mm - 1, dd);
                const sun = new Date(mon);
                sun.setDate(sun.getDate() + 6);
                const optDates = getWeekDates(ws);
                const isOptCurrentWeek =
                  optDates.length > 0 && todayJstYmd >= optDates[0] && todayJstYmd <= optDates[6];
                const which =
                  isOptCurrentWeek ? "今週" : ws === wNext ? "来週" : ws === wNext2 ? "再来週" : "対象週";
                const label = `${which}（${mon.getMonth() + 1}/${mon.getDate()}～${sun.getMonth() + 1}/${sun.getDate()}）`;
                return (
                  <option key={ws} value={ws}>
                    {label}
                  </option>
                );
              })}
            </select>
          </div>
        )}
        {targetStart && isPastDeadline && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            この週のシフト提出は締め切られました（締切: 前週の日曜 23:59・日本時間）。他の提出可能な週を選択してください。
          </div>
        )}
        {targetStart && (
          <p className="mb-4 text-sm text-slate-600">
            {formatDisplayDate(weekDates[0])} ～ {formatDisplayDate(weekDates[6])}
            {!isPastDeadline && !isViewingWeekContainingTodayJst && (
              <span className="ml-1 text-xs text-slate-500">（締切: 前週の日曜 23:59・日本時間）</span>
            )}
            {isViewingWeekContainingTodayJst && (
              <span className="ml-1 text-xs text-slate-500">（今週分は締切なし・明日以降の平日のみ編集可）</span>
            )}
          </p>
        )}
        {targetStart && !isPastDeadline && (
          <div className="mb-4">
            <button
              type="button"
              onClick={copyPreviousWeek}
              disabled={weekSaveLoading}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              先週の予定をコピー
            </button>
            <p className="mt-1 text-xs text-slate-500">直前の週（月〜日）に登録した内容を、今選択中の週にそのまま反映します。</p>
          </div>
        )}
        <form onSubmit={handleSubmitWeek} className="space-y-4">
          {targetStart &&
            weekDates.map((dateStr) => {
              const f = weekForm[dateStr] || { s1: SHIFT_WEEKDAY_DEFAULT_START, e1: SHIFT_WEEKDAY_DEFAULT_END, s2: "", e2: "" };
              const dayNone = f.s1 === ENTRY_NONE;
              const a = analyzeAdminShiftDay(f);
              const morningStartOpts = restrictMorningStart
                ? { minimumStartMinutes: SHIFT_PLANNED_NEW_MEMBER_EARLIEST_START_MINUTES }
                : undefined;
              const primaryStartOpts = buildShiftPrimaryPlannedStartSelectOptions(f.s1, morningStartOpts);
              const primaryEndOpts = buildShiftPrimaryPlannedEndSelectOptions(f.e1, f.s1);
              const secondaryStartOpts = buildShiftSecondaryPlannedStartSelectOptions(f.s2, morningStartOpts);
              const secondaryEndOpts = buildShiftSecondaryPlannedEndSelectOptions(f.e2, f.s2);
              const weekend = isWeekendYmd(dateStr);
              const lockedThisWeekPast =
                isViewingWeekContainingTodayJst && !weekend && dateStr <= todayJstYmd;
              const lockedOtherPast =
                !isViewingWeekContainingTodayJst && !weekend && dateStr < todayJstYmd;
              const dayLocked = isPastDeadline || lockedThisWeekPast || lockedOtherPast;
              const minsG = getTotalMinutesForDate(guardWorkRecords, dateStr);
              const kG = getKpiForDate(guardKpiRecords, dateStr);
              const actualGuard = !isAdminUser && (minsG > 0 || kpiRecordHasOperationalMetrics(kG));
              const noneCheckboxDisabled = dayLocked || actualGuard;
              return (
                <div
                  key={dateStr}
                  className={`rounded-lg border border-slate-200 p-3 ${dayLocked && !weekend ? "bg-slate-100/90 opacity-65" : "bg-slate-50/50"}`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-medium text-slate-800">{formatDisplayDate(dateStr)}</span>
                    {!weekend && (
                      <label
                        className={`flex items-center gap-2 text-xs ${noneCheckboxDisabled ? "cursor-not-allowed text-slate-400" : "cursor-pointer text-slate-600"}`}
                        title={
                          actualGuard
                            ? "この日は活動記録または KPI 実績があるため、稼働予定を「なし」にできません"
                            : undefined
                        }
                      >
                        <input
                          type="checkbox"
                          checked={dayNone}
                          onChange={(e) => setDayNone(dateStr, e.target.checked)}
                          disabled={noneCheckboxDisabled}
                          className="rounded border-slate-300"
                        />
                        この日の稼働予定なし
                      </label>
                    )}
                  </div>
                  {weekend && (
                    <p className="text-xs font-medium text-slate-600">土曜・日曜は登録できません（稼働予定なし固定）。</p>
                  )}
                  {!weekend && lockedThisWeekPast && actualGuard && (
                    <p className="text-xs text-sky-800">
                      この日は実績データがあるため、稼働予定を「なし」に変更できません。保存しても登録済みの予定は維持されます。
                    </p>
                  )}
                  {!weekend && lockedThisWeekPast && !actualGuard && (
                    <p className="text-xs text-slate-500">
                      今週のこの日（今日以前）は編集できません。保存しても登録済みの予定はそのまま残ります。編集できるのは明日以降の平日です。
                    </p>
                  )}
                  {!weekend && lockedOtherPast && (
                    <p className="text-xs text-slate-500">この日は既に過ぎているため変更できません。</p>
                  )}
                  {!weekend && !dayNone && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="w-14 text-xs text-slate-500">予定1</span>
                        <select
                          value={f.s1}
                          onChange={(e) => updateDay(dateStr, "s1", e.target.value)}
                          disabled={dayLocked}
                          className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                        >
                          {primaryStartOpts.map((o) => (
                            <option key={`${o.value}-${o.disabled ? "d" : "e"}`} value={o.value} disabled={o.disabled}>
                              {o.label ?? o.value}
                            </option>
                          ))}
                        </select>
                        <span className="text-slate-400">～</span>
                        <select
                          value={f.e1}
                          onChange={(e) => updateDay(dateStr, "e1", e.target.value)}
                          disabled={dayLocked}
                          className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                        >
                          {primaryEndOpts.map((o) => (
                            <option key={`${o.value}-${o.disabled ? "d" : "e"}`} value={o.value} disabled={o.disabled}>
                              {o.label ?? o.value}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="w-14 text-xs text-slate-500">予定2</span>
                        <select
                          value={f.s2}
                          onChange={(e) => updateDay(dateStr, "s2", e.target.value)}
                          disabled={dayLocked}
                          className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                        >
                          {secondaryStartOpts.map((o) => (
                            <option key={`${o.value || "__empty__"}-${o.disabled ? "d" : "e"}`} value={o.value} disabled={o.disabled}>
                              {o.label ?? (o.value === "" ? "—" : o.value)}
                            </option>
                          ))}
                        </select>
                        <span className="text-slate-400">～</span>
                        <select
                          value={f.e2}
                          onChange={(e) => updateDay(dateStr, "e2", e.target.value)}
                          disabled={dayLocked}
                          className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                        >
                          {secondaryEndOpts.map((o) => (
                            <option key={`${o.value || "__empty__"}-${o.disabled ? "d" : "e"}`} value={o.value} disabled={o.disabled}>
                              {o.label ?? (o.value === "" ? "—" : o.value)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                  {!weekend && !dayNone && !dayLocked && a.slotWindowEarly && (
                    <p className="mt-2 text-xs font-medium text-red-600">{SHIFT_PLANNED_START_BUSINESS_RULE_MESSAGE}</p>
                  )}
                  {!weekend && !dayNone && !dayLocked && a.slotWindowLate && (
                    <p className="mt-2 text-xs font-medium text-red-600">{SHIFT_PLANNED_LATEST_BUSINESS_RULE_MESSAGE}</p>
                  )}
                  {!weekend && dayNone && (
                    <p className="text-xs text-slate-500">
                      {lockedThisWeekPast ? "稼働予定なし（登録済みの場合は保存してもこの内容に勝手には変えません）" : "稼働予定なし（本人の意思で登録）"}
                    </p>
                  )}
                </div>
              );
            })}
          {targetStart && (
            <button
              type="submit"
              disabled={isPastDeadline || weekSaveLoading || !memberShiftWeekCanSubmit}
              title={
                isPastDeadline
                  ? "この週の提出期限を過ぎています。別の週を選ぶか、管理者にご相談ください。"
                  : !memberShiftWeekCanSubmit
                    ? "稼働予定は10:00〜22:00の範囲で入力してください"
                    : undefined
              }
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-700 px-4 py-2.5 font-medium text-white hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {weekSaveLoading ? (
                <>
                  <span
                    className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white border-t-transparent"
                    aria-hidden
                  />
                  保存中...
                </>
              ) : (
                "この週を保存"
              )}
            </button>
          )}
        </form>
      </section>

      <section className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200/80">
        <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 sm:px-5 sm:py-4">登録した稼働予定一覧</h2>
        <div className="divide-y divide-slate-100">
          {shiftsDedupedForList.length === 0 ? (
            <div className="px-4 py-8 text-center text-slate-500 sm:px-5">まだ稼働予定がありません</div>
          ) : (
            shiftsDedupedForList.slice(0, 14).map((s) => {
                const isNone = s.startPlanned === ENTRY_NONE;
                return (
                  <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5 sm:py-4">
                    <div className="text-slate-800">
                      <span className="font-medium">{formatDisplayDate(s.date)}</span>
                      <span className="ml-2 text-sm text-slate-500">
                        {isNone ? "稼働予定なし" : `${s.startPlanned}～${s.endPlanned}${s.startPlanned2 && s.endPlanned2 ? ` / ${s.startPlanned2}～${s.endPlanned2}` : ""}`}
                      </span>
                    </div>
                    <div className="text-right font-semibold text-slate-700">{isNone ? "—" : formatDuration(getShiftPlannedMinutes(s))}</div>
                  </div>
                );
              })
          )}
        </div>
      </section>
    </>
  );
}

function KpiTab(props: {
  userId: string;
  kpiRecords: KpiRecord[];
  currentYearMonth: string;
  isIntern?: boolean;
  onSave: (savedDay: KpiRecord, allForUser: KpiRecord[]) => void | Promise<void>;
}) {
  const { userId, kpiRecords, currentYearMonth, isIntern = false, onSave } = props;
  const today = getTodayJstDateString();
  const [kpiDate, setKpiDate] = useState(today);
  const [kpiFields, setKpiFields] = useState<Record<KpiFormFieldKey, string>>(() => ({ ...EMPTY_KPI_FORM_STRINGS }));
  const [kpiSaveBusy, setKpiSaveBusy] = useState(false);

  useEffect(() => {
    const existing = getKpiForDate(kpiRecords, kpiDate);
    if (existing) {
      setKpiFields({
        totalCalls: kpiStoredNumberToInputString(existing.totalCalls),
        validCalls: kpiStoredNumberToInputString(existing.validCalls),
        kcCount: kpiStoredNumberToInputString(existing.kcCount),
        followUpCreated: kpiStoredNumberToInputString(existing.followUpCreated),
        decisionMakerApo: kpiStoredNumberToInputString(existing.decisionMakerApo),
        nonDecisionMakerApo: kpiStoredNumberToInputString(existing.nonDecisionMakerApo),
      });
    } else {
      setKpiFields({ ...EMPTY_KPI_FORM_STRINGS });
    }
  }, [kpiDate, kpiRecords]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (kpiSaveBusy) return;
    if (isWeekendYmdJst(kpiDate)) {
      alert(JST_WEEKEND_WORK_REJECTED_MESSAGE);
      return;
    }
    setKpiSaveBusy(true);
    try {
      const dateYmd = coerceKpiWorkDateYmd(kpiDate);
      if (!dateYmd) {
        alert("日付が不正です。もう一度お試しください。");
        return;
      }
      const existingRec = getKpiForDate(kpiRecords, dateYmd);
      const slotStart = normalizeKpiStartTime(existingRec ?? { startTime: KPI_DAY_DEFAULT_START_TIME });
      const preservedNotify = existingRec ? coerceKpiTimestamptzField(existingRec.kpiMissingSlackNotifiedAt) : undefined;
      const rec: KpiRecord = {
        id: existingRec ? existingRec.id : crypto.randomUUID(),
        userId,
        date: dateYmd,
        startTime: slotStart,
        totalCalls: parseKpiFieldStringToInt(kpiFields.totalCalls),
        validCalls: parseKpiFieldStringToInt(kpiFields.validCalls),
        kcCount: parseKpiFieldStringToInt(kpiFields.kcCount),
        followUpCreated: parseKpiFieldStringToInt(kpiFields.followUpCreated),
        decisionMakerApo: parseKpiFieldStringToInt(kpiFields.decisionMakerApo),
        nonDecisionMakerApo: parseKpiFieldStringToInt(kpiFields.nonDecisionMakerApo),
        confirmedDecisionMakerApps: existingRec?.confirmedDecisionMakerApps ?? 0,
        confirmedNonDecisionMakerApps: existingRec?.confirmedNonDecisionMakerApps ?? 0,
        ...(preservedNotify ? { kpiMissingSlackNotifiedAt: preservedNotify } : {}),
      };
      const next = existingRec
        ? kpiRecords.map((r) =>
            r.date === dateYmd && normalizeKpiStartTime(r) === normalizeKpiStartTime(existingRec) ? rec : r
          )
        : [
            rec,
            ...kpiRecords.filter(
              (r) => !(r.date === rec.date && normalizeKpiStartTime(r) === normalizeKpiStartTime(rec))
            ),
          ];
      await onSave(rec, next);
    } finally {
      setKpiSaveBusy(false);
    }
  };

  const totals = getMonthlyKpiTotals(kpiRecords, currentYearMonth);
  const monthKpiList = getKpiForMonth(kpiRecords, currentYearMonth).sort((a, b) => b.date.localeCompare(a.date));
  const currentKpi = getKpiForDate(kpiRecords, kpiDate);
  const rates = currentKpi ? getKpiRates(currentKpi) : null;
  const prevDate = (() => {
    const d = new Date(kpiDate);
    d.setDate(d.getDate() - 1);
    return toDateString(d);
  })();
  const prevKpi = getKpiForDate(kpiRecords, prevDate);
  const prevRates = prevKpi ? getKpiRates(prevKpi) : null;
  const monthRates =
    totals.totalCalls > 0
      ? {
          validRate: safeRatePercent(totals.validCalls, totals.totalCalls),
          kcRate: safeRatePercent(totals.kcCount, totals.validCalls),
          apoRate: safeRatePercent(totals.decisionMakerApo, totals.kcCount),
        }
      : null;


  if (isIntern) {
    return (
      <section className="mb-8 rounded-xl border-2 border-violet-200 bg-violet-50/40 p-5 shadow-sm sm:p-6">
        <h2 className="mb-2 text-sm font-semibold text-violet-950">インターン生の成果入力について</h2>
        <p className="text-sm leading-relaxed text-slate-700">
          コール数・有効コール数・アポ数などの KPI 自己入力はありません。評価・請求の対象は、管理者が確定した
          <strong className="font-medium"> 商談確定数（決裁者 / 非決裁者）</strong> のみです。
        </p>
        <p className="mt-3 text-sm text-slate-600">
          今月の確定報酬額はホーム画面のカードで確認できます。確定数の登録は管理者が行います。
        </p>
      </section>
    );
  }

  return (
    <>
      {currentKpi && rates && (
        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:mb-8 sm:p-6">
          <h2 className="mb-3 text-sm font-medium text-slate-700">生産性カード（{formatDisplayDate(kpiDate)}）</h2>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">有効率</div>
              <div className="text-lg font-bold text-slate-800">{rates.validRate != null ? `${rates.validRate}%` : "—"}</div>
              <div className="text-xs text-slate-500">総有効コール数÷総コール数</div>
              {prevRates && prevRates.validRate != null && <div className="mt-1 text-xs text-slate-500">前日: {prevRates.validRate}%</div>}
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">KC率</div>
              <div className="text-lg font-bold text-slate-800">{rates.kcRate != null ? `${rates.kcRate}%` : "—"}</div>
              <div className="text-xs text-slate-500">KC÷有効</div>
              {prevRates && prevRates.kcRate != null && <div className="mt-1 text-xs text-slate-500">前日: {prevRates.kcRate}%</div>}
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">アポ率</div>
              <div className="text-lg font-bold text-slate-800">{rates.apoRate != null ? `${rates.apoRate}%` : "—"}</div>
              <div className="text-xs text-slate-500">決裁者アポ÷KC</div>
              {prevRates && prevRates.apoRate != null && <div className="mt-1 text-xs text-slate-500">前日: {prevRates.apoRate}%</div>}
            </div>
          </div>
          {monthRates && (
            <div className="mt-3 border-t border-slate-200 pt-3 text-center text-xs text-slate-500">
              今月平均 有効率 {monthRates.validRate != null ? `${monthRates.validRate}%` : "—"} / KC率 {monthRates.kcRate != null ? `${monthRates.kcRate}%` : "—"} / アポ率 {monthRates.apoRate != null ? `${monthRates.apoRate}%` : "—"}
            </div>
          )}
        </section>
      )}

      <section className="mb-6 rounded-xl bg-slate-800 p-5 text-white shadow-md sm:mb-8 sm:p-6">
        <h2 className="mb-3 text-sm font-medium text-slate-300">今月の累計（{currentYearMonth}）</h2>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <div>総コール数: <span className="font-semibold">{totals.totalCalls}</span></div>
          <div>総有効コール数: <span className="font-semibold">{totals.validCalls}</span></div>
          <div>KC数: <span className="font-semibold">{totals.kcCount}</span></div>
          <div>追いかけ作成: <span className="font-semibold">{totals.followUpCreated}</span></div>
          <div>決裁者アポ: <span className="font-semibold">{totals.decisionMakerApo}</span></div>
          <div>非決裁者アポ: <span className="font-semibold">{totals.nonDecisionMakerApo}</span></div>
        </div>
        <p className="mt-2 text-sm text-slate-300">合計アポ数: <span className="font-semibold">{totals.totalApo}</span></p>
      </section>

      <section className="mb-8 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80 sm:p-6">
        <h2 className="mb-4 text-sm font-medium text-slate-700">本日の成果入力</h2>
        <p className="mb-4 text-sm text-slate-600">日付を選び、数値を入力して保存してください。</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-slate-600">日付</label>
            <input
              type="date"
              value={kpiDate}
              onChange={(e) => setKpiDate(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800"
            />
            {isWeekendYmdJst(kpiDate) && (
              <p className="mt-1 text-xs font-medium text-amber-800">{JST_WEEKEND_WORK_REJECTED_MESSAGE}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3">
            {KPI_LABELS.map(({ key, label, callSystemHint }) => (
              <div key={key} className="flex min-w-0 flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-700">{label}</label>
                {callSystemHint ? (
                  <p className="text-[11px] leading-snug text-slate-500 sm:text-xs">{callSystemHint}</p>
                ) : null}
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  placeholder="0"
                  value={kpiFields[key]}
                  onChange={(e) =>
                    setKpiFields((prev) => ({
                      ...prev,
                      [key]: sanitizeKpiNumericInput(e.target.value),
                    }))
                  }
                  onFocus={handleKpiNumberInputFocus}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800"
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              title={isWeekendYmdJst(kpiDate) ? JST_WEEKEND_WORK_REJECTED_MESSAGE : undefined}
              disabled={kpiSaveBusy || isWeekendYmdJst(kpiDate)}
              className="rounded-xl bg-slate-700 px-4 py-2.5 font-medium text-white hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {kpiSaveBusy ? "保存中…" : "保存する"}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200/80">
        <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 sm:px-5 sm:py-4">今月のKPI履歴（{currentYearMonth}）</h2>
        <div className="divide-y divide-slate-100">
          {monthKpiList.length === 0 ? (
            <div className="px-4 py-8 text-center text-slate-500 sm:px-5">まだKPIがありません</div>
          ) : (
            monthKpiList.map((k) => (
              <div key={k.id} className="px-4 py-3 sm:px-5 sm:py-4">
                <div className="mb-1 font-medium text-slate-800">{formatDisplayDate(k.date)}</div>
                <div className="text-xs text-slate-600 sm:text-sm">
                  総コール数 {k.totalCalls} / 総有効コール数 {k.validCalls} / KC {k.kcCount} / 追いかけ {k.followUpCreated} / 決裁者アポ {k.decisionMakerApo} / 非決裁者アポ {k.nonDecisionMakerApo}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}

/** メンバー本人向け「振込先・インボイス設定」フォームの下書き */
type MemberSelfBankDraft = {
  postalCode: string;
  address: string;
  bankName: string;
  branchName: string;
  accountType: string;
  accountNumber: string;
  accountHolder: string;
  phoneNumber: string;
  invoiceRegistrationNumber: string;
};

const EMPTY_MEMBER_SELF_BANK_DRAFT: MemberSelfBankDraft = {
  postalCode: "",
  address: "",
  bankName: "",
  branchName: "",
  accountType: "普通",
  accountNumber: "",
  accountHolder: "",
  phoneNumber: "",
  invoiceRegistrationNumber: "",
};

export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<Tab>("home");
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [allRecords, setAllRecords] = useState<WorkRecord[]>([]);
  const [allOpenRecords, setAllOpenRecords] = useState<OpenRecord[]>([]);
  const [allShifts, setAllShifts] = useState<Shift[]>([]);
  const [allKpiRecords, setAllKpiRecords] = useState<KpiRecord[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [loginAccount, setLoginAccount] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [setupName, setSetupName] = useState("");
  const [setupLogin, setSetupLogin] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupHourlyRate, setSetupHourlyRate] = useState(DEFAULT_HOURLY_RATE);
  const [showMemberReportModal, setShowMemberReportModal] = useState(false);
  const [memberReportMonth, setMemberReportMonth] = useState("");
  const [planActualGapApprovedKeys, setPlanActualGapApprovedKeys] = useState<Set<string>>(new Set());
  const [planActualGapResolutionByKey, setPlanActualGapResolutionByKey] = useState<
    Map<string, PlanActualGapResolution | null>
  >(new Map());
  const [adminEditMemberFromUrl, setAdminEditMemberFromUrl] = useState<string | undefined>(undefined);
  /** 打刻の二重送信防止: idle のときだけ次操作可。成功後は done までロック */
  const [punchSubmitPhase, setPunchSubmitPhase] = useState<
    "idle" | "start_sending" | "end_sending" | "start_done" | "end_done" | "end_modal_open"
  >("idle");
  const [punchToast, setPunchToast] = useState<{ message: string; isError?: boolean; prominent?: boolean } | null>(null);
  /** KPI 保存・その他データ更新のフィードバック（メンバー／管理者共通） */
  const [memberDataToast, setMemberDataToast] = useState<{ message: string; isError: boolean } | null>(null);
  const punchInFlightRef = useRef(false);
  /** 打刻可能時間帯・締切の境界で UI を更新する */
  const [punchUiTick, setPunchUiTick] = useState(0);
  const [showEndWithoutStartModal, setShowEndWithoutStartModal] = useState(false);
  const [manualStartTimeHhmm, setManualStartTimeHhmm] = useState("09:00");
  const [endModalSubmitting, setEndModalSubmitting] = useState(false);
  /** 終了打刻成功時に全画面フィードバックを約1秒表示 */
  const [punchCompleteFlash, setPunchCompleteFlash] = useState(false);
  const punchCompleteTimerRef = useRef<number | null>(null);
  /** 終了打刻成功から猶予後に KPI 未入力 Slack を 1 回試行するタイマー */
  const kpiMissingPunchTimerRef = useRef<number | null>(null);
  /** KPI タブ表示・保存直後の通知チェックの連打防止（ms エポックまでスキップ） */
  const kpiMissingNotifyCooldownUntilRef = useRef(0);
  const [memberSelfBankDraft, setMemberSelfBankDraft] = useState<MemberSelfBankDraft>(() => ({
    ...EMPTY_MEMBER_SELF_BANK_DRAFT,
  }));
  const [memberSelfBankProfileBusy, setMemberSelfBankProfileBusy] = useState(false);
  const memberSelfBankProfileSeededForUserIdRef = useRef<string | null>(null);

  const invokeKpiMissingNotifyImmediate = useCallback(async () => {
    try {
      const { notifyKpiMissingAfterPunchIfEligibleAction } = await import("@/app/actions/kpi-missing-after-punch-notify");
      await notifyKpiMissingAfterPunchIfEligibleAction();
    } catch (e) {
      console.warn("[KPI missing after punch]", e);
    }
  }, []);

  const invokeKpiMissingNotifyThrottled = useCallback(async () => {
    const now = Date.now();
    if (now < kpiMissingNotifyCooldownUntilRef.current) return;
    kpiMissingNotifyCooldownUntilRef.current = now + 60_000;
    await invokeKpiMissingNotifyImmediate();
  }, [invokeKpiMissingNotifyImmediate]);

  const scheduleKpiMissingSlackAfterEndPunch = useCallback(
    (workDate: string) => {
      if (typeof window === "undefined") return;
      if (!currentUserId || isAdminMode) return;
      const today = getTodayJstDateString();
      if (workDate !== today || isWeekendYmdJst(workDate)) return;
      if (kpiMissingPunchTimerRef.current != null) {
        window.clearTimeout(kpiMissingPunchTimerRef.current);
        kpiMissingPunchTimerRef.current = null;
      }
      const delayMs = readKpiMissingAfterPunchGraceMinutes() * 60 * 1000;
      kpiMissingPunchTimerRef.current = window.setTimeout(() => {
        kpiMissingPunchTimerRef.current = null;
        void invokeKpiMissingNotifyImmediate();
      }, delayMs);
    },
    [currentUserId, isAdminMode, invokeKpiMissingNotifyImmediate]
  );

  useEffect(() => {
    return () => {
      if (punchCompleteTimerRef.current) window.clearTimeout(punchCompleteTimerRef.current);
      if (kpiMissingPunchTimerRef.current) window.clearTimeout(kpiMissingPunchTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (tab !== "kpi" || !currentUserId || isAdminMode) return;
    void invokeKpiMissingNotifyThrottled();
  }, [tab, currentUserId, isAdminMode, invokeKpiMissingNotifyThrottled]);

  useEffect(() => {
    if (punchSubmitPhase !== "start_done") return;
    const uid = currentUserId;
    if (!uid) return;
    const or = getOpenRecordForUser(allOpenRecords, uid);
    if (or) setPunchSubmitPhase("idle");
  }, [punchSubmitPhase, allOpenRecords, currentUserId]);

  useEffect(() => {
    if (punchSubmitPhase !== "start_done") return;
    const uid = currentUserId;
    if (!uid) return;
    const or = getOpenRecordForUser(allOpenRecords, uid);
    if (or) return;
    const id = window.setTimeout(() => setPunchSubmitPhase("idle"), 4000);
    return () => window.clearTimeout(id);
  }, [punchSubmitPhase, allOpenRecords, currentUserId]);

  useEffect(() => {
    if (punchSubmitPhase !== "end_done") return;
    const id = window.setTimeout(() => setPunchSubmitPhase("idle"), 1400);
    return () => window.clearTimeout(id);
  }, [punchSubmitPhase]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    const id = q.get("adminEditMember")?.trim();
    if (id) setAdminEditMemberFromUrl(id);
  }, []);

  const clearAdminEditDeepLink = useCallback(() => {
    setAdminEditMemberFromUrl(undefined);
    if (typeof window === "undefined") return;
    const u = new URL(window.location.href);
    if (!u.searchParams.has("adminEditMember")) return;
    u.searchParams.delete("adminEditMember");
    const qs = u.searchParams.toString();
    window.history.replaceState({}, "", `${u.pathname}${qs ? `?${qs}` : ""}`);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [records, openRecs, shifts, kpis, mems, gapDetailed] = await Promise.all([
        loadRecords(),
        loadOpenRecords(),
        loadShifts(),
        loadKpi(),
        loadMembers(),
        loadPlanActualGapApprovalsDetailed(),
      ]);
      setAllRecords(records);
      setAllOpenRecords(openRecs);
      setAllShifts(shifts);
      setAllKpiRecords(kpis);
      setMembers(mems ?? []);
      setPlanActualGapApprovedKeys(new Set(gapDetailed.map((r) => planActualGapApprovalKey(r.userId, r.date))));
      setPlanActualGapResolutionByKey(
        new Map(gapDetailed.map((r) => [planActualGapApprovalKey(r.userId, r.date), r.resolution]))
      );
    } catch (e) {
      console.error("refresh", e);
      setLoadError("データの取得に失敗しました。Supabase の設定とテーブルを確認してください。");
    }
  }, []);

  const syncOpenRecordFromDbAndLocal = useCallback(async () => {
    if (!currentUserId || isAdminMode) return;
    const uid = currentUserId;
    const todayJst = getTodayJstDateString();
    const minDate = addCalendarDays(todayJst, -1);
    try {
      const list = await loadOpenRecords();
      const fromDb = getOpenRecordForUser(list, uid);
      if (fromDb) {
        setAllOpenRecords((prev) => {
          const cur = getOpenRecordForUser(prev, uid);
          if (cur && cur.id === fromDb.id && cur.startRounded === fromDb.startRounded) return prev;
          return [...prev.filter((r) => r.userId !== uid), fromDb];
        });
        persistOpenRecordClientBackup(uid, fromDb);
        return;
      }
      const localBackup = readOpenRecordClientBackup(uid);
      if (!localBackup) return;
      if (localBackup.date < minDate) {
        persistOpenRecordClientBackup(uid, null);
        return;
      }
      try {
        await setOpenRecordForUser(uid, localBackup, { bypassPunchTimeRestrictions: true });
        await refresh();
      } catch {
        persistOpenRecordClientBackup(uid, null);
      }
    } catch {
      /* 一時的な通信エラーは無視 */
    }
  }, [currentUserId, isAdminMode, refresh]);

  const hydrate = useCallback(async () => {
    setLoadError(null);
    try {
      const mems = await loadMembers();
      if (mems === null) {
        setLoadError("Supabase の設定がありません。.env.local に NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を設定してください。");
        setMembers([]);
        setCurrentUserId(null);
        return;
      }
      setMembers(mems);
      const [records, openRecs, shifts, kpis, gapDetailed0] = await Promise.all([
        loadRecords(),
        loadOpenRecords(),
        loadShifts(),
        loadKpi(),
        loadPlanActualGapApprovalsDetailed(),
      ]);
      setAllRecords(records);
      setAllOpenRecords(openRecs);
      setAllShifts(shifts);
      setAllKpiRecords(kpis);
      setPlanActualGapApprovedKeys(new Set(gapDetailed0.map((r) => planActualGapApprovalKey(r.userId, r.date))));
      setPlanActualGapResolutionByKey(
        new Map(gapDetailed0.map((r) => [planActualGapApprovalKey(r.userId, r.date), r.resolution]))
      );
      await runAutoComplete();
      const [records2, open2, gapDetailed] = await Promise.all([
        loadRecords(),
        loadOpenRecords(),
        loadPlanActualGapApprovalsDetailed(),
      ]);
      setAllRecords(records2);
      setAllOpenRecords(open2);
      setPlanActualGapApprovedKeys(new Set(gapDetailed.map((r) => planActualGapApprovalKey(r.userId, r.date))));
      setPlanActualGapResolutionByKey(
        new Map(gapDetailed.map((r) => [planActualGapApprovalKey(r.userId, r.date), r.resolution]))
      );
      const now = new Date();
      setSelectedMonth((prev) => prev || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
      if (mems.length === 0) {
        setShowSetup(true);
        setCurrentUserId(null);
        return;
      }
      setShowSetup(false);
      setCurrentUserId((prev) => {
        if (prev && mems.some((m) => m.id === prev)) return prev;
        return null;
      });
    } catch (err) {
      console.error("hydrate", err);
      setLoadError("Supabase に接続できません。.env.local の NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を確認し、supabase-schema.sql でテーブルを作成してください。");
      setMembers([]);
      setCurrentUserId(null);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) void hydrate();
  }, [mounted, hydrate]);

  useEffect(() => {
    if (tab !== "home" || !currentUserId || isAdminMode) return;
    void syncOpenRecordFromDbAndLocal();
  }, [tab, currentUserId, isAdminMode, syncOpenRecordFromDbAndLocal]);

  useEffect(() => {
    if (!currentUserId || isAdminMode) return;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      void syncOpenRecordFromDbAndLocal();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [currentUserId, isAdminMode, syncOpenRecordFromDbAndLocal]);

  useEffect(() => {
    if (!punchToast) return;
    const ms = punchToast.isError ? 8000 : punchToast.prominent ? 5500 : 4500;
    const t = window.setTimeout(() => setPunchToast(null), ms);
    return () => window.clearTimeout(t);
  }, [punchToast]);

  useEffect(() => {
    if (!memberDataToast) return;
    const t = window.setTimeout(() => setMemberDataToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [memberDataToast]);

  useEffect(() => {
    if (isAdminMode || !currentUserId) {
      memberSelfBankProfileSeededForUserIdRef.current = null;
      return;
    }
    const m = members.find((x) => x.id === currentUserId);
    if (!m) return;
    if (memberSelfBankProfileSeededForUserIdRef.current === currentUserId) return;
    memberSelfBankProfileSeededForUserIdRef.current = currentUserId;
    setMemberSelfBankDraft({
      postalCode: m.postalCode ?? "",
      address: m.address ?? "",
      bankName: m.bankName ?? "",
      branchName: m.branchName ?? "",
      accountType: m.accountType ?? "普通",
      accountNumber: m.accountNumber ?? "",
      accountHolder: m.accountHolder ?? "",
      phoneNumber: m.phoneNumber ?? "",
      invoiceRegistrationNumber: m.invoiceRegistrationNumber ?? "",
    });
  }, [isAdminMode, currentUserId, members]);

  useEffect(() => {
    if (tab !== "home" || !currentUserId || isAdminMode) return;
    const id = window.setInterval(() => setPunchUiTick((n) => n + 1), 20000);
    return () => window.clearInterval(id);
  }, [tab, currentUserId, isAdminMode]);

  const records = isAdminMode ? allRecords : getRecordsForUser(allRecords, currentUserId ?? "");
  const openRecord = getOpenRecordForUser(allOpenRecords, currentUserId ?? "");
  const shifts = isAdminMode ? allShifts : getShiftsForUser(allShifts, currentUserId ?? "");
  const kpiRecords = isAdminMode ? allKpiRecords : getKpiForUser(allKpiRecords, currentUserId ?? "");

  const todayStr = getTodayJstDateString();
  const punchBlockedJstWeekend = isWeekendYmdJst(todayStr);
  void punchUiTick;
  const punchNow = new Date();
  const memberPunchContext = !isAdminMode && !!currentUserId;
  const punchWindowOkJst = isWithinDailyPunchClockWindowJst(punchNow);
  const todayShiftForStartPunch =
    memberPunchContext && currentUserId
      ? canonicalShiftForUserDate(allShifts, currentUserId, todayStr)
      : undefined;
  const punchStartAllowedByPlan = isMemberStartPunchAllowedByPlannedWorkJst(punchNow, todayShiftForStartPunch);
  const punchStartPlanBlockReason = (() => {
    if (!memberPunchContext || punchBlockedJstWeekend || !punchWindowOkJst) return null;
    const m = getJstMinutesSinceMidnight(punchNow);
    if (m < 0) return null;
    const earliest = getMemberStartPunchEarliestJstMinutesSinceMidnight(todayShiftForStartPunch);
    if (m < earliest) return "early" as const;
    const latest = getMemberStartPunchLatestJstMinutesSinceMidnight(todayShiftForStartPunch);
    if (latest != null && m > latest) return "late" as const;
    return null;
  })();
  const openShiftForPunch =
    openRecord != null
      ? canonicalShiftForUserDate(allShifts, openRecord.userId, openRecord.date)
      : undefined;
  const endPunchLockedPastPlan =
    !!openRecord &&
    memberPunchContext &&
    !isWeekendYmdJst(openRecord.date) &&
    isMemberEndPunchLockedByPlanAt(punchNow, openRecord.date, openShiftForPunch);
  const punchFlowBusy = punchSubmitPhase !== "idle";
  const hasWorkedTodayAlready = allRecords.some(
    (r) => r.userId === (currentUserId ?? "") && r.date === formatYmdJst(punchNow)
  );
  const punchStartDisabled =
    !memberPunchContext ||
    !!openRecord ||
    punchFlowBusy ||
    punchBlockedJstWeekend ||
    !punchWindowOkJst ||
    (!hasWorkedTodayAlready && !punchStartAllowedByPlan);
  const punchEndDisabledWithOpen =
    !memberPunchContext ||
    !openRecord ||
    punchFlowBusy ||
    isWeekendYmdJst(openRecord.date) ||
    !punchWindowOkJst ||
    endPunchLockedPastPlan;
  /** 未稼働時も終了からモーダルへ。送信中・完了表示・モーダル表示中はロック */
  const punchEndDisabledNoOpen = !memberPunchContext || punchFlowBusy;
  const punchEndDisabled = openRecord ? punchEndDisabledWithOpen : punchEndDisabledNoOpen;
  const todayMinutes = getTotalMinutesForDate(records, todayStr);
  const jstYm = getTodayJstDateString().slice(0, 7);
  const currentYearMonth = selectedMonth || jstYm;
  const monthRecords = getRecordsForMonth(records, currentYearMonth);
  const monthShifts = shifts.filter((s) => s.date.startsWith(currentYearMonth));
  const monthKpi = getKpiForMonth(kpiRecords, currentYearMonth);
  const totalMinutes = getTotalMinutesForMonth(records, currentYearMonth);
  const isCurrentMonth = currentYearMonth === jstYm;
  const selectableMonths = getSelectableMonths(records, shifts, kpiRecords);

  const memberTargetWeekStart = addWeeksToWeekStart(getMondayOfCalendarWeekForYmd(getTodayJstDateString()), 1);
  const memberTargetWeekDates = getWeekDates(memberTargetWeekStart);
  const memberHasEntryForTargetWeek =
    !currentUserId || getShiftsForUser(allShifts, currentUserId).some((s) => memberTargetWeekDates.includes(s.date));

  const PUNCH_SAVED_TOAST = "打刻しました！";

  const applyOpenRecordFromDb = useCallback(
    (uid: string, fromDb: OpenRecord | null) => {
      setAllOpenRecords((prev) => {
        const cur = getOpenRecordForUser(prev, uid);
        if (!fromDb) {
          if (!cur) return prev;
          return prev.filter((r) => r.userId !== uid);
        }
        if (cur && cur.id === fromDb.id && cur.startRounded === fromDb.startRounded) return prev;
        return [...prev.filter((r) => r.userId !== uid), fromDb];
      });
      if (fromDb) persistOpenRecordClientBackup(uid, fromDb);
      else persistOpenRecordClientBackup(uid, null);
    },
    []
  );

  const handleStart = async () => {
    if (!currentUserId || punchInFlightRef.current) return;
    if (openRecord) return;
    if (punchSubmitPhase !== "idle") return;
    punchInFlightRef.current = true;
    setPunchSubmitPhase("start_sending");
    const uid = currentUserId;
    try {
      let openFromDb: OpenRecord | null = null;
      try {
        openFromDb = await loadMemberOpenRecordFromDb(uid);
        applyOpenRecordFromDb(uid, openFromDb);
      } catch {
        /* 同期失敗時は画面状態で続行 */
      }
      if (openFromDb) {
        setPunchToast({ message: PUNCH_ALREADY_STARTED_MESSAGE, isError: true });
        setPunchSubmitPhase("idle");
        return;
      }
      if (punchBlockedJstWeekend) {
        setPunchToast({ message: JST_WEEKEND_WORK_REJECTED_MESSAGE, isError: true });
        setPunchSubmitPhase("idle");
        return;
      }
      const guardNow = new Date();
      if (!isWithinDailyPunchClockWindowJst(guardNow)) {
        setPunchToast({ message: PUNCH_OUTSIDE_WINDOW_MESSAGE, isError: true });
        setPunchSubmitPhase("idle");
        return;
      }
      const shiftForStart = canonicalShiftForUserDate(allShifts, uid, getTodayJstDateString(guardNow));
      if (!isMemberStartPunchAllowedByPlannedWorkJst(guardNow, shiftForStart)) {
        const m = getJstMinutesSinceMidnight(guardNow);
        const latest = getMemberStartPunchLatestJstMinutesSinceMidnight(shiftForStart);
        const tooLate = latest != null && m > latest;
        setPunchToast({
          message: tooLate ? PUNCH_START_AFTER_PLANNED_MESSAGE : PUNCH_START_BEFORE_PLANNED_MESSAGE,
          isError: true,
        });
        setPunchSubmitPhase("idle");
        return;
      }
      const now = new Date();
      const rounded = roundUpTo15Minutes(now);
      const newOpen: OpenRecord = {
        id: crypto.randomUUID(),
        userId: uid,
        startRaw: now.toISOString(),
        startRounded: rounded.toISOString(),
        date: getTodayJstDateString(now),
      };
      setAllOpenRecords((prev) => [...prev.filter((r) => r.userId !== uid), newOpen]);
      persistOpenRecordClientBackup(uid, newOpen);
      await withNetworkRetry(async () => {
        await setOpenRecordForUser(uid, newOpen);
        await refresh();
        const list = await loadOpenRecords();
        const canonical = getOpenRecordForUser(list, uid);
        if (canonical) persistOpenRecordClientBackup(uid, canonical);
      }, PUNCH_NETWORK_RETRY_OPTIONS);
      setPunchToast({ message: PUNCH_SAVED_TOAST, isError: false, prominent: true });
      setPunchSubmitPhase("start_done");
    } catch (e) {
      setAllOpenRecords((prev) => prev.filter((r) => r.userId !== uid));
      persistOpenRecordClientBackup(uid, null);
      try {
        await refresh();
      } catch {
        /* ignore */
      }
      setPunchToast({
        message: resolvePunchErrorMessage(e, PUNCH_GENERIC_NETWORK_ERROR),
        isError: true,
      });
      setPunchSubmitPhase("idle");
    } finally {
      punchInFlightRef.current = false;
    }
  };

  const handleEnd = async () => {
    if (!currentUserId || punchInFlightRef.current) return;
    if (punchSubmitPhase !== "idle") return;
    punchInFlightRef.current = true;
    setPunchSubmitPhase("end_sending");
    const uid = currentUserId;
    let snap: OpenRecord | null = null;
    try {
      try {
        const openFromDb = await loadMemberOpenRecordFromDb(uid);
        applyOpenRecordFromDb(uid, openFromDb);
        snap = openFromDb;
      } catch {
        snap = getOpenRecordForUser(allOpenRecords, uid);
      }
      if (!snap) {
        setPunchToast({ message: PUNCH_NO_OPEN_RECORD_MESSAGE, isError: true });
        setPunchSubmitPhase("idle");
        return;
      }
      const openSnap = snap;
      if (isWeekendYmdJst(openSnap.date)) {
        setPunchToast({ message: JST_WEEKEND_WORK_REJECTED_MESSAGE, isError: true });
        setPunchSubmitPhase("idle");
        return;
      }
      const tGuard = new Date();
      if (!isWithinDailyPunchClockWindowJst(tGuard)) {
        setPunchToast({ message: PUNCH_OUTSIDE_WINDOW_MESSAGE, isError: true });
        setPunchSubmitPhase("idle");
        return;
      }
      const shiftForEnd = canonicalShiftForUserDate(allShifts, uid, openSnap.date);
      if (isMemberEndPunchLockedByPlanAt(tGuard, openSnap.date, shiftForEnd)) {
        setPunchToast({ message: PUNCH_DEADLINE_PASSED_MESSAGE, isError: true });
        setPunchSubmitPhase("idle");
        return;
      }
      const now = new Date();
      const endRounded = roundDownTo15Minutes(now);
      const startRounded = new Date(openSnap.startRounded);
      if (formatYmdJst(startRounded) !== openSnap.date || formatYmdJst(endRounded) !== openSnap.date) {
        setPunchToast({ message: "開始・終了は同一稼働日（日本時間）にしてください。", isError: true });
        setPunchSubmitPhase("idle");
        return;
      }
      if (endRounded.getTime() <= startRounded.getTime()) {
        setPunchToast({
          message:
            endRounded.getTime() === startRounded.getTime()
              ? WORK_RECORD_SAME_START_END_MESSAGE
              : WORK_RECORD_END_NOT_AFTER_START_MESSAGE,
          isError: true,
        });
        setPunchSubmitPhase("idle");
        return;
      }
      let durationMinutes = calcDurationMinutes(startRounded, endRounded);
      if (durationMinutes <= 0) {
        setPunchToast({ message: "稼働時間が0分以下のため保存できません。", isError: true });
        setPunchSubmitPhase("idle");
        return;
      }
      if (durationMinutes > WORK_DURATION_HARD_MAX_MINUTES) {
        setPunchToast({ message: WORK_DURATION_EXCEEDS_24H_MESSAGE, isError: true });
        setPunchSubmitPhase("idle");
        return;
      }
      if (durationMinutes > WORK_DURATION_SOFT_CONFIRM_MINUTES) {
        const ok = window.confirm(
          `稼働時間が ${formatDuration(WORK_DURATION_SOFT_CONFIRM_MINUTES)} を超えています（${formatDuration(durationMinutes)}）。この内容で保存しますか？`
        );
        if (!ok) {
          setPunchSubmitPhase("idle");
          return;
        }
      }
      const newRecord: WorkRecord = {
        id: openSnap.id,
        userId: uid,
        startRaw: openSnap.startRaw,
        startRounded: openSnap.startRounded,
        endRaw: now.toISOString(),
        endRounded: endRounded.toISOString(),
        durationMinutes,
        date: openSnap.date,
      };
      const userRecords = getRecordsForUser(allRecords, uid).filter((r) => r.id !== openSnap.id);
      const next = [newRecord, ...userRecords];
      await withNetworkRetry(async () => {
        await saveRecordsForUser(uid, next);
        await setOpenRecordForUser(uid, null);
        persistOpenRecordClientBackup(uid, null);
        await refresh();
      }, PUNCH_NETWORK_RETRY_OPTIONS);
      setPunchToast({ message: PUNCH_SAVED_TOAST, isError: false, prominent: true });
      if (punchCompleteTimerRef.current) window.clearTimeout(punchCompleteTimerRef.current);
      setPunchCompleteFlash(true);
      punchCompleteTimerRef.current = window.setTimeout(() => {
        setPunchCompleteFlash(false);
        punchCompleteTimerRef.current = null;
      }, 1000);
      setPunchSubmitPhase("end_done");
      scheduleKpiMissingSlackAfterEndPunch(openSnap.date);
    } catch (e) {
      try {
        await refresh();
      } catch {
        /* ignore */
      }
      setPunchToast({
        message: resolvePunchErrorMessage(e, PUNCH_GENERIC_NETWORK_ERROR),
        isError: true,
      });
      setPunchSubmitPhase("idle");
    } finally {
      punchInFlightRef.current = false;
    }
  };

  const handleEndClick = () => {
    if (!currentUserId || punchInFlightRef.current) return;
    if (punchSubmitPhase !== "idle") return;
    void (async () => {
      try {
        const openFromDb = await loadMemberOpenRecordFromDb(currentUserId);
        applyOpenRecordFromDb(currentUserId, openFromDb);
        if (openFromDb || openRecord) {
          void handleEnd();
          return;
        }
      } catch {
        if (openRecord) {
          void handleEnd();
          return;
        }
      }
      setPunchSubmitPhase("end_modal_open");
      setManualStartTimeHhmm("09:00");
      setShowEndWithoutStartModal(true);
    })();
  };

  const submitEndWithoutOpenRecord = async (mode: "now" | "manual") => {
    if (!currentUserId || endModalSubmitting || punchInFlightRef.current) return;
    if (punchSubmitPhase !== "end_modal_open") return;
    punchInFlightRef.current = true;
    setPunchSubmitPhase("end_sending");
    setEndModalSubmitting(true);
    const uid = currentUserId;
    const workDate = getTodayJstDateString();
    try {
      try {
        const openFromDb = await loadMemberOpenRecordFromDb(uid);
        applyOpenRecordFromDb(uid, openFromDb);
        if (openFromDb) {
          setShowEndWithoutStartModal(false);
          setPunchSubmitPhase("idle");
          setEndModalSubmitting(false);
          punchInFlightRef.current = false;
          setPunchToast({ message: PUNCH_ALREADY_STARTED_MESSAGE, isError: true });
          return;
        }
      } catch {
        /* 続行 */
      }
      if (isWeekendYmdJst(workDate)) {
        setPunchToast({ message: JST_WEEKEND_WORK_REJECTED_MESSAGE, isError: true });
        setPunchSubmitPhase("end_modal_open");
        return;
      }
      const guardEarly = new Date();
      if (!isWithinDailyPunchClockWindowJst(guardEarly)) {
        setPunchToast({ message: PUNCH_OUTSIDE_WINDOW_MESSAGE, isError: true });
        setPunchSubmitPhase("end_modal_open");
        return;
      }
      const shiftEarly = canonicalShiftForUserDate(allShifts, uid, workDate);
      if (isMemberEndPunchLockedByPlanAt(guardEarly, workDate, shiftEarly)) {
        setPunchToast({ message: PUNCH_DEADLINE_PASSED_MESSAGE, isError: true });
        setPunchSubmitPhase("end_modal_open");
        return;
      }
      let startRaw: Date;
      let startRoundedDate: Date;
      if (mode === "now") {
        startRaw = new Date();
        startRoundedDate = roundUpTo15Minutes(startRaw);
      } else {
        const t = parseStartInstantJstOnWorkDate(workDate, manualStartTimeHhmm);
        if (!t) {
          setPunchToast({ message: "開始時刻を HH:mm（例 09:00）で入力してください。", isError: true });
          setPunchSubmitPhase("end_modal_open");
          return;
        }
        startRaw = t;
        startRoundedDate = roundUpTo15Minutes(t);
      }
      const now = new Date();
      const endRounded = roundDownTo15Minutes(now);
      if (formatYmdJst(startRoundedDate) !== workDate || formatYmdJst(endRounded) !== workDate) {
        setPunchToast({ message: "開始・終了は同一稼働日（日本時間）にしてください。", isError: true });
        setPunchSubmitPhase("end_modal_open");
        return;
      }
      if (startRoundedDate.getTime() >= endRounded.getTime()) {
        setPunchToast({
          message:
            startRoundedDate.getTime() === endRounded.getTime()
              ? WORK_RECORD_SAME_START_END_MESSAGE
              : WORK_RECORD_END_NOT_AFTER_START_MESSAGE,
          isError: true,
        });
        setPunchSubmitPhase("end_modal_open");
        return;
      }
      let durationMinutes = calcDurationMinutes(startRoundedDate, endRounded);
      if (durationMinutes <= 0) {
        setPunchToast({ message: "稼働時間が0分以下になります。開始時刻を調整してください。", isError: true });
        setPunchSubmitPhase("end_modal_open");
        return;
      }
      if (durationMinutes > WORK_DURATION_HARD_MAX_MINUTES) {
        setPunchToast({ message: WORK_DURATION_EXCEEDS_24H_MESSAGE, isError: true });
        setPunchSubmitPhase("end_modal_open");
        return;
      }
      if (durationMinutes > WORK_DURATION_SOFT_CONFIRM_MINUTES) {
        const ok = window.confirm(
          `稼働時間が ${formatDuration(WORK_DURATION_SOFT_CONFIRM_MINUTES)} を超えています（${formatDuration(durationMinutes)}）。この内容で保存しますか？`
        );
        if (!ok) {
          setPunchSubmitPhase("end_modal_open");
          return;
        }
      }

      const newRecord: WorkRecord = {
        id: crypto.randomUUID(),
        userId: uid,
        startRaw: startRaw.toISOString(),
        startRounded: startRoundedDate.toISOString(),
        endRaw: now.toISOString(),
        endRounded: endRounded.toISOString(),
        durationMinutes,
        date: workDate,
      };
      const userRecords = getRecordsForUser(allRecords, uid).filter((r) => r.id !== newRecord.id);
      const next = [newRecord, ...userRecords];
      await withNetworkRetry(async () => {
        await saveRecordsForUser(uid, next);
        await setOpenRecordForUser(uid, null);
        persistOpenRecordClientBackup(uid, null);
        await refresh();
      }, PUNCH_NETWORK_RETRY_OPTIONS);
      setShowEndWithoutStartModal(false);
      setPunchToast({ message: PUNCH_SAVED_TOAST, isError: false, prominent: true });
      if (punchCompleteTimerRef.current) window.clearTimeout(punchCompleteTimerRef.current);
      setPunchCompleteFlash(true);
      punchCompleteTimerRef.current = window.setTimeout(() => {
        setPunchCompleteFlash(false);
        punchCompleteTimerRef.current = null;
      }, 1000);
      setPunchSubmitPhase("end_done");
      scheduleKpiMissingSlackAfterEndPunch(workDate);
    } catch (e) {
      try {
        await refresh();
      } catch {
        /* ignore */
      }
      setPunchToast({
        message: resolvePunchErrorMessage(e, PUNCH_GENERIC_NETWORK_ERROR),
        isError: true,
      });
      setPunchSubmitPhase("end_modal_open");
    } finally {
      punchInFlightRef.current = false;
      setEndModalSubmitting(false);
    }
  };

  const handleSaveShifts = async (newShifts: Shift[]): Promise<boolean> => {
    if (!currentUserId) return false;
    const thisMon = getMondayOfCalendarWeekForYmd(getTodayJstDateString());
    const [subW1, subW2] = getSubmittableShiftWeekMondays(thisMon);
    const normalized = newShifts.map((s) => {
      if (s.userId !== currentUserId || !isWeekendYmd(s.date)) return s;
      return {
        ...s,
        startPlanned: SHIFT_ENTRY_NONE,
        endPlanned: SHIFT_ENTRY_NONE,
        startPlanned2: undefined,
        endPlanned2: undefined,
      };
    });
    for (const s of normalized) {
      if (s.userId !== currentUserId) continue;
      const wm = getMondayOfCalendarWeekForYmd(s.date);
      if (wm === thisMon) continue;
      if (wm === subW1 || wm === subW2) {
        if (!isWeekOpenForEntry(wm, thisMon)) {
          alert("この週のシフト提出は締め切られています。保存できません。");
          return false;
        }
      }
    }
    const withManual = normalized.map((s) => ({
      ...s,
      ...(shiftPrimarySlotIsExplicitNoneEntry(s) || shiftSecondarySlotIsExplicitNoneEntry(s)
        ? { isManualDelete: true as const }
        : {}),
    }));
    const res = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ shifts: shiftsToScheduleApiJson(withManual) }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      alert(typeof data.error === "string" ? data.error : "稼働予定の保存に失敗しました");
      return false;
    }
    await refresh();
    return true;
  };

  const handleSaveKpi = async (savedDay: KpiRecord, newKpi: KpiRecord[]) => {
    if (!currentUserId) return;
    try {
      await saveKpiForUser(currentUserId, newKpi);
      const uid = currentUserId;
      const mergedUser = dedupeKpiRecordsByUserDate(newKpi.map((k) => ({ ...k, userId: uid })));
      setAllKpiRecords((prev) => [...prev.filter((k) => k.userId !== uid), ...mergedUser]);
      await refresh();
      setMemberDataToast({ message: "保存しました", isError: false });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMemberDataToast({
        message: msg.trim() !== "" ? msg : "保存に失敗しました。時間をおいて再度お試しください。",
        isError: true,
      });
      try {
        await refresh();
      } catch {
        /* ignore */
      }
      return;
    }
    const dateKey = savedDay.date;
    void (async () => {
      try {
        const { runKpiProductivityAlertAfterSave } = await import("@/app/actions/kpi-productivity-alert");
        const r = await runKpiProductivityAlertAfterSave({ date: dateKey });
        if (!r.ok) console.warn("[KPI] productivity alert:", r.error);
      } catch (e) {
        console.warn("[KPI] productivity alert failed:", e);
      }
    })();
    void invokeKpiMissingNotifyThrottled();
  };

  const handleAdminSaveMemberKpi = async (memberId: string, savedDay: KpiRecord, newKpi: KpiRecord[]) => {
    const uid = (memberId ?? "").trim();
    if (!uid) return;
    try {
      await saveKpiForUser(uid, newKpi, { changeSource: "admin-dashboard-kpi" });
      const mergedUser = dedupeKpiRecordsByUserDate(newKpi.map((k) => ({ ...k, userId: uid })));
      setAllKpiRecords((prev) => [...prev.filter((k) => k.userId !== uid), ...mergedUser]);
      await refresh();
      setMemberDataToast({ message: "KPIを保存しました", isError: false });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMemberDataToast({
        message: msg.trim() !== "" ? msg : "保存に失敗しました。時間をおいて再度お試しください。",
        isError: true,
      });
      try {
        await refresh();
      } catch {
        /* ignore */
      }
      throw e;
    }
    const dateKey = savedDay.date;
    void (async () => {
      try {
        const { runKpiProductivityAlertAfterSave } = await import("@/app/actions/kpi-productivity-alert");
        const r = await runKpiProductivityAlertAfterSave({ date: dateKey });
        if (!r.ok) console.warn("[KPI] productivity alert:", r.error);
      } catch (e) {
        console.warn("[KPI] productivity alert failed:", e);
      }
    })();
    void invokeKpiMissingNotifyThrottled();
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    const user = await loginUser(loginAccount.trim(), loginPassword);
    if (user) {
      if ((user.loginAccount ?? "").toLowerCase() === "admin") {
        slackAdminAuthMemory.current = { loginId: loginAccount.trim(), password: loginPassword };
      } else {
        slackAdminAuthMemory.current = null;
      }
      const na = await signIn("credentials", {
        loginId: loginAccount.trim(),
        password: loginPassword,
        redirect: false,
      });
      setCurrentUserId(user.id);
      setLoginPassword("");
      if ((user.loginAccount ?? "").toLowerCase() !== "admin") setIsAdminMode(false);
      if (na?.error) {
        console.warn("NextAuth セッション作成に失敗（Slack送信などAPIで401になる可能性）:", na.error);
      }
    } else {
      setLoginError("ユーザー名またはパスワードが正しくありません。");
    }
  };

  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupName.trim() || !setupLogin.trim() || !setupPassword) {
      alert("名前・ユーザー名・パスワードを入力してください。");
      return;
    }
    try {
      const newMember = await addMember(setupName.trim(), {
        loginAccount: setupLogin.trim(),
        password: setupPassword,
        hourlyRate: setupHourlyRate >= 0 ? setupHourlyRate : DEFAULT_HOURLY_RATE,
      });
      const mems = await loadMembers();
      setMembers(mems ?? []);
      if (setupLogin.trim().toLowerCase() === "admin") {
        slackAdminAuthMemory.current = { loginId: setupLogin.trim(), password: setupPassword };
      }
      const na = await signIn("credentials", {
        loginId: setupLogin.trim(),
        password: setupPassword,
        redirect: false,
      });
      if (na?.error) {
        console.warn("NextAuth セッション作成に失敗:", na.error);
      }
      setCurrentUserId(newMember.id);
      setShowSetup(false);
      setSetupName("");
      setSetupLogin("");
      setSetupPassword("");
      setSetupHourlyRate(DEFAULT_HOURLY_RATE);
      await refresh();
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error("セットアップ（メンバー追加）エラー:", e);
      alert(`追加に失敗しました：${reason}`);
    }
  };

  const handleLogout = () => {
    slackAdminAuthMemory.current = null;
    void signOut({ redirect: false });
    setCurrentUserId(null);
    memberSelfBankProfileSeededForUserIdRef.current = null;
    setMemberSelfBankDraft({ ...EMPTY_MEMBER_SELF_BANK_DRAFT });
    setLoginAccount("");
    setLoginPassword("");
    setLoginError("");
  };

  const currentMember = members.find((m) => m.id === currentUserId);
  const isAdminUser = (currentMember?.loginAccount ?? "").toLowerCase() === "admin";
  const memberInternConfirmedReward =
    currentMember?.isIntern === true && currentUserId
      ? (() => {
          const totals = sumInternConfirmedAppsForMonth(allKpiRecords, currentUserId, currentYearMonth);
          const rates = getInternUnitRates(currentMember);
          const amount = calcMemberMonthlyPayYen(
            currentMember,
            0,
            allKpiRecords,
            currentYearMonth,
            DEFAULT_HOURLY_RATE
          );
          return { totals, rates, amount };
        })()
      : null;

  const handleSaveMemberSelfBankProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUserId || isAdminMode || isAdminUser) return;
    const zip = memberSelfBankDraft.postalCode.trim();
    const addr = memberSelfBankDraft.address.trim();
    const bank = memberSelfBankDraft.bankName.trim();
    const branch = memberSelfBankDraft.branchName.trim();
    const accNum = memberSelfBankDraft.accountNumber.trim();
    const accHolder = memberSelfBankDraft.accountHolder.trim();
    const phone = memberSelfBankDraft.phoneNumber.trim();
    const missing: string[] = [];
    if (!zip) missing.push("郵便番号");
    if (!addr) missing.push("住所");
    if (!bank) missing.push("銀行名");
    if (!branch) missing.push("支店名");
    if (!accNum) missing.push("口座番号");
    if (!accHolder) missing.push("口座名義");
    if (!phone) missing.push("電話番号");
    if (missing.length > 0) {
      alert(`振込先情報が未入力です。以下の項目を入力してください。\n\n${missing.join("、")}`);
      return;
    }
    const invRegCheck = validateQualifiedInvoiceRegistrationNumber(
      memberSelfBankDraft.invoiceRegistrationNumber
    );
    if (!invRegCheck.ok) {
      alert(invRegCheck.message);
      return;
    }
    setMemberSelfBankProfileBusy(true);
    setMemberDataToast(null);
    try {
      const res = await fetch("/api/member/bank-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          postalCode: zip,
          address: addr,
          bankName: bank,
          branchName: branch,
          accountType: memberSelfBankDraft.accountType.trim() || "普通",
          accountNumber: accNum,
          accountHolder: accHolder,
          phoneNumber: phone,
          invoiceRegistrationNumber: invRegCheck.value,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "保存に失敗しました");
      await refresh();
      setMemberDataToast({ message: "振込先・連絡先を保存しました", isError: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMemberDataToast({
        message: msg.trim() !== "" ? msg : "保存に失敗しました。時間をおいて再度お試しください。",
        isError: true,
      });
    } finally {
      setMemberSelfBankProfileBusy(false);
    }
  };

  if (!mounted) {
    return (
      <div
        style={{
          minHeight: "100vh",
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#94a3b8",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <p style={{ fontSize: "1.25rem", fontWeight: 700, color: "#0f172a", margin: 0 }}>読み込み中...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 max-w-md text-center">
          <h1 className="text-lg font-semibold text-amber-800 mb-2">接続エラー</h1>
          <p className="text-sm text-slate-700 mb-4">{loadError}</p>
          <p className="text-xs text-slate-500 mb-4">
            プロジェクトの <code className="bg-slate-200 px-1 rounded">supabase-schema.sql</code> を Supabase の SQL Editor で実行するとテーブルが作成されます。
          </p>
          <button type="button" onClick={() => void hydrate()} className="rounded bg-slate-700 px-4 py-2 text-sm text-white hover:bg-slate-600">
            再試行
          </button>
        </div>
      </div>
    );
  }

  if (showSetup) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-md">
          <h1 className="text-xl font-semibold text-slate-800 mb-1">初回セットアップ</h1>
          <p className="text-sm text-slate-500 mb-6">最初のユーザー（管理者）を登録してください。このアカウントでログインし、メンバーを追加できます。</p>
          <form onSubmit={handleSetupSubmit} className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-600">名前</label>
              <input type="text" value={setupName} onChange={(e) => setSetupName(e.target.value)} placeholder="表示名" className="rounded border border-slate-300 px-3 py-2 text-sm" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-600">ユーザー名（ログインID）</label>
              <input type="text" value={setupLogin} onChange={(e) => setSetupLogin(e.target.value)} placeholder="ログイン時に使用" className="rounded border border-slate-300 px-3 py-2 text-sm" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-600">パスワード</label>
              <input type="password" value={setupPassword} onChange={(e) => setSetupPassword(e.target.value)} placeholder="パスワード" className="rounded border border-slate-300 px-3 py-2 text-sm" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-600">委託料単価（円/時間）</label>
              <input type="number" min={0} value={setupHourlyRate} onChange={(e) => setSetupHourlyRate(parseInt(e.target.value, 10) || 0)} className="rounded border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <button type="submit" className="w-full rounded bg-slate-700 py-2.5 text-sm font-medium text-white hover:bg-slate-600">登録してログイン</button>
          </form>
        </div>
      </div>
    );
  }

  if (currentUserId === null) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-md">
          <h1 className="text-xl font-semibold text-slate-800 mb-1">ログイン</h1>
          <p className="text-sm text-slate-500 mb-6">ユーザー名とパスワードを入力してください。</p>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-600">ユーザー名</label>
              <input type="text" value={loginAccount} onChange={(e) => setLoginAccount(e.target.value)} placeholder="ユーザー名" className="rounded border border-slate-300 px-3 py-2 text-sm" autoComplete="username" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-600">パスワード</label>
              <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="パスワード" className="rounded border border-slate-300 px-3 py-2 text-sm" autoComplete="current-password" />
            </div>
            {loginError && <p className="text-sm text-red-600">{loginError}</p>}
            <button type="submit" className="w-full rounded bg-slate-700 py-2.5 text-sm font-medium text-white hover:bg-slate-600">ログイン</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100" style={{ minHeight: "100vh", backgroundColor: "#f1f5f9" }}>
      {punchCompleteFlash && (
        <div
          role="alert"
          aria-live="assertive"
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-emerald-950/92 px-6 text-center print:hidden"
        >
          <p className="text-balance text-2xl font-bold leading-snug text-white sm:text-3xl md:text-4xl">
            お疲れ様でした！打刻を完了しました
          </p>
        </div>
      )}
      {punchToast && (
        <div
          role="status"
          className={`fixed left-1/2 top-4 z-[100] max-w-[min(92vw,26rem)] -translate-x-1/2 text-center shadow-lg print:hidden ${
            punchToast.isError
              ? "rounded-lg bg-red-700 px-4 py-3 text-sm font-semibold text-white"
              : punchToast.prominent
                ? "rounded-xl bg-emerald-700 px-6 py-4 text-lg font-bold tracking-tight text-white ring-2 ring-emerald-400/60"
                : "rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-medium text-white"
          }`}
        >
          {punchToast.message}
        </div>
      )}
      {memberDataToast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed left-1/2 z-[99] max-w-[min(92vw,26rem)] -translate-x-1/2 text-center shadow-lg print:hidden ${
            punchToast ? "top-[4.5rem]" : "top-4"
          } ${memberDataToast.isError ? "rounded-lg bg-red-700 px-4 py-3 text-sm font-semibold text-white" : "rounded-lg bg-slate-800 px-4 py-3 text-sm font-semibold text-white"}`}
        >
          {memberDataToast.message}
        </div>
      )}
      {showEndWithoutStartModal && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4 print:hidden"
          onClick={() => {
            if (!endModalSubmitting) {
              setShowEndWithoutStartModal(false);
              setPunchSubmitPhase("idle");
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-base font-semibold text-slate-800">開始時間の確認</h3>
            <p className="mb-4 text-sm text-slate-600">
              稼働開始の打刻がありません。開始時間を入力するか、現在の時刻を開始としてこのまま終了を記録できます。
            </p>
            <div className="mb-4 flex flex-col gap-2">
              <label className="text-xs font-medium text-slate-600">開始時刻（本日・日本時間）</label>
              <input
                type="time"
                value={manualStartTimeHhmm}
                onChange={(e) => setManualStartTimeHhmm(e.target.value)}
                disabled={endModalSubmitting}
                className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-800"
                step={60}
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                disabled={endModalSubmitting}
                onClick={() => void submitEndWithoutOpenRecord("manual")}
                className="rounded-lg bg-slate-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {endModalSubmitting ? "送信中..." : "入力した時刻で記録"}
              </button>
              <button
                type="button"
                disabled={endModalSubmitting}
                onClick={() => void submitEndWithoutOpenRecord("now")}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                現在の時刻を開始とする
              </button>
              <button
                type="button"
                disabled={endModalSubmitting}
                onClick={() => {
                  setShowEndWithoutStartModal(false);
                  setPunchSubmitPhase("idle");
                }}
                className="rounded-lg px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
      <header className="bg-slate-800 text-white shadow-md print:hidden" style={{ backgroundColor: "#1e293b" }}>
        <div className="mx-auto max-w-2xl px-4 py-4 sm:px-6">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {isAdminMode ? "業務進捗・活動報告（管理者）" : `業務進捗・活動報告${currentMember ? ` - ${currentMember.name}` : ""}`}
          </h1>
        </div>
      </header>

      {!isAdminMode && (
        <div className="border-b border-slate-200 bg-white print:hidden">
          <div className="mx-auto flex max-w-2xl gap-0">
            <button
              type="button"
              disabled={punchFlowBusy}
              onClick={() => !punchFlowBusy && setTab("home")}
              className={`flex-1 px-3 py-3 text-sm font-medium transition sm:px-4 disabled:cursor-not-allowed disabled:opacity-40 ${tab === "home" ? "border-b-2 border-slate-700 text-slate-800" : "text-slate-500 hover:text-slate-700"}`}
            >
              活動記録
            </button>
            <button
              type="button"
              disabled={punchFlowBusy}
              onClick={() => !punchFlowBusy && setTab("shift")}
              className={`flex-1 px-3 py-3 text-sm font-medium transition sm:px-4 disabled:cursor-not-allowed disabled:opacity-40 ${tab === "shift" ? "border-b-2 border-slate-700 text-slate-800" : "text-slate-500 hover:text-slate-700"}`}
            >
              稼働予定
            </button>
            <button
              type="button"
              disabled={punchFlowBusy}
              onClick={() => !punchFlowBusy && setTab("kpi")}
              className={`flex-1 px-3 py-3 text-sm font-medium transition sm:px-4 disabled:cursor-not-allowed disabled:opacity-40 ${tab === "kpi" ? "border-b-2 border-slate-700 text-slate-800" : "text-slate-500 hover:text-slate-700"}`}
            >
              KPI入力
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8 print:mx-0 print:max-w-none print:w-full print:px-3 print:py-2">
        {isAdminMode && isAdminUser ? (
          <AdminDashboard
            isAdminUser={isAdminUser}
            adminLoginAccount={currentMember?.loginAccount?.trim() ?? ""}
            allRecords={allRecords}
            allOpenRecords={allOpenRecords}
            allShifts={allShifts}
            allKpiRecords={allKpiRecords}
            members={members}
            setMembers={setMembers}
            onRefresh={refresh}
            deepLinkMemberId={adminEditMemberFromUrl}
            onAdminDeepLinkConsumed={clearAdminEditDeepLink}
            onSaveMemberRecords={async (memberId, records) => {
              await saveRecordsForUser(memberId, records, {
                bypassPunchTimeRestrictions: true,
                bypassWorkDurationSanity: true,
              });
              await refresh();
            }}
            onSaveMemberShifts={async (memberId, shifts) => {
              const normalized = shifts.map((s) => {
                if (!isWeekendYmd(s.date)) return s;
                return {
                  ...s,
                  startPlanned: SHIFT_ENTRY_NONE,
                  endPlanned: SHIFT_ENTRY_NONE,
                  startPlanned2: undefined,
                  endPlanned2: undefined,
                };
              });
              const res = await fetch("/api/schedule", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ shifts: shiftsToScheduleApiJson(normalized), userId: memberId }),
              });
              const data = (await res.json().catch(() => ({}))) as { error?: string };
              if (!res.ok) {
                alert(typeof data.error === "string" ? data.error : "稼働予定の保存に失敗しました");
                return;
              }
              await refresh();
            }}
            onSaveMemberKpi={handleAdminSaveMemberKpi}
            planActualGapApprovedKeys={planActualGapApprovedKeys}
            planActualGapResolutionByKey={planActualGapResolutionByKey}
            onResolvePlanActualGap={async (userId, date, mode) => {
              const result = await applyPlanActualGapResolve(userId, date, mode);
              if (!result.ok) {
                alert(result.error ?? "処理に失敗しました");
                return;
              }
              await refresh();
            }}
            onApplyManualPlanActualGap={
              isAdminUser
                ? async (userId, date, input) => {
                    const result = await applyPlanActualGapManualOverride(userId, date, input, {
                      adminUserId: currentUserId,
                    });
                    if (!result.ok) {
                      throw new Error(result.error ?? "処理に失敗しました");
                    }
                    const gapKey = planActualGapApprovalKey(userId, date);
                    setPlanActualGapApprovedKeys((prev) => new Set(prev).add(gapKey));
                    setPlanActualGapResolutionByKey((prev) => {
                      const next = new Map(prev);
                      next.set(gapKey, "manual");
                      return next;
                    });
                    await refresh();
                  }
                : undefined
            }
          />
        ) : tab === "home" ? (
          <>
            <ShiftDeadlineCountdown todayJstYmd={getTodayJstDateString()} />
            {!memberHasEntryForTargetWeek && (
              <section className="mb-6 rounded-xl border-2 border-amber-400 bg-amber-50 p-5 shadow-md">
                <h2 className="mb-2 text-base font-bold text-amber-900">次週の稼働予定が登録されていません</h2>
                <p className="mb-4 text-sm text-amber-800">来週分は前週の日曜 23:59（日本時間）までに、稼働予定（エントリー）を登録してください。「稼働予定」タブから登録できます。</p>
                <button
                  type="button"
                  disabled={punchFlowBusy}
                  onClick={() => !punchFlowBusy && setTab("shift")}
                  className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  稼働予定を登録する
                </button>
              </section>
            )}
            <section className="mb-6 rounded-xl bg-slate-800 p-6 text-white shadow-md sm:mb-8">
              <h2 className="mb-1 text-sm font-medium text-slate-300">当日の活動時間</h2>
              <p className="text-3xl font-bold sm:text-4xl">{formatDuration(todayMinutes)}</p>
            </section>

            <section className="mb-6 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80 sm:mb-8 sm:p-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-slate-600">{isCurrentMonth ? "今月の活動時間" : "選択月の活動時間"}</h2>
                <select
                  value={currentYearMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500/20"
                >
                  {selectableMonths.map((ym) => {
                    const [y, m] = ym.split("-");
                    const label =
                      ym === `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}` ? `${y}年${m}月（今月）` : `${y}年${m}月`;
                    return (
                      <option key={ym} value={ym}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>
              <p className="text-2xl font-bold text-slate-800 sm:text-3xl">{formatDuration(totalMinutes)}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMemberReportMonth(getLastMonthString());
                    setShowMemberReportModal(true);
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  PDFダウンロード（請求書・実績レポート）
                </button>
              </div>
            </section>

            {memberInternConfirmedReward != null ? (
              <section className="mb-6 rounded-xl border-2 border-violet-200 bg-violet-50 p-5 shadow-sm sm:mb-8 sm:p-6">
                <h2 className="text-sm font-medium text-violet-900">
                  {isCurrentMonth ? "今月の確定報酬額" : "選択月の確定報酬額"}
                  <span className="ml-1 font-normal text-violet-700">（管理者承認済み合計）</span>
                </h2>
                <p className="mt-2 text-2xl font-bold text-violet-950 sm:text-3xl">
                  ¥{memberInternConfirmedReward.amount.toLocaleString()}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-violet-800">
                  決裁者商談 {memberInternConfirmedReward.totals.decisionCount}件 × ¥
                  {memberInternConfirmedReward.rates.decisionMaker.toLocaleString()}
                  {" ／ "}
                  非決裁者商談 {memberInternConfirmedReward.totals.nonDecisionCount}件 × ¥
                  {memberInternConfirmedReward.rates.nonDecisionMaker.toLocaleString()}
                </p>
              </section>
            ) : null}

            {currentMember && !isAdminUser ? (
              <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-slate-200/80 sm:mb-8 sm:p-6">
                <h2 className="mb-1 text-sm font-semibold text-slate-800">振込先・インボイス設定</h2>
                <p className="mb-4 text-xs leading-relaxed text-slate-600">
                  経理・請求書に印字される情報です。
                  <span className="font-medium text-slate-700">請求管理番号（3桁）</span>
                  は管理者が付与するため、ここでは変更できません（表示のみ）。
                </p>
                <form onSubmit={(e) => void handleSaveMemberSelfBankProfile(e)} className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="mb-0.5 block text-xs font-medium text-slate-600">請求管理番号（3桁）</label>
                      <input
                        type="text"
                        readOnly
                        disabled
                        tabIndex={-1}
                        aria-readonly="true"
                        value={
                          formatMemberInvoiceNumberThreeDigits(currentMember.invoiceNumber) ??
                          "未設定（管理者が登録します）"
                        }
                        className="w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700"
                      />
                      <p className="mt-1 text-[11px] text-slate-500">管理者のみ変更できます。保存時に送信されません。</p>
                    </div>
                    <div>
                      <label className="mb-0.5 block text-xs font-medium text-slate-600">郵便番号</label>
                      <input
                        type="text"
                        value={memberSelfBankDraft.postalCode}
                        onChange={(e) => setMemberSelfBankDraft((d) => ({ ...d, postalCode: e.target.value }))}
                        placeholder="例: 100-0001"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-0.5 block text-xs font-medium text-slate-600">住所</label>
                      <input
                        type="text"
                        value={memberSelfBankDraft.address}
                        onChange={(e) => setMemberSelfBankDraft((d) => ({ ...d, address: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-xs font-medium text-slate-600">銀行名</label>
                      <input
                        type="text"
                        value={memberSelfBankDraft.bankName}
                        onChange={(e) => setMemberSelfBankDraft((d) => ({ ...d, bankName: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-xs font-medium text-slate-600">支店名</label>
                      <input
                        type="text"
                        value={memberSelfBankDraft.branchName}
                        onChange={(e) => setMemberSelfBankDraft((d) => ({ ...d, branchName: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-xs font-medium text-slate-600">口座種別</label>
                      <select
                        value={memberSelfBankDraft.accountType}
                        onChange={(e) => setMemberSelfBankDraft((d) => ({ ...d, accountType: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                      >
                        <option value="普通">普通</option>
                        <option value="当座">当座</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-0.5 block text-xs font-medium text-slate-600">口座番号</label>
                      <input
                        type="text"
                        value={memberSelfBankDraft.accountNumber}
                        onChange={(e) => setMemberSelfBankDraft((d) => ({ ...d, accountNumber: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-0.5 block text-xs font-medium text-slate-600">口座名義</label>
                      <input
                        type="text"
                        value={memberSelfBankDraft.accountHolder}
                        onChange={(e) => setMemberSelfBankDraft((d) => ({ ...d, accountHolder: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-0.5 block text-xs font-medium text-slate-600">電話番号</label>
                      <input
                        type="text"
                        value={memberSelfBankDraft.phoneNumber}
                        onChange={(e) => setMemberSelfBankDraft((d) => ({ ...d, phoneNumber: e.target.value }))}
                        placeholder="03-1234-5678"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-0.5 block text-xs font-medium text-slate-600">
                        適格請求書発行事業者登録番号
                      </label>
                      <input
                        type="text"
                        value={memberSelfBankDraft.invoiceRegistrationNumber}
                        onChange={(e) =>
                          setMemberSelfBankDraft((d) => ({
                            ...d,
                            invoiceRegistrationNumber: sanitizeInvoiceRegistrationInput(e.target.value),
                          }))
                        }
                        placeholder="T1234567890123"
                        maxLength={14}
                        className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono text-slate-800"
                      />
                      <p className="mt-1 text-[11px] text-slate-500">
                        任意。T + 13桁（例: T1234567890123）。登録すると請求書のお振込先欄に表示されます。
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="submit"
                      disabled={memberSelfBankProfileBusy}
                      className="rounded-lg bg-slate-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {memberSelfBankProfileBusy ? "保存中…" : "保存する"}
                    </button>
                  </div>
                </form>
              </section>
            ) : null}

            <section className="mb-6 sm:mb-8">
              <h2 className="mb-3 text-center text-sm font-semibold uppercase tracking-wide text-slate-500">打刻</h2>
              {memberPunchContext && (
                <div
                  className={`mb-4 rounded-2xl border-2 px-4 py-4 text-center sm:py-5 ${
                    openRecord
                      ? "border-amber-500 bg-amber-300 text-slate-900 shadow-md"
                      : "border-slate-300 bg-slate-200 text-slate-800 shadow-sm"
                  }`}
                >
                  <p className="text-lg font-bold leading-snug sm:text-xl md:text-2xl">
                    {openRecord ? (
                      <>
                        現在<span className="mx-1 text-red-700">【稼働中】</span>です
                        <span className="mt-1 block text-base font-semibold sm:text-lg">
                          （{formatTime(openRecord.startRounded)}に開始済み）
                        </span>
                      </>
                    ) : (
                      <>現在は<span className="mx-1">【未稼働】</span>です</>
                    )}
                  </p>
                </div>
              )}
              <div className="flex w-full flex-col gap-4">
                <div className="flex w-full flex-col gap-1">
                  <button
                    type="button"
                    onClick={handleStart}
                    title={
                      !memberPunchContext
                        ? undefined
                        : punchBlockedJstWeekend
                          ? JST_WEEKEND_WORK_REJECTED_MESSAGE
                          : !punchWindowOkJst
                            ? PUNCH_OUTSIDE_WINDOW_MESSAGE
                            : !punchStartAllowedByPlan
                              ? punchStartPlanBlockReason === "late"
                                ? PUNCH_START_AFTER_PLANNED_MESSAGE
                                : PUNCH_START_BEFORE_PLANNED_MESSAGE
                              : undefined
                    }
                    disabled={punchStartDisabled}
                    className={`w-full min-h-[5.5rem] rounded-2xl px-4 py-7 text-xl font-bold shadow-xl transition active:scale-[0.99] sm:min-h-[6.5rem] sm:py-9 sm:text-2xl ${
                      punchStartDisabled
                        ? "cursor-not-allowed bg-slate-300 text-slate-500"
                        : "bg-gradient-to-b from-sky-500 to-blue-700 text-white ring-4 ring-blue-400/40 hover:from-sky-400 hover:to-blue-600"
                    }`}
                  >
                    {punchSubmitPhase === "start_sending"
                      ? "送信中…"
                      : punchSubmitPhase === "start_done"
                        ? "打刻完了"
                        : punchSubmitPhase === "end_sending" ||
                            punchSubmitPhase === "end_done" ||
                            punchSubmitPhase === "end_modal_open"
                          ? "処理中…"
                          : "業務開始"}
                  </button>
                  {memberPunchContext &&
                    !openRecord &&
                    !punchFlowBusy &&
                    !punchBlockedJstWeekend &&
                    punchWindowOkJst &&
                    !punchStartAllowedByPlan && (
                      <p className="text-center text-[11px] leading-snug text-slate-500 sm:text-xs">
                        {punchStartPlanBlockReason === "late"
                          ? PUNCH_START_AFTER_PLANNED_MESSAGE
                          : "稼働開始は予定時刻の1時間前〜1時間後に打刻可能です"}
                      </p>
                    )}
                </div>
                <button
                  type="button"
                  onClick={handleEndClick}
                  title={
                    !memberPunchContext
                      ? undefined
                      : openRecord && isWeekendYmdJst(openRecord.date)
                        ? JST_WEEKEND_WORK_REJECTED_MESSAGE
                        : !punchWindowOkJst && !!openRecord
                          ? PUNCH_OUTSIDE_WINDOW_MESSAGE
                          : openRecord && endPunchLockedPastPlan
                            ? PUNCH_DEADLINE_PASSED_MESSAGE
                            : undefined
                  }
                  disabled={punchEndDisabled}
                  className={`w-full min-h-[5.5rem] rounded-2xl px-4 py-6 text-center font-bold shadow-xl transition active:scale-[0.99] sm:min-h-[6.5rem] sm:py-8 ${
                    punchEndDisabled
                      ? "cursor-not-allowed bg-slate-300 text-slate-500"
                      : openRecord
                        ? "bg-gradient-to-b from-orange-500 to-red-600 text-white ring-4 ring-orange-400/45 hover:from-orange-400 hover:to-red-500"
                        : "bg-gradient-to-b from-slate-600 to-slate-800 text-white ring-4 ring-slate-400/30 hover:from-slate-500 hover:to-slate-700"
                  }`}
                >
                  {punchSubmitPhase === "end_sending" ? (
                    <span className="text-xl sm:text-2xl">送信中…</span>
                  ) : punchSubmitPhase === "end_done" ? (
                    <span className="text-xl sm:text-2xl">打刻完了</span>
                  ) : punchSubmitPhase === "start_sending" || punchSubmitPhase === "start_done" ? (
                    <span className="text-xl sm:text-2xl">処理中…</span>
                  ) : punchSubmitPhase === "end_modal_open" ? (
                    <span className="flex flex-col items-center gap-2 px-1">
                      <span className="text-xl leading-tight sm:text-2xl">処理中…</span>
                      <span className="max-w-md text-balance text-sm font-semibold leading-snug text-amber-100 sm:text-base">
                        入力画面を表示しています
                      </span>
                    </span>
                  ) : openRecord ? (
                    <span className="text-xl sm:text-2xl">業務終了</span>
                  ) : (
                    <span className="flex flex-col items-center gap-2 px-1">
                      <span className="text-xl leading-tight sm:text-2xl">業務終了</span>
                      <span className="max-w-md text-balance text-base font-semibold leading-snug text-amber-100 sm:text-lg">
                        開始時間を入力して終了報告へ
                      </span>
                    </span>
                  )}
                </button>
              </div>
              {punchBlockedJstWeekend && (
                <p className="mt-3 text-center text-sm font-medium text-amber-800">{JST_WEEKEND_WORK_REJECTED_MESSAGE}</p>
              )}
              {memberPunchContext && !punchBlockedJstWeekend && !punchWindowOkJst && (
                <p className="mt-3 text-center text-sm font-medium text-amber-800">{PUNCH_OUTSIDE_WINDOW_MESSAGE}</p>
              )}
              {memberPunchContext &&
                openRecord &&
                !isWeekendYmdJst(openRecord.date) &&
                punchWindowOkJst &&
                endPunchLockedPastPlan && (
                  <p className="mt-3 text-center text-sm font-medium text-amber-800">{PUNCH_DEADLINE_PASSED_MESSAGE}</p>
                )}
              <p className="mt-3 text-center text-xs text-slate-500">KPI入力は「KPI入力」タブからいつでも行えます</p>
            </section>

            <HistorySection
              monthRecords={monthRecords}
              monthShifts={monthShifts}
              monthKpi={monthKpi}
              currentYearMonth={currentYearMonth}
              isCurrentMonth={isCurrentMonth}
            />
          </>
        ) : tab === "shift" ? (
          <ShiftTab
            userId={currentUserId ?? ""}
            shifts={shifts}
            onSave={handleSaveShifts}
            todayJstYmd={getTodayJstDateString()}
            guardWorkRecords={records}
            guardKpiRecords={kpiRecords}
            isAdminUser={isAdminUser}
            restrictMorningStart={!isAdminUser && currentMember?.canWorkMorning !== true}
          />
        ) : (
          <KpiTab userId={currentUserId} kpiRecords={kpiRecords} currentYearMonth={currentYearMonth} isIntern={currentMember?.isIntern === true} onSave={handleSaveKpi} />
        )}
      </main>

      <div className="fixed bottom-4 right-4 z-10 flex flex-col gap-2 rounded-xl border border-slate-300 bg-white p-3 shadow-lg print:hidden">
        {isAdminUser ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-600">{isAdminMode ? "管理者（Admin）" : "一般メンバー"}</span>
            <button
              type="button"
              onClick={() => setIsAdminMode(!isAdminMode)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${isAdminMode ? "bg-slate-700" : "bg-slate-300"}`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${isAdminMode ? "translate-x-5" : "translate-x-1"}`} />
            </button>
          </div>
        ) : (
          <p className="text-xs text-slate-500">{currentMember?.name ?? ""}</p>
        )}
        <button type="button" onClick={handleLogout} className="rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
          ログアウト
        </button>
      </div>

      {showMemberReportModal && currentMember && (() => {
        const maxMemberMonth = getLastMonthString();
        const effectiveMemberMonth = (memberReportMonth || maxMemberMonth) > maxMemberMonth ? maxMemberMonth : (memberReportMonth || maxMemberMonth);
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowMemberReportModal(false)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-auto rounded-xl border border-slate-200 bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-sm font-semibold text-slate-800">PDFダウンロード（請求書・実績レポート）</h3>
            <p className="mb-2 text-xs text-slate-600">
              ご自身のデータのみ出力できます。請求書（1枚目）と業務遂行実績報告書（2枚目以降）を1つのPDFでダウンロードします（経理提出用PDFと同一形式）。
            </p>
            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium text-slate-600">対象月</label>
              <input
                type="month"
                max={maxMemberMonth}
                value={effectiveMemberMonth}
                onChange={(e) => setMemberReportMonth(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-800"
              />
              <p className="mt-1.5 text-xs text-slate-500">前月分の実績は翌月1日から出力可能になります。</p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    setMemberDataToast(null);
                    try {
                      const blob = await renderMemberCombinedPdfBlob(
                        currentMember,
                        effectiveMemberMonth,
                        allRecords,
                        allKpiRecords
                      );
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = buildInvoiceCombinedPdfFileName(currentMember, effectiveMemberMonth);
                      a.click();
                      URL.revokeObjectURL(url);
                      setShowMemberReportModal(false);
                    } catch (e) {
                      setMemberDataToast({
                        message: e instanceof Error ? e.message : String(e),
                        isError: true,
                      });
                    }
                  })();
                }}
                className="rounded bg-slate-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-600"
              >
                PDFをダウンロード（請求書・実績レポート）
              </button>
              <button
                type="button"
                onClick={() => setShowMemberReportModal(false)}
                className="rounded border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
