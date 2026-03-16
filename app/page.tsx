"use client";

import { useEffect, useState, useCallback } from "react";
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
  get15MinOptions,
  getShiftPlannedMinutes,
  timeToMinutes,
  getWeekStart,
  getWeekDates,
  getTargetWeekStart,
  getDeadlineForWeek,
  getShiftsByDateForWeek,
  getKpiRates,
  safeRatePercent,
  getTotalMinutesForMonthByUser,
  calcMonthlyPay,
} from "@/lib/attendance";
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
  saveShiftsForUser,
  saveKpiForUser,
  loginUser,
  loadDeviationApprovals,
  saveDeviationApproval,
  exportAllDataFromSupabase,
  importAllDataToSupabase,
} from "@/lib/supabase-data";

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

/** 請求書No.を [西暦4桁][月2桁][請求管理番号3桁] で生成（例: 202603001）。管理番号は0埋め */
function getInvoiceNumber(yearMonth: string, managementNumber: string | null | undefined): string {
  const [y, m] = yearMonth.split("-");
  const year = (y ?? "").slice(0, 4);
  const month = (m ?? "").padStart(2, "0");
  const num = String(managementNumber ?? "0").replace(/\D/g, "").slice(-3);
  const padded = num.padStart(3, "0");
  return `${year}${month}${padded}`;
}

/** 対象月の翌月15日を支払期限として返す（例: 2026-03 → 2026/04/15） */
function getPaymentDueDate(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const next = new Date(y, m, 15);
  const yy = next.getFullYear();
  const mm = String(next.getMonth() + 1).padStart(2, "0");
  const dd = String(next.getDate()).padStart(2, "0");
  return `${yy}/${mm}/${dd}`;
}

/** 請求書用：委託料単価を税込として合計→小計・消費税を逆算（雛形に合わせた端数処理） */
function calcInvoiceAmounts(totalMinutes: number, hourlyRateTaxInclusive: number): { totalWithTax: number; subtotal: number; taxRate: number } {
  const totalWithTax = Math.round((totalMinutes / 60) * hourlyRateTaxInclusive);
  const subtotal = Math.floor(totalWithTax / 1.1);
  const taxRate = totalWithTax - subtotal;
  return { totalWithTax, subtotal, taxRate };
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
  const [y, m, d] = dateStr.split("-").map(Number);
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const startDate = new Date(y, m - 1, d, sh, sm);
  const endDate = new Date(y, m - 1, d, eh, em);
  if (endDate.getTime() <= startDate.getTime()) return null;
  const startRounded = roundUpTo15Minutes(startDate);
  const endRounded = roundDownTo15Minutes(endDate);
  const durationMinutes = calcDurationMinutes(startRounded, endRounded);
  if (durationMinutes <= 0) return null;
  return {
    id: id ?? crypto.randomUUID(),
    userId,
    startRaw: startRounded.toISOString(),
    startRounded: startRounded.toISOString(),
    endRaw: endRounded.toISOString(),
    endRounded: endRounded.toISOString(),
    date: dateStr,
    durationMinutes,
    ...(isAutoCompleted === true && { isAutoCompleted: true }),
  };
}

/** ISO 時刻文字列から "HH:mm" を取得（編集フォーム用） */
function getTimeFromIso(iso: string): string {
  if (!iso) return "09:00";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 指定日に稼働予定が入っているメンバーIDの集合 */
function getMemberIdsWithShiftOnDate(shifts: Shift[], dateStr: string): Set<string> {
  const ids = new Set<string>();
  shifts.filter((s) => s.date === dateStr).forEach((s) => ids.add(s.userId));
  return ids;
}

/** 前日以前の「業務開始のみ」記録を稼働予定終了時刻で自動補完（日付変更時・起動時に実行） */
async function runAutoComplete(): Promise<void> {
  const [records, openRecs, shifts] = await Promise.all([loadRecords(), loadOpenRecords(), loadShifts()]);
  const todayStr = toDateString(new Date());
  const openPast = openRecs.filter((o) => o.date < todayStr);
  if (openPast.length === 0) return;
  const newRecords: WorkRecord[] = [];
  for (const o of openPast) {
    const shift = shifts.find((s) => s.userId === o.userId && s.date === o.date);
    const startHhmm = getTimeFromIso(o.startRounded);
    let endTime: string;
    if (shift) {
      const startMins = timeToMinutes(startHhmm);
      const plan1 = timeToMinutes(shift.startPlanned);
      const plan2 = shift.startPlanned2 != null ? timeToMinutes(shift.startPlanned2) : null;
      if (plan2 != null && Math.abs(startMins - plan2) < Math.abs(startMins - plan1)) endTime = shift.endPlanned2 ?? shift.endPlanned;
      else endTime = shift.endPlanned;
    } else {
      endTime = "23:59";
    }
    const built = buildWorkRecordFromTimes(o.date, startHhmm, endTime, o.userId, o.id, true);
    if (built) newRecords.push(built);
  }
  if (newRecords.length === 0) return;
  const updatedRecords = [...records, ...newRecords];
  const completedIds = new Set(openPast.map((x) => x.id));
  const updatedOpen = openRecs.filter((r) => !completedIds.has(r.id));
  await saveRecords(updatedRecords);
  await saveOpenRecords(updatedOpen);
}

/** 1件の活動記録と稼働予定スロットから乖離情報を算出（15分以上で乖離）。スロットは { start, end } の配列 */
function getDeviationLabel(
  record: WorkRecord,
  slots: { start: string; end: string }[],
  memberName: string
): { label: string; startDiff: number; endDiff: number } | null {
  if (slots.length === 0) return null;
  const actualStart = timeToMinutes(getTimeFromIso(record.startRounded));
  const actualEnd = timeToMinutes(getTimeFromIso(record.endRounded));
  let bestSlot = slots[0];
  let bestDist = Math.abs(actualStart - timeToMinutes(slots[0].start));
  for (let i = 1; i < slots.length; i++) {
    const d = Math.abs(actualStart - timeToMinutes(slots[i].start));
    if (d < bestDist) {
      bestDist = d;
      bestSlot = slots[i];
    }
  }
  const startDiff = actualStart - timeToMinutes(bestSlot.start);
  const endDiff = actualEnd - timeToMinutes(bestSlot.end);
  if (Math.abs(startDiff) < 15 && Math.abs(endDiff) < 15) return null;
  const planned = `${bestSlot.start}-${bestSlot.end}`;
  const actual = `${getTimeFromIso(record.startRounded)}-${getTimeFromIso(record.endRounded)}`;
  let suffix = "";
  if (Math.abs(endDiff) >= 15) suffix = endDiff > 0 ? `${endDiff}分超過` : `${-endDiff}分早く終了`;
  else if (Math.abs(startDiff) >= 15) suffix = startDiff > 0 ? `開始${startDiff}分遅れ` : `開始${-startDiff}分早い`;
  const label = `[${memberName}] 予定：${planned} / 実績：${actual} (${suffix})`;
  return { label, startDiff, endDiff };
}

/** 稼働分数から時間表示（数量用・整数なら整数、それ以外は小数1桁） */
function formatHoursForInvoice(totalMinutes: number): string {
  const h = totalMinutes / 60;
  return h % 1 === 0 ? String(h) : h.toFixed(1);
}

/** 請求書の本文HTML（雛形準拠：合計強調・明細テーブル・宛名左上・差出人右上黄色） */
function buildInvoiceBody(
  memberName: string,
  yearMonth: string,
  totalMinutes: number,
  hourlyRateTaxInclusive: number,
  subtotal: number,
  taxRate: number,
  totalWithTax: number,
  invoiceNo: string,
  paymentDueDate: string,
  postalCode: string,
  address: string,
  phoneNumber: string,
  bankName: string,
  branchName: string,
  accountType: string,
  accountNumber: string,
  accountHolder: string
): string {
  const [y, m] = yearMonth.split("-");
  const monthLabel = `${y}年${m}月`;
  const lastDay = new Date(Number(y), Number(m), 0).getDate();
  const periodLabel = `${y}年${m}月1日 ～ ${y}年${m}月${lastDay}日`;
  const hoursLabel = formatHoursForInvoice(totalMinutes);
  return `
  <div class="invoice-sheet">
    <div class="invoice-header-row">
      <div class="invoice-addressee">株式会社RIM 御中</div>
      <div class="invoice-sender-block">
        <div class="sender-line">${postalCode ? `〒${postalCode}` : ""} ${address || ""}</div>
        <div class="sender-line sender-name">${memberName}</div>
        <div class="sender-line">${phoneNumber ? `TEL: ${phoneNumber}` : ""}</div>
      </div>
    </div>
    <h1 class="invoice-title">請求書</h1>
    <div class="invoice-total-bar">
      <span class="invoice-total-label">合計</span>
      <span class="invoice-total-amount">${totalWithTax.toLocaleString()} 円 (税込)</span>
    </div>
    <table class="invoice-info-table">
      <tr><th>請求書No.</th><td>${invoiceNo}</td><th>件名</th><td>${monthLabel}分の業務委託の請求書</td></tr>
      <tr><th>請求期間</th><td colspan="3">${periodLabel}</td></tr>
      <tr><th>支払期限</th><td colspan="3">${paymentDueDate}</td></tr>
    </table>
    <table class="invoice-detail-table">
      <thead>
        <tr>
          <th>摘要</th><th>数量</th><th>単位</th><th>単価</th><th>消費税</th><th>金額(税抜)</th><th>金額(税込)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${monthLabel}分 業務委託</td>
          <td class="number">${hoursLabel}</td>
          <td>時間</td>
          <td class="number">¥${hourlyRateTaxInclusive.toLocaleString()}</td>
          <td class="number">¥${taxRate.toLocaleString()}</td>
          <td class="number">¥${subtotal.toLocaleString()}</td>
          <td class="number">¥${totalWithTax.toLocaleString()}</td>
        </tr>
        <tr class="invoice-detail-subtotal">
          <td>小計</td>
          <td></td><td></td><td></td>
          <td class="number">¥${taxRate.toLocaleString()}</td>
          <td class="number">¥${subtotal.toLocaleString()}</td>
          <td class="number">¥${totalWithTax.toLocaleString()}</td>
        </tr>
      </tbody>
    </table>
    <div class="invoice-summary-block">
      <div class="invoice-summary-row"><span class="invoice-summary-label">小計（税抜）</span><span class="invoice-summary-value">¥${subtotal.toLocaleString()}</span></div>
      <div class="invoice-summary-row"><span class="invoice-summary-label">消費税（10%）</span><span class="invoice-summary-value">¥${taxRate.toLocaleString()}</span></div>
      <div class="invoice-summary-row invoice-summary-total"><span class="invoice-summary-label">合計（税込）</span><span class="invoice-summary-value">¥${totalWithTax.toLocaleString()}</span></div>
    </div>
    <div class="invoice-section">
      <div class="invoice-section-title">お振込先</div>
      <div class="bank-block">
        <div>${postalCode ? `〒${postalCode}` : ""} ${address || "（未登録）"}</div>
        <div>${bankName || "（未登録）"} ${branchName ? ` ${branchName}` : ""} ${accountType || ""} ${accountNumber || ""}</div>
        <div>口座名義: ${accountHolder || "（未登録）"}</div>
      </div>
    </div>
  </div>`;
}

/** 請求書単体のHTML（従来互換・1枚用） */
function buildInvoiceHtml(
  memberName: string,
  yearMonth: string,
  totalMinutes: number,
  hourlyRate: number,
  subtotal: number,
  taxRate: number,
  totalWithTax: number,
  invoiceNo: string,
  paymentDueDate: string,
  postalCode: string,
  address: string,
  bankName: string,
  branchName: string,
  accountType: string,
  accountNumber: string,
  accountHolder: string,
  phoneNumber?: string
): string {
  const body = buildInvoiceBody(memberName, yearMonth, totalMinutes, hourlyRate, subtotal, taxRate, totalWithTax, invoiceNo, paymentDueDate, postalCode, address, phoneNumber ?? "", bankName, branchName, accountType, accountNumber, accountHolder);
  const style = `@page{size:A4;margin:16mm}body{margin:0;padding:0;font-family:Hiragino Sans,Meiryo,sans-serif;font-size:10pt;color:#1e293b}
.invoice-sheet{padding:16px}.invoice-header-row{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px}
.invoice-addressee{font-size:11pt;font-weight:bold}.invoice-sender-block{background:#fef9c3;padding:10px 12px;font-size:9pt;line-height:1.6;min-width:180px}
.sender-line.sender-name{font-weight:bold;margin:4px 0}.invoice-title{font-size:16pt;font-weight:bold;text-align:center;margin:12px 0 16px;border-bottom:2px solid #1e293b;padding-bottom:8px}
.invoice-total-bar{display:flex;align-items:center;margin-bottom:14px;border:1px solid #1e293b}.invoice-total-label{background:#1e293b;color:#fff;padding:10px 16px;font-weight:bold;font-size:11pt}
.invoice-total-amount{margin-left:16px;font-size:14pt;font-weight:bold}.invoice-info-table{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:9pt}.invoice-info-table th,.invoice-info-table td{border:1px solid #94a3b8;padding:6px 10px}.invoice-info-table th{background:#f1f5f9;width:90px}
.invoice-detail-table{width:100%;border-collapse:collapse;font-size:9pt}.invoice-detail-table th,.invoice-detail-table td{border:1px solid #94a3b8;padding:6px 8px}.invoice-detail-table th{background:#f1f5f9}.invoice-detail-table .number{text-align:right;font-variant-numeric:tabular-nums}
.invoice-detail-subtotal{background:#f8fafc;font-weight:600}.invoice-summary-block{margin-top:12px;margin-bottom:16px;border:1px solid #94a3b8;padding:10px 14px;max-width:320px;margin-left:auto}
.invoice-summary-row{display:flex;justify-content:space-between;padding:4px 0}.invoice-summary-total{border-top:1px solid #64748b;margin-top:6px;padding-top:8px;font-weight:bold;font-size:11pt}
.invoice-section{margin-top:14px}.invoice-section-title{font-size:10pt;font-weight:bold;margin-bottom:6px}.bank-block{background:#f8fafc;padding:12px;border:1px solid #e2e8f0;font-size:9pt;border-radius:2px}`;
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>請求書</title><style>${style}</style></head><body>${body}</body></html>`;
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

/** 請求書（1枚目）＋実績報告書（2枚目以降）を1つのPDF用HTMLに結合 */
function buildCombinedPdfHtml(invoiceBody: string, reportBody: string): string {
  const invoiceStyle = `.invoice-sheet{padding:16px;font-family:Hiragino Sans,Meiryo,sans-serif;font-size:10pt;color:#1e293b}.invoice-header-row{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px}.invoice-addressee{font-size:11pt;font-weight:bold}.invoice-sender-block{background:#fef9c3;padding:10px 12px;font-size:9pt;line-height:1.6;min-width:180px}.sender-line.sender-name{font-weight:bold;margin:4px 0}.invoice-title{font-size:16pt;font-weight:bold;text-align:center;margin:12px 0 16px;border-bottom:2px solid #1e293b;padding-bottom:8px}.invoice-total-bar{display:flex;align-items:center;margin-bottom:14px;border:1px solid #1e293b}.invoice-total-label{background:#1e293b;color:#fff;padding:10px 16px;font-weight:bold;font-size:11pt}.invoice-total-amount{margin-left:16px;font-size:14pt;font-weight:bold}.invoice-info-table{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:9pt}.invoice-info-table th,.invoice-info-table td{border:1px solid #94a3b8;padding:6px 10px}.invoice-info-table th{background:#f1f5f9;width:90px}.invoice-detail-table{width:100%;border-collapse:collapse;font-size:9pt}.invoice-detail-table th,.invoice-detail-table td{border:1px solid #94a3b8;padding:6px 8px}.invoice-detail-table th{background:#f1f5f9}.invoice-detail-table .number{text-align:right;font-variant-numeric:tabular-nums}.invoice-detail-subtotal{background:#f8fafc;font-weight:600}.invoice-summary-block{margin-top:12px;margin-bottom:16px;border:1px solid #94a3b8;padding:10px 14px;max-width:320px;margin-left:auto}.invoice-summary-row{display:flex;justify-content:space-between;padding:4px 0}.invoice-summary-total{border-top:1px solid #64748b;margin-top:6px;padding-top:8px;font-weight:bold;font-size:11pt}.invoice-section{margin-top:14px}.invoice-section-title{font-size:10pt;font-weight:bold;margin-bottom:6px}.bank-block{background:#f8fafc;padding:12px;border:1px solid #e2e8f0;font-size:9pt;border-radius:2px}`;
  const reportStyle = `.report-sheet{padding:16px;font-family:Hiragino Sans,Meiryo,sans-serif;font-size:10pt;color:#1e293b}.report-header{text-align:center;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #1e293b}.report-company{font-size:13pt;font-weight:bold}.report-title{font-size:14pt;font-weight:bold}.report-section{margin-top:14px}.report-section-title{font-size:11pt;font-weight:bold;margin-bottom:6px;border-bottom:1px solid #94a3b8}.report-table{width:100%;border-collapse:collapse;margin-top:4px}.report-table th,.report-table td{border:1px solid #cbd5e1;padding:4px 8px;font-size:9pt}.report-table td:first-child{width:160px;background:#f8fafc}.report-note{font-size:8pt;color:#64748b;margin-top:2px}.report-business-desc{font-size:9pt;padding:6px 8px;background:#f8fafc;border:1px solid #e2e8f0}`;
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>請求書・業務委託実績報告書</title><style>@page{size:A4;margin:16mm}body{margin:0;padding:0;font-size:10pt;color:#1e293b}${invoiceStyle}${reportStyle}.pdf-page-break{page-break-after:always}</style></head><body>${invoiceBody}<div class="pdf-page-break"></div><div class="report-sheet">${reportBody}</div></body></html>`;
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
  const userRecords = getRecordsForMonth(getRecordsForUser(allRecords, member.id), yearMonth);
  const totalMinutes = userRecords.reduce((s, r) => s + r.durationMinutes, 0);
  const rate = member.hourlyRate != null ? member.hourlyRate : DEFAULT_HOURLY_RATE;
  const { subtotal, taxRate, totalWithTax } = calcInvoiceAmounts(totalMinutes, rate);
  const invoiceNo = getInvoiceNumber(yearMonth, member.invoiceNumber);
  const paymentDueDate = getPaymentDueDate(yearMonth);
  const html = buildInvoiceHtml(
    member.name,
    yearMonth,
    totalMinutes,
    rate,
    subtotal,
    taxRate,
    totalWithTax,
    invoiceNo,
    paymentDueDate,
    member.postalCode ?? "",
    member.address ?? "",
    member.bankName ?? "",
    member.branchName ?? "",
    member.accountType ?? "普通",
    member.accountNumber ?? "",
    member.accountHolder ?? "",
    member.phoneNumber
  );
  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  }
}

/** 請求書（1枚目）＋実績報告書（2枚目以降）を1つのPDFで出力（管理者・メンバー共通） */
function printMemberCombinedPdf(
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
  const { subtotal, taxRate, totalWithTax } = calcInvoiceAmounts(totalMinutes, rate);
  const invoiceNo = getInvoiceNumber(yearMonth, member.invoiceNumber);
  const paymentDueDate = getPaymentDueDate(yearMonth);
  const invoiceBody = buildInvoiceBody(
    member.name,
    yearMonth,
    totalMinutes,
    rate,
    subtotal,
    taxRate,
    totalWithTax,
    invoiceNo,
    paymentDueDate,
    member.postalCode ?? "",
    member.address ?? "",
    member.phoneNumber ?? "",
    member.bankName ?? "",
    member.branchName ?? "",
    member.accountType ?? "普通",
    member.accountNumber ?? "",
    member.accountHolder ?? ""
  );
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
  const reportBody = buildReportBody(
    member.name,
    yearMonth,
    rate,
    totalMinutes,
    workDays,
    totalWithTax,
    kpiTotals.totalCalls,
    kpiTotals.validCalls,
    kpiTotals.kcCount,
    kpiTotals.decisionMakerApo,
    validRate,
    kcRate,
    apoRate,
    dailyRows
  );
  const html = buildCombinedPdfHtml(invoiceBody, reportBody);
  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  }
}

type Tab = "home" | "shift" | "kpi";
type AdminSection = "dashboard" | "attendance" | "shift" | "kpi" | "settings";

const KPI_LABELS: { key: keyof Omit<KpiRecord, "id" | "date" | "userId">; label: string }[] = [
  { key: "totalCalls", label: "総コール数" },
  { key: "validCalls", label: "総有効コール数" },
  { key: "kcCount", label: "KC数" },
  { key: "followUpCreated", label: "追いかけ作成数" },
  { key: "decisionMakerApo", label: "決裁者アポ数" },
  { key: "nonDecisionMakerApo", label: "非決裁者アポ数" },
];

function AdminDashboard(props: {
  allRecords: WorkRecord[];
  allOpenRecords: OpenRecord[];
  allShifts: Shift[];
  allKpiRecords: KpiRecord[];
  members: Member[];
  setMembers: (v: Member[] | ((prev: Member[]) => Member[])) => void;
  onRefresh: () => void;
  onSaveMemberRecords: (memberId: string, records: WorkRecord[]) => Promise<void>;
  deviationApprovedIds: Set<string>;
  onApproveDeviation: (workRecordId: string) => Promise<void>;
}) {
  const {
    allRecords,
    allOpenRecords,
    allShifts,
    allKpiRecords,
    members,
    setMembers,
    onRefresh,
    onSaveMemberRecords,
    deviationApprovedIds,
    onApproveDeviation,
  } = props;
  const [adminSection, setAdminSection] = useState<AdminSection>("dashboard");
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberLogin, setNewMemberLogin] = useState("");
  const [newMemberPassword, setNewMemberPassword] = useState("");
  const [newMemberHourlyRate, setNewMemberHourlyRate] = useState(DEFAULT_HOURLY_RATE);
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
  const [editPhoneNumber, setEditPhoneNumber] = useState("");
  const [kpiDate, setKpiDate] = useState(() => toDateString(new Date()));
  const [dashboardDate, setDashboardDate] = useState(() => toDateString(new Date()));
  const [backupExpanded, setBackupExpanded] = useState(false);
  const [rangeStart, setRangeStart] = useState(() => getThisWeekMondayDateString());
  const [rangeEnd, setRangeEnd] = useState(() => toDateString(new Date()));
  const [reportMember, setReportMember] = useState<Member | null>(null);
  const [reportMonth, setReportMonth] = useState(() => getLastMonthString());
  const [recordFormMember, setRecordFormMember] = useState<Member | null>(null);
  const [recordFormRecord, setRecordFormRecord] = useState<WorkRecord | null>(null);
  const [recordFormDate, setRecordFormDate] = useState(() => toDateString(new Date()));
  const [recordFormStart, setRecordFormStart] = useState("09:00");
  const [recordFormEnd, setRecordFormEnd] = useState("18:00");
  const [recordListMemberId, setRecordListMemberId] = useState<string | null>(null);

  const y = new Date().getFullYear();
  const m = new Date().getMonth() + 1;
  const currentYearMonth = `${y}-${String(m).padStart(2, "0")}`;
  const todayStr = toDateString(new Date());
  const activeMembers = members.filter((mem) => mem.isActive !== false);
  const archivedMembers = members.filter((mem) => mem.isActive === false);
  const teamTotals = getMonthlyKpiTotals(allKpiRecords, currentYearMonth);
  const teamValidRate = safeRatePercent(teamTotals.validCalls, teamTotals.totalCalls);
  const teamKcRate = safeRatePercent(teamTotals.kcCount, teamTotals.validCalls);
  const teamApoRate = safeRatePercent(teamTotals.decisionMakerApo, teamTotals.kcCount);
  const monthTeamMinutes = activeMembers.reduce((s, mem) => s + getTotalMinutesForMonthByUser(allRecords, mem.id, currentYearMonth), 0);
  const monthApoCostMinutes = teamTotals.decisionMakerApo > 0 ? monthTeamMinutes / teamTotals.decisionMakerApo : null;

  const thisWeekMonday = getThisWeekMondayDateString();
  const weekKpis = getKpiInDateRange(allKpiRecords, thisWeekMonday, todayStr);
  const weekTotals = getKpiTotalsFromRecords(weekKpis);
  const weekValidRate = safeRatePercent(weekTotals.validCalls, weekTotals.totalCalls);
  const weekKcRate = safeRatePercent(weekTotals.kcCount, weekTotals.validCalls);
  const weekApoRate = safeRatePercent(weekTotals.decisionMakerApo, weekTotals.kcCount);

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

  // 表示日に稼働予定が入っているメンバーID（必須項目はこのメンバーのみ表示）
  const memberIdsWithShiftOnDate = getMemberIdsWithShiftOnDate(allShifts, dashboardDate);
  const membersWithShiftOnDate = activeMembers.filter((m) => memberIdsWithShiftOnDate.has(m.id));

  // 振込先情報が未登録のメンバー（銀行名・支店名・口座番号・口座名義の主要4項目を trim して判定し、4つ揃っていれば入力済みとする）
  const trimVal = (v: string | number | null | undefined) => (v == null ? "" : String(v).trim());
  const hasKeyBankInfo = (m: Member) =>
    trimVal(m.bankName) !== "" &&
    trimVal(m.branchName) !== "" &&
    trimVal(m.accountNumber) !== "" &&
    trimVal(m.accountHolder) !== "";
  const membersWithMissingBankInfo = activeMembers.filter((m) => !hasKeyBankInfo(m));

  // 必須項目：表示日に稼働予定があるメンバーのうち、活動記録・KPI 未対応
  const hasRecordOnDate = (userId: string) =>
    allRecords.some((r) => r.date === dashboardDate && r.userId === userId) ||
    allOpenRecords.some((r) => r.date === dashboardDate && r.userId === userId);
  const hasKpiOnDate = (userId: string) =>
    allKpiRecords.some((k) => k.date === dashboardDate && k.userId === userId);
  const membersWithoutRecord = membersWithShiftOnDate.filter((m) => !hasRecordOnDate(m.id));
  const membersWithoutKpi = membersWithShiftOnDate.filter((m) => !hasKpiOnDate(m.id));

  // 稼働乖離アラート（表示日・15分以上ずれかつ未承認の記録）
  const getShiftSlots = (shift: Shift) => {
    const slots: { start: string; end: string }[] = [{ start: shift.startPlanned, end: shift.endPlanned }];
    if (shift.startPlanned2 && shift.endPlanned2) slots.push({ start: shift.startPlanned2, end: shift.endPlanned2 });
    return slots;
  };
  const deviationsForDate = allRecords
    .filter((r) => r.date === dashboardDate && !deviationApprovedIds.has(r.id))
    .map((r) => {
      const shift = allShifts.find((s) => s.userId === r.userId && s.date === r.date);
      if (!shift) return null;
      const member = activeMembers.find((m) => m.id === r.userId);
      const info = getDeviationLabel(r, getShiftSlots(shift), member?.name ?? "");
      return info ? { record: r, label: info.label } : null;
    })
    .filter((x): x is { record: WorkRecord; label: string } => x != null);

  // 過去7日間の不備・乖離（今日含む7日分）
  const last7Days = (() => {
    const d = new Date();
    const arr: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const x = new Date(d);
      x.setDate(d.getDate() - i);
      arr.push(toDateString(x));
    }
    return arr;
  })();
  const past7DaysSummary = last7Days.map((dateStr) => {
    const autoCount = allRecords.filter((r) => r.date === dateStr && r.isAutoCompleted).length;
    const dayRecords = allRecords.filter((r) => r.date === dateStr && !deviationApprovedIds.has(r.id));
    let deviationCount = 0;
    for (const r of dayRecords) {
      const shift = allShifts.find((s) => s.userId === r.userId && s.date === r.date);
      if (!shift) continue;
      const member = activeMembers.find((m) => m.id === r.userId);
      const info = getDeviationLabel(r, getShiftSlots(shift), member?.name ?? "");
      if (info) deviationCount++;
    }
    return { dateStr, autoCount, deviationCount };
  });

  const handleAdd = async () => {
    if (!newMemberName.trim()) return;
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
      setNewMemberPassword("");
      setNewMemberHourlyRate(DEFAULT_HOURLY_RATE);
      onRefresh();
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error("メンバー追加エラー:", e);
      alert(`追加に失敗しました：${reason}`);
    }
  };

  const openDetail = (member: Member) => {
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
    setEditPhoneNumber(member.phoneNumber ?? "");
  };

  const openReport = (member: Member) => {
    setReportMember(member);
    setReportMonth(getLastMonthString());
  };

  const handlePrintReport = () => {
    if (!reportMember) return;
    const maxMonth = getLastMonthString();
    const effectiveMonth = reportMonth > maxMonth ? maxMonth : reportMonth;
    printMemberCombinedPdf(reportMember, effectiveMonth, allRecords, allKpiRecords);
  };

  const saveDetail = async () => {
    if (!detailId) return;
    // 振込先・請求管理番号・電話番号の必須バリデーション（null または空文字は保存不可）
    const zip = editPostalCode.trim();
    const addr = editAddress.trim();
    const bank = editBankName.trim();
    const branch = editBranchName.trim();
    const accNum = editAccountNumber.trim();
    const accHolder = editAccountHolder.trim();
    const phone = editPhoneNumber.trim();
    const invNum = editInvoiceNumber.trim();
    const missing: string[] = [];
    if (!zip) missing.push("郵便番号");
    if (!addr) missing.push("住所");
    if (!bank) missing.push("銀行名");
    if (!branch) missing.push("支店名");
    if (!accNum) missing.push("口座番号");
    if (!accHolder) missing.push("口座名義");
    if (!phone) missing.push("電話番号");
    if (!invNum) missing.push("請求管理番号（3桁）");
    if (missing.length > 0) {
      alert(`振込先情報が未入力です。以下の項目を入力してください。\n\n${missing.join("、")}`);
      return;
    }
    const updates: Parameters<typeof updateMember>[1] = {
      name: editName.trim(),
      loginAccount: editLogin.trim(),
      hourlyRate: editRate >= 0 ? editRate : DEFAULT_HOURLY_RATE,
      postalCode: zip,
      address: addr,
      bankName: bank,
      branchName: branch,
      accountType: editAccountType,
      accountNumber: accNum,
      accountHolder: accHolder,
      invoiceNumber: invNum,
      phoneNumber: phone,
    };
    if (editPass !== "") updates.password = editPass;
    await updateMember(detailId, updates);
    await onRefresh();
    setDetailId(null);
  };

  const targetWeekStart = getTargetWeekStart();
  const targetWeekDates = getWeekDates(targetWeekStart);

  const navItems: { id: AdminSection; label: string }[] = [
    { id: "dashboard", label: "ダッシュボード" },
    { id: "attendance", label: "稼働状況" },
    { id: "shift", label: "稼働予定管理" },
    { id: "kpi", label: "業務委託KPI" },
    { id: "settings", label: "管理設定" },
  ];

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-0 border-b border-slate-200 bg-white shadow-sm">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setAdminSection(item.id)}
            className={`px-4 py-3 text-sm font-medium transition ${adminSection === item.id ? "border-b-2 border-slate-700 text-slate-800" : "text-slate-500 hover:text-slate-700"}`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {adminSection === "dashboard" && (
        <div className="space-y-6">
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
          <section className="rounded-xl border border-amber-200 bg-amber-50/80 p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">本日の活動状況（表示日: {dashboardDate}・稼働予定があるメンバーのみ）</h2>
            <p className="mb-4 text-xs text-slate-600">その日に稼働予定が入っているメンバーについて、活動記録・KPI入力が必要です。未対応のメンバーがいる場合は共有してください。</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h3 className="mb-2 text-xs font-medium text-slate-700">活動記録（業務開始・終了）</h3>
                {membersWithoutRecord.length === 0 ? (
                  <p className="text-sm text-emerald-700">全員記録済み</p>
                ) : (
                  <ul className="space-y-1 text-sm text-slate-700">
                    {membersWithoutRecord.map((m) => (
                      <li key={m.id}>・{m.name}</li>
                    ))}
                    <li className="pt-1 text-xs text-amber-700">上記 {membersWithoutRecord.length} 名は未記録です</li>
                  </ul>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h3 className="mb-2 text-xs font-medium text-slate-700">KPI入力（総コール数・アポ数など）</h3>
                {membersWithoutKpi.length === 0 ? (
                  <p className="text-sm text-emerald-700">全員入力済み</p>
                ) : (
                  <ul className="space-y-1 text-sm text-slate-700">
                    {membersWithoutKpi.map((m) => (
                      <li key={m.id}>・{m.name}</li>
                    ))}
                    <li className="pt-1 text-xs text-amber-700">上記 {membersWithoutKpi.length} 名は未入力です</li>
                  </ul>
                )}
              </div>
            </div>
          </section>
          {deviationsForDate.length > 0 && (
            <section className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-amber-900">稼働乖離アラート（予定と実績が15分以上ずれています）</h2>
              <p className="mb-4 text-xs text-amber-800">正当な理由がある場合は「承認」を押すとアラートが消え、実績レポート・請求書に反映されます。</p>
              <ul className="space-y-3">
                {deviationsForDate.map(({ record, label }) => (
                  <li key={record.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white px-4 py-2">
                    <span className="text-sm text-slate-800">{label}</span>
                    <button
                      type="button"
                      onClick={() => onApproveDeviation(record.id)}
                      className="rounded bg-slate-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                    >
                      承認
                    </button>
                  </li>
                ))}
              </ul>
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
            <h2 className="mb-3 text-sm font-semibold text-slate-800">過去7日間の不備・乖離状況</h2>
            <p className="mb-4 text-xs text-slate-600">日付ごとの自動補完件数と、15分以上ずれた未承認の乖離件数です。対応が必要な日がひと目で分かります。</p>
            <ul className="space-y-2">
              {past7DaysSummary.map(({ dateStr, autoCount, deviationCount }) => {
                const disp = formatDisplayDate(dateStr);
                const needAttention = autoCount > 0 || deviationCount > 0;
                return (
                  <li
                    key={dateStr}
                    className={`rounded-lg border px-3 py-2 text-sm ${needAttention ? "border-amber-200 bg-amber-50/50" : "border-slate-100 bg-slate-50/50"}`}
                  >
                    <span className="font-medium text-slate-800">{disp}</span>
                    <span className="ml-2 text-slate-600">
                      ：{autoCount + deviationCount}件
                      {autoCount > 0 && <span className="text-amber-700">（自動補完{autoCount}）</span>}
                      {deviationCount > 0 && <span className="text-amber-700">（乖離{deviationCount}）</span>}
                      {autoCount === 0 && deviationCount === 0 && "（不備なし）"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-medium text-slate-700">KPI統計（今月・今週）</h2>
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">今月のKPI統計（{currentYearMonth}）</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg bg-slate-800 p-4 text-white">
                    <div className="text-xs text-slate-300">総コール数</div>
                    <div className="text-2xl font-bold">{teamTotals.totalCalls}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">総有効コール数</div>
                    <div className="text-2xl font-bold">{teamTotals.validCalls}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">決裁者アポ数合計</div>
                    <div className="text-2xl font-bold">{teamTotals.decisionMakerApo}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">有効率</div>
                    <div className="text-2xl font-bold">{teamValidRate != null ? `${teamValidRate}%` : "—"}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">KC率（決裁者接続率）</div>
                    <div className="text-2xl font-bold">{teamKcRate != null ? `${teamKcRate}%` : "—"}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">アポ率</div>
                    <div className="text-2xl font-bold">{teamApoRate != null ? `${teamApoRate}%` : "—"}</div>
                  </div>
                </div>
              </div>
              <div>
                <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">今週のKPI統計（月曜〜今日）</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg bg-slate-800 p-4 text-white">
                    <div className="text-xs text-slate-300">総コール数</div>
                    <div className="text-2xl font-bold">{weekTotals.totalCalls}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">総有効コール数</div>
                    <div className="text-2xl font-bold">{weekTotals.validCalls}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">決裁者アポ数合計</div>
                    <div className="text-2xl font-bold">{weekTotals.decisionMakerApo}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">有効率</div>
                    <div className="text-2xl font-bold">{weekValidRate != null ? `${weekValidRate}%` : "—"}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">KC率（決裁者接続率）</div>
                    <div className="text-2xl font-bold">{weekKcRate != null ? `${weekKcRate}%` : "—"}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">アポ率</div>
                    <div className="text-2xl font-bold">{weekApoRate != null ? `${weekApoRate}%` : "—"}</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-medium text-slate-700">生産性指標（アポ取得単価・時間ベース）</h2>
            <p className="mb-4 text-xs text-slate-500">決裁者アポ1件あたりの活動時間。数値が小さいほど効率が良いです。</p>
            <div className="flex flex-wrap gap-6">
              <div className="rounded-lg bg-slate-800 px-4 py-3 text-white">
                <div className="text-xs text-slate-300">表示日のアポ取得単価（チーム全体）</div>
                <div className="text-xl font-bold">
                  {dateApoCostMinutes != null ? `${formatDuration(Math.round(dateApoCostMinutes))}/件` : "—"}
                </div>
              </div>
              <div className="rounded-lg bg-slate-700 px-4 py-3 text-white">
                <div className="text-xs text-slate-300">今月の平均アポ取得単価（チーム全体）</div>
                <div className="text-xl font-bold">
                  {monthApoCostMinutes != null ? `${formatDuration(Math.round(monthApoCostMinutes))}/件` : "—"}
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {adminSection === "attendance" && (
        <section className="space-y-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <h2 className="mb-4 text-sm font-medium text-slate-700">稼働状況（本日）</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[500px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-3 py-2.5 text-left font-medium text-slate-600">名前</th>
                    <th className="px-3 py-2.5 text-center font-medium text-slate-600">ステータス</th>
                    <th className="px-3 py-2.5 text-right font-medium text-slate-600">当日の活動時間</th>
                  </tr>
                </thead>
                <tbody>
{activeMembers.map((mem) => {
                  const open = getOpenRecordForUser(allOpenRecords, mem.id);
                  const userRecords = getRecordsForUser(allRecords, mem.id);
                  const todayMin = userRecords.filter((r) => r.date === todayStr).reduce((s, r) => s + r.durationMinutes, 0);
                  return (
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-6">
            <h2 className="mb-3 text-sm font-medium text-slate-700">活動記録の追加・編集</h2>
            <p className="mb-4 text-xs text-slate-500">メンバーを選択し、記録の追加または既存記録の編集ができます。保存後は合計業務遂行時間・請求金額に即反映されます。</p>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">メンバー</span>
                <select
                  value={recordListMemberId ?? ""}
                  onChange={(e) => setRecordListMemberId(e.target.value || null)}
                  className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-800"
                >
                  <option value="">選択してください</option>
                  {activeMembers.map((mem) => (
                    <option key={mem.id} value={mem.id}>{mem.name}</option>
                  ))}
                </select>
              </label>
              {recordListMemberId && (
                <button
                  type="button"
                  onClick={() => {
                    const mem = members.find((m) => m.id === recordListMemberId);
                    if (mem) {
                      setRecordFormMember(mem);
                      setRecordFormRecord(null);
                      setRecordFormDate(toDateString(new Date()));
                      setRecordFormStart("09:00");
                      setRecordFormEnd("18:00");
                    }
                  }}
                  className="mt-5 rounded bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600"
                >
                  記録を追加
                </button>
              )}
            </div>
            {recordListMemberId && (() => {
              const userRecords = getRecordsForUser(allRecords, recordListMemberId);
              const sorted = [...userRecords].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);
              const mem = members.find((m) => m.id === recordListMemberId);
              return (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        <th className="px-3 py-2.5 text-left font-medium text-slate-600">日付</th>
                        <th className="px-3 py-2.5 text-left font-medium text-slate-600">業務開始</th>
                        <th className="px-3 py-2.5 text-left font-medium text-slate-600">業務終了</th>
                        <th className="px-3 py-2.5 text-right font-medium text-slate-600">時間</th>
                        <th className="px-3 py-2.5 text-right font-medium text-slate-600">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.length === 0 ? (
                        <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-500">{mem?.name ?? ""} の記録はまだありません</td></tr>
                      ) : (
                        sorted.map((r) => (
                          <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                            <td className="px-3 py-2.5 text-slate-800">{formatDisplayDate(r.date)}</td>
                            <td className="px-3 py-2.5 tabular-nums text-slate-700">{getTimeFromIso(r.startRounded)}</td>
                            <td className="px-3 py-2.5 tabular-nums text-slate-700">{getTimeFromIso(r.endRounded)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{formatDuration(r.durationMinutes)}</td>
                            <td className="px-3 py-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  setRecordFormRecord(r);
                                  setRecordFormMember(members.find((m) => m.id === r.userId) ?? null);
                                  setRecordFormDate(r.date);
                                  setRecordFormStart(getTimeFromIso(r.startRounded));
                                  setRecordFormEnd(getTimeFromIso(r.endRounded));
                                }}
                                className="text-slate-600 underline hover:text-slate-800"
                              >
                                編集
                              </button>
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
        </section>
      )}

      {recordFormMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { setRecordFormMember(null); setRecordFormRecord(null); }}>
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-sm font-semibold text-slate-800">{recordFormRecord ? "活動記録を編集" : "活動記録を追加"}</h3>
            <p className="mb-3 text-xs text-slate-600">{recordFormMember.name}</p>
            <div className="mb-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">日付</span>
                <input type="date" value={recordFormDate} onChange={(e) => setRecordFormDate(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
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
                onClick={async () => {
                  const built = buildWorkRecordFromTimes(recordFormDate, recordFormStart, recordFormEnd, recordFormMember.id, recordFormRecord?.id);
                  if (!built) {
                    alert("終了時間は開始時間より後にしてください。");
                    return;
                  }
                  const userRecords = getRecordsForUser(allRecords, recordFormMember.id);
                  const next = recordFormRecord
                    ? userRecords.map((r) => (r.id === recordFormRecord.id ? built : r))
                    : [built, ...userRecords];
                  await onSaveMemberRecords(recordFormMember.id, next);
                  setRecordFormMember(null);
                  setRecordFormRecord(null);
                }}
                className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600"
              >
                保存
              </button>
              <button type="button" onClick={() => { setRecordFormMember(null); setRecordFormRecord(null); }} className="rounded border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {adminSection === "shift" && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-2 text-sm font-medium text-slate-700">稼働予定管理</h2>
          <p className="mb-4 text-xs text-slate-500">対象週: {formatDisplayDate(targetWeekDates[0])} ～ {formatDisplayDate(targetWeekDates[6])}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-3 py-2.5 text-left font-medium text-slate-600">名前</th>
                  <th className="px-3 py-2.5 text-center font-medium text-slate-600">登録状況</th>
                  <th className="px-3 py-2.5 text-left font-medium text-slate-600">登録済み稼働予定（直近）</th>
                </tr>
              </thead>
              <tbody>
                {activeMembers.map((mem) => {
                  const userShifts = getShiftsForUser(allShifts, mem.id);
                  const hasShiftThisWeek = targetWeekDates.some((d) => userShifts.some((s) => s.date === d));
                  const recentShifts = [...userShifts].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
                  return (
                    <tr key={mem.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                      <td className="px-3 py-2.5 font-medium text-slate-800">{mem.name}</td>
                      <td className="px-3 py-2.5 text-center">
                        {hasShiftThisWeek ? (
                          <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">登録済</span>
                        ) : (
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">未登録</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">
                        {recentShifts.length === 0 ? "—" : recentShifts.map((s) => `${formatDisplayDate(s.date)} ${s.startPlanned}～${s.endPlanned}`).join(" / ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
            {(() => {
              const start = rangeStart <= rangeEnd ? rangeStart : rangeEnd;
              const end = rangeStart <= rangeEnd ? rangeEnd : rangeStart;
              const rangeKpis = getKpiInDateRange(allKpiRecords, start, end);
              const rangeTotals = getKpiTotalsFromRecords(rangeKpis);
              const rangeValidRate = safeRatePercent(rangeTotals.validCalls, rangeTotals.totalCalls);
              const rangeKcRate = safeRatePercent(rangeTotals.kcCount, rangeTotals.validCalls);
              const rangeApoRate = safeRatePercent(rangeTotals.decisionMakerApo, rangeTotals.kcCount);
              return (
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
                    <div className="text-xs text-slate-300">KC率（決裁者接続率）</div>
                    <div className="text-2xl font-bold">{rangeKcRate != null ? `${rangeKcRate}%` : "—"}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">アポ率</div>
                    <div className="text-2xl font-bold">{rangeApoRate != null ? `${rangeApoRate}%` : "—"}</div>
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="border-t border-slate-200 pt-6">
          <h2 className="mb-4 text-sm font-medium text-slate-700">業務委託KPI（日別）</h2>
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
                  <th className="px-3 py-2.5 text-left font-medium text-slate-600">名前</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600">総コール数</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600">総有効コール数</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600">KC</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600">追いかけ</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600">決裁者アポ</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600">非決裁者アポ</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600">有効率</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600">KC率</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600">アポ率</th>
                </tr>
              </thead>
              <tbody>
                {activeMembers.map((mem) => {
                  const dayKpi = getKpiForDate(getKpiForUser(allKpiRecords, mem.id), kpiDate);
                  const rates = dayKpi ? getKpiRates(dayKpi) : null;
                  return (
                    <tr key={mem.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                      <td className="px-3 py-2.5 font-medium text-slate-800">{mem.name}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{dayKpi ? dayKpi.totalCalls : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{dayKpi ? dayKpi.validCalls : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{dayKpi ? dayKpi.kcCount : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{dayKpi ? dayKpi.followUpCreated : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{dayKpi ? dayKpi.decisionMakerApo : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{dayKpi ? dayKpi.nonDecisionMakerApo : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{rates?.validRate != null ? `${rates.validRate}%` : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{rates?.kcRate != null ? `${rates.kcRate}%` : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{rates?.apoRate != null ? `${rates.apoRate}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </div>
        </section>
      )}

      {adminSection === "settings" && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-medium text-slate-700">管理設定（メンバー追加・編集）</h2>

          <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-5 sm:p-6">
            <p className="mb-4 text-sm font-medium text-slate-700">新規メンバー追加</p>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5 lg:gap-6">
              <div className="flex min-w-0 flex-col gap-2">
                <label className="text-xs font-medium text-slate-600">名前</label>
                <input type="text" value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)} placeholder="表示名" className="h-10 w-full min-w-0 rounded border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <label className="text-xs font-medium text-slate-600">ユーザー名（ログイン用）</label>
                <input type="text" value={newMemberLogin} onChange={(e) => setNewMemberLogin(e.target.value)} placeholder="ログインID" className="h-10 w-full min-w-0 rounded border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <label className="text-xs font-medium text-slate-600">パスワード</label>
                <input type="password" value={newMemberPassword} onChange={(e) => setNewMemberPassword(e.target.value)} placeholder="パスワード" className="h-10 w-full min-w-0 rounded border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <label className="text-xs font-medium text-slate-600">委託料単価（円/時間）</label>
                <input type="number" min={0} value={newMemberHourlyRate} onChange={(e) => setNewMemberHourlyRate(parseInt(e.target.value, 10) || 0)} className="h-10 w-full min-w-0 rounded border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="flex min-w-0 flex-col gap-2 lg:justify-end">
                <label className="text-xs font-medium text-slate-600 lg:invisible">操作</label>
                <button type="button" onClick={handleAdd} className="h-10 w-full rounded bg-slate-700 px-4 text-sm font-medium text-white hover:bg-slate-600 lg:w-full">追加</button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="w-full min-w-0 table-fixed border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="w-[18%] px-1.5 py-1.5 text-left font-medium text-slate-600">名前</th>
                  <th className="w-[14%] px-1.5 py-1.5 text-left font-medium text-slate-600">ログイン名</th>
                  <th className="w-[10%] px-1.5 py-1.5 text-left font-medium text-slate-600">PW</th>
                  <th className="w-[12%] px-1.5 py-1.5 text-right font-medium text-slate-600">活動時間</th>
                  <th className="w-[14%] px-1.5 py-1.5 text-right font-medium text-slate-600">委託料</th>
                  <th className="w-[22%] px-1.5 py-1.5 text-right font-medium text-slate-600">操作</th>
                </tr>
              </thead>
              <tbody>
                {activeMembers.map((mem) => {
                  const monthMin = getTotalMinutesForMonthByUser(allRecords, mem.id, currentYearMonth);
                  const rate = mem.hourlyRate != null ? mem.hourlyRate : DEFAULT_HOURLY_RATE;
                  const pay = calcMonthlyPay(monthMin, rate);
                  const pw = mem.password || "—";
                  return (
                    <tr key={mem.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                      <td className="min-w-0 overflow-hidden px-1.5 py-1.5 font-medium text-slate-800 truncate" title={mem.name}>{mem.name}</td>
                      <td className="min-w-0 overflow-hidden px-1.5 py-1.5 font-mono text-slate-600 truncate" title={mem.loginAccount || ""}>{mem.loginAccount || "—"}</td>
                      <td className="min-w-0 overflow-hidden px-1.5 py-1.5 font-mono text-slate-600 truncate" title={pw}>{pw}</td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums text-slate-700 whitespace-nowrap">{formatDuration(monthMin)}</td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums font-medium text-slate-800 whitespace-nowrap">¥{pay.toLocaleString()}</td>
                      <td className="px-1.5 py-1.5 text-right align-middle">
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

          {detailId !== null && (
            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <h3 className="mb-3 text-sm font-medium text-slate-700">メンバー詳細設定（編集）</h3>
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
                  <input type="number" min={0} value={editRate} onChange={(e) => setEditRate(parseInt(e.target.value, 10) || 0)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
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
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-slate-500">電話番号</label>
                  <input type="text" value={editPhoneNumber} onChange={(e) => setEditPhoneNumber(e.target.value)} placeholder="03-1234-5678" className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={saveDetail} className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600">保存</button>
                <button type="button" onClick={() => setDetailId(null)} className="rounded border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">キャンセル</button>
                {detailId && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm("このメンバーを無効にしますか？一覧から非表示になりログインできなくなります。データは残り、後から「有効に戻す」で復元できます。")) return;
                      await updateMember(detailId, { isActive: false });
                      setDetailId(null);
                      const mems = await loadMembers();
                      setMembers(mems ?? []);
                      onRefresh();
                    }}
                    className="rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 hover:bg-amber-100"
                  >
                    このメンバーを無効にする
                  </button>
                )}
              </div>
            </div>
          )}

          {archivedMembers.length > 0 && (
            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50/70 p-4">
              <h3 className="mb-2 text-xs font-medium text-slate-600">無効にしたメンバー（アーカイブ）</h3>
              <p className="mb-3 text-xs text-slate-500">一覧から非表示にしたメンバーです。有効に戻すとログイン・一覧表示が再度可能になります。</p>
              <ul className="space-y-2">
                {archivedMembers.map((mem) => (
                  <li key={mem.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-100 bg-white px-3 py-2 text-sm">
                    <span className="font-medium text-slate-700">{mem.name}</span>
                    <span className="text-slate-500">{mem.loginAccount || "—"}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        await updateMember(mem.id, { isActive: true });
                        const mems = await loadMembers();
                        setMembers(mems ?? []);
                        onRefresh();
                      }}
                      className="rounded bg-slate-600 px-3 py-1 text-xs font-medium text-white hover:bg-slate-500"
                    >
                      有効に戻す
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

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

      {reportMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setReportMember(null)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-auto rounded-xl border border-slate-200 bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-sm font-semibold text-slate-800">PDF出力（請求書・実績レポート）</h3>
            <p className="mb-2 text-xs text-slate-600">{reportMember.name} の対象月の請求書（1枚目）と業務遂行実績報告書（2枚目以降）を1つのPDFで出力します。</p>
            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium text-slate-600">対象月</label>
              <input
                type="month"
                max={getLastMonthString()}
                value={reportMonth > getLastMonthString() ? getLastMonthString() : reportMonth}
                onChange={(e) => setReportMonth(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-800"
              />
              <p className="mt-1.5 text-xs text-slate-500">前月分の実績は翌月1日から出力可能になります。</p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handlePrintReport}
                className="rounded bg-slate-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-600"
              >
                PDFを出力（請求書・実績レポート）
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

type WeekFormState = Record<string, { s1: string; e1: string; s2: string; e2: string }>;

function ShiftTab(props: {
  userId: string;
  shifts: Shift[];
  onSave: (s: Shift[]) => void;
  onRefresh: () => void;
}) {
  const { userId, shifts, onSave, onRefresh } = props;
  const options = get15MinOptions();
  const [exceptionMode, setExceptionMode] = useState(false);
  const [weekStart, setWeekStart] = useState("");
  const [weekForm, setWeekForm] = useState<WeekFormState>({});

  const targetStart = weekStart || getTargetWeekStart();
  const weekDates = getWeekDates(targetStart);
  const deadline = getDeadlineForWeek(targetStart);
  const isPastDeadline = new Date() > deadline;
  const byDate = getShiftsByDateForWeek(shifts, targetStart);

  useEffect(() => {
    const dates = getWeekDates(targetStart);
    const map = getShiftsByDateForWeek(shifts, targetStart);
    const next: WeekFormState = {};
    dates.forEach((dateStr) => {
      const s = map.get(dateStr);
      next[dateStr] = {
        s1: s ? s.startPlanned : "09:00",
        e1: s ? s.endPlanned : "18:00",
        s2: s && s.startPlanned2 ? s.startPlanned2 : "",
        e2: s && s.endPlanned2 ? s.endPlanned2 : "",
      };
    });
    setWeekForm((prev) => ({ ...next, ...prev }));
  }, [targetStart, shifts]);

  const updateDay = (dateStr: string, field: "s1" | "e1" | "s2" | "e2", value: string) => {
    setWeekForm((prev) => {
      const cur = prev[dateStr] || { s1: "09:00", e1: "18:00", s2: "", e2: "" };
      return { ...prev, [dateStr]: { ...cur, [field]: value } };
    });
  };

  const handleSubmitWeek = (e: React.FormEvent) => {
    e.preventDefault();
    const otherShifts = shifts.filter((s) => !weekDates.includes(s.date));
    const newShifts: Shift[] = weekDates.map((dateStr) => {
      const f = weekForm[dateStr] || { s1: "09:00", e1: "18:00", s2: "", e2: "" };
      const existing = byDate.get(dateStr);
      const base = {
        id: existing ? existing.id : crypto.randomUUID(),
        userId,
        date: dateStr,
        startPlanned: f.s1,
        endPlanned: f.e1,
      };
      if (f.s2 && f.e2) {
        return { ...base, startPlanned2: f.s2, endPlanned2: f.e2 };
      }
      return base;
    });
    onSave([...newShifts, ...otherShifts]);
    onRefresh();
  };

  const weekOptions: string[] = [];
  for (let i = -4; i <= 2; i++) {
    const d = new Date();
    d.setDate(d.getDate() + 7 * i);
    weekOptions.push(getWeekStart(d));
  }

  return (
    <>
      <section className="mb-6 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80 sm:p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-slate-700">稼働可能日時の登録</h2>
          <p className="text-xs text-slate-500">
            予定の登録をお願いします
          </p>
        </div>
        {exceptionMode && (
          <div className="mb-4">
            <label className="mb-1 block text-sm text-slate-600">対象週を選択</label>
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
                const label = `${mon.getMonth() + 1}/${mon.getDate()}～${sun.getMonth() + 1}/${sun.getDate()}`;
                return (
                  <option key={ws} value={ws}>
                    {label}
                  </option>
                );
              })}
            </select>
          </div>
        )}
        <p className="mb-4 text-sm text-slate-600">
          {exceptionMode ? "選択した週の稼働予定を入力・修正できます。" : `${formatDisplayDate(weekDates[0])} ～ ${formatDisplayDate(weekDates[6])}`}
        </p>
        <form onSubmit={handleSubmitWeek} className="space-y-4">
          {weekDates.map((dateStr) => (
            <div key={dateStr} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
              <div className="mb-2 font-medium text-slate-800">{formatDisplayDate(dateStr)}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-14 text-xs text-slate-500">予定1</span>
                  <select
                    value={weekForm[dateStr] ? weekForm[dateStr].s1 : "09:00"}
                    onChange={(e) => updateDay(dateStr, "s1", e.target.value)}
                    className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                  >
                    {options.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                  <span className="text-slate-400">～</span>
                  <select
                    value={weekForm[dateStr] ? weekForm[dateStr].e1 : "18:00"}
                    onChange={(e) => updateDay(dateStr, "e1", e.target.value)}
                    className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                  >
                    {options.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-14 text-xs text-slate-500">予定2</span>
                  <select
                    value={weekForm[dateStr] ? weekForm[dateStr].s2 : ""}
                    onChange={(e) => updateDay(dateStr, "s2", e.target.value)}
                    className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                  >
                    <option value="">—</option>
                    {options.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                  <span className="text-slate-400">～</span>
                  <select
                    value={weekForm[dateStr] ? weekForm[dateStr].e2 : ""}
                    onChange={(e) => updateDay(dateStr, "e2", e.target.value)}
                    className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                  >
                    <option value="">—</option>
                    {options.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ))}
          <button type="submit" className="w-full rounded-xl bg-slate-700 px-4 py-2.5 font-medium text-white hover:bg-slate-600 sm:w-auto">
            この週を保存
          </button>
        </form>
        <button
          type="button"
          onClick={() => {
            setExceptionMode(!exceptionMode);
            if (exceptionMode) setWeekStart("");
            else setWeekStart(getTargetWeekStart());
          }}
          className="mt-4 text-sm text-slate-500 underline hover:text-slate-700"
        >
          {exceptionMode ? "通常モードに戻る" : "稼働可能日時の登録を忘れた方はこちら"}
        </button>
      </section>

      <section className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200/80">
        <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 sm:px-5 sm:py-4">登録した稼働予定一覧</h2>
        <div className="divide-y divide-slate-100">
          {shifts.length === 0 ? (
            <div className="px-4 py-8 text-center text-slate-500 sm:px-5">まだ稼働予定がありません</div>
          ) : (
            [...shifts]
              .sort((a, b) => b.date.localeCompare(a.date))
              .slice(0, 14)
              .map((s) => (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5 sm:py-4">
                  <div className="text-slate-800">
                    <span className="font-medium">{formatDisplayDate(s.date)}</span>
                    <span className="ml-2 text-sm text-slate-500">
                      {s.startPlanned}～{s.endPlanned}
                      {s.startPlanned2 && s.endPlanned2 ? ` / ${s.startPlanned2}～${s.endPlanned2}` : ""}
                    </span>
                  </div>
                  <div className="text-right font-semibold text-slate-700">{formatDuration(getShiftPlannedMinutes(s))}</div>
                </div>
              ))
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
  onSave: (k: KpiRecord[]) => void;
  onRefresh: () => void;
}) {
  const { userId, kpiRecords, currentYearMonth, onSave, onRefresh } = props;
  const today = toDateString(new Date());
  const [kpiDate, setKpiDate] = useState(today);
  const [totalCalls, setTotalCalls] = useState(0);
  const [validCalls, setValidCalls] = useState(0);
  const [kcCount, setKcCount] = useState(0);
  const [followUpCreated, setFollowUpCreated] = useState(0);
  const [decisionMakerApo, setDecisionMakerApo] = useState(0);
  const [nonDecisionMakerApo, setNonDecisionMakerApo] = useState(0);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const existing = getKpiForDate(kpiRecords, kpiDate);
    if (existing) {
      setTotalCalls(existing.totalCalls);
      setValidCalls(existing.validCalls);
      setKcCount(existing.kcCount);
      setFollowUpCreated(existing.followUpCreated);
      setDecisionMakerApo(existing.decisionMakerApo);
      setNonDecisionMakerApo(existing.nonDecisionMakerApo);
    } else {
      setTotalCalls(0);
      setValidCalls(0);
      setKcCount(0);
      setFollowUpCreated(0);
      setDecisionMakerApo(0);
      setNonDecisionMakerApo(0);
    }
    setSaved(false);
  }, [kpiDate, kpiRecords]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const existingRec = getKpiForDate(kpiRecords, kpiDate);
    const rec: KpiRecord = {
      id: existingRec ? existingRec.id : crypto.randomUUID(),
      userId,
      date: kpiDate,
      totalCalls,
      validCalls,
      kcCount,
      followUpCreated,
      decisionMakerApo,
      nonDecisionMakerApo,
    };
    const next = existingRec
      ? kpiRecords.map((r) => (r.date === kpiDate ? rec : r))
      : [rec, ...kpiRecords.filter((r) => r.date !== kpiDate)];
    onSave(next);
    onRefresh();
    setSaved(true);
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
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {KPI_LABELS.map(({ key, label }) => (
              <div key={key}>
                <label className="mb-1 block text-sm text-slate-600">{label}</label>
                <input
                  type="number"
                  min={0}
                  value={
                    key === "totalCalls"
                      ? totalCalls
                      : key === "validCalls"
                        ? validCalls
                        : key === "kcCount"
                          ? kcCount
                          : key === "followUpCreated"
                            ? followUpCreated
                            : key === "decisionMakerApo"
                              ? decisionMakerApo
                              : nonDecisionMakerApo
                  }
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10) || 0;
                    if (key === "totalCalls") setTotalCalls(v);
                    else if (key === "validCalls") setValidCalls(v);
                    else if (key === "kcCount") setKcCount(v);
                    else if (key === "followUpCreated") setFollowUpCreated(v);
                    else if (key === "decisionMakerApo") setDecisionMakerApo(v);
                    else setNonDecisionMakerApo(v);
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800"
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" className="rounded-xl bg-slate-700 px-4 py-2.5 font-medium text-white hover:bg-slate-600">
              保存する
            </button>
            {saved && <span className="text-sm text-green-600">保存しました</span>}
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
  const [deviationApprovedIds, setDeviationApprovedIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const [records, openRecs, shifts, kpis, mems, approvedIds] = await Promise.all([
        loadRecords(),
        loadOpenRecords(),
        loadShifts(),
        loadKpi(),
        loadMembers(),
        loadDeviationApprovals(),
      ]);
      setAllRecords(records);
      setAllOpenRecords(openRecs);
      setAllShifts(shifts);
      setAllKpiRecords(kpis);
      setMembers(mems ?? []);
      setDeviationApprovedIds(new Set(approvedIds));
    } catch (e) {
      console.error("refresh", e);
      setLoadError("データの取得に失敗しました。Supabase の設定とテーブルを確認してください。");
    }
  }, []);

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
      const [records, openRecs, shifts, kpis, approvedIds0] = await Promise.all([
        loadRecords(),
        loadOpenRecords(),
        loadShifts(),
        loadKpi(),
        loadDeviationApprovals(),
      ]);
      setAllRecords(records);
      setAllOpenRecords(openRecs);
      setAllShifts(shifts);
      setAllKpiRecords(kpis);
      setDeviationApprovedIds(new Set(approvedIds0));
      await runAutoComplete();
      const [records2, open2, approvedIds] = await Promise.all([loadRecords(), loadOpenRecords(), loadDeviationApprovals()]);
      setAllRecords(records2);
      setAllOpenRecords(open2);
      setDeviationApprovedIds(new Set(approvedIds));
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

  const records = isAdminMode ? allRecords : getRecordsForUser(allRecords, currentUserId ?? "");
  const openRecord = getOpenRecordForUser(allOpenRecords, currentUserId ?? "");
  const shifts = isAdminMode ? allShifts : getShiftsForUser(allShifts, currentUserId ?? "");
  const kpiRecords = isAdminMode ? allKpiRecords : getKpiForUser(allKpiRecords, currentUserId ?? "");

  const todayStr = toDateString(new Date());
  const todayMinutes = getTotalMinutesForDate(records, todayStr);
  const currentYearMonth =
    selectedMonth || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const monthRecords = getRecordsForMonth(records, currentYearMonth);
  const monthShifts = shifts.filter((s) => s.date.startsWith(currentYearMonth));
  const monthKpi = getKpiForMonth(kpiRecords, currentYearMonth);
  const totalMinutes = getTotalMinutesForMonth(records, currentYearMonth);
  const isCurrentMonth =
    currentYearMonth === `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const selectableMonths = getSelectableMonths(records, shifts, kpiRecords);

  const handleStart = async () => {
    if (openRecord || !currentUserId) return;
    const now = new Date();
    const rounded = roundUpTo15Minutes(now);
    const newOpen: OpenRecord = {
      id: crypto.randomUUID(),
      userId: currentUserId,
      startRaw: now.toISOString(),
      startRounded: rounded.toISOString(),
      date: toDateString(now),
    };
    await setOpenRecordForUser(currentUserId, newOpen);
    await refresh();
  };

  const handleEnd = async () => {
    if (!openRecord || !currentUserId) return;
    const now = new Date();
    const endRounded = roundDownTo15Minutes(now);
    const startRounded = new Date(openRecord.startRounded);
    const durationMinutes = calcDurationMinutes(startRounded, endRounded);
    const newRecord: WorkRecord = {
      id: openRecord.id,
      userId: currentUserId,
      startRaw: openRecord.startRaw,
      startRounded: openRecord.startRounded,
      endRaw: now.toISOString(),
      endRounded: endRounded.toISOString(),
      durationMinutes,
      date: openRecord.date,
    };
    const userRecords = getRecordsForUser(allRecords, currentUserId);
    const next = [newRecord, ...userRecords];
    await saveRecordsForUser(currentUserId, next);
    await setOpenRecordForUser(currentUserId, null);
    await refresh();
  };

  const handleSaveShifts = async (newShifts: Shift[]) => {
    if (!currentUserId) return;
    await saveShiftsForUser(currentUserId, newShifts);
    await refresh();
  };

  const handleSaveKpi = async (newKpi: KpiRecord[]) => {
    if (!currentUserId) return;
    await saveKpiForUser(currentUserId, newKpi);
    await refresh();
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    const user = await loginUser(loginAccount.trim(), loginPassword);
    if (user) {
      setCurrentUserId(user.id);
      setLoginPassword("");
      if ((user.loginAccount ?? "").toLowerCase() !== "admin") setIsAdminMode(false);
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
    setCurrentUserId(null);
    setLoginAccount("");
    setLoginPassword("");
    setLoginError("");
  };

  const currentMember = members.find((m) => m.id === currentUserId);
  const isAdminUser = (currentMember?.loginAccount ?? "").toLowerCase() === "admin";

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
      <header className="bg-slate-800 text-white shadow-md" style={{ backgroundColor: "#1e293b" }}>
        <div className="mx-auto max-w-2xl px-4 py-4 sm:px-6">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {isAdminMode ? "業務進捗・活動報告（管理者）" : `業務進捗・活動報告${currentMember ? ` - ${currentMember.name}` : ""}`}
          </h1>
        </div>
      </header>

      {!isAdminMode && (
        <div className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-2xl gap-0">
            <button
              type="button"
              onClick={() => setTab("home")}
              className={`flex-1 px-3 py-3 text-sm font-medium transition sm:px-4 ${tab === "home" ? "border-b-2 border-slate-700 text-slate-800" : "text-slate-500 hover:text-slate-700"}`}
            >
              活動記録
            </button>
            <button
              type="button"
              onClick={() => setTab("shift")}
              className={`flex-1 px-3 py-3 text-sm font-medium transition sm:px-4 ${tab === "shift" ? "border-b-2 border-slate-700 text-slate-800" : "text-slate-500 hover:text-slate-700"}`}
            >
              稼働予定
            </button>
            <button
              type="button"
              onClick={() => setTab("kpi")}
              className={`flex-1 px-3 py-3 text-sm font-medium transition sm:px-4 ${tab === "kpi" ? "border-b-2 border-slate-700 text-slate-800" : "text-slate-500 hover:text-slate-700"}`}
            >
              KPI入力
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
        {isAdminMode && isAdminUser ? (
          <AdminDashboard
            allRecords={allRecords}
            allOpenRecords={allOpenRecords}
            allShifts={allShifts}
            allKpiRecords={allKpiRecords}
            members={members}
            setMembers={setMembers}
            onRefresh={refresh}
            onSaveMemberRecords={async (memberId, records) => {
              await saveRecordsForUser(memberId, records);
              await refresh();
            }}
            deviationApprovedIds={deviationApprovedIds}
            onApproveDeviation={async (workRecordId) => {
              await saveDeviationApproval(workRecordId);
              await refresh();
            }}
          />
        ) : tab === "home" ? (
          <>
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
                  PDF出力（請求書・実績レポート）
                </button>
              </div>
            </section>

            <section className="mb-6 sm:mb-8">
              <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={!!openRecord}
                  className="flex-1 rounded-xl bg-slate-700 px-6 py-4 text-base font-semibold text-white shadow-md transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50 sm:py-5 sm:text-lg"
                >
                  業務開始
                </button>
                <button
                  type="button"
                  onClick={handleEnd}
                  disabled={!openRecord}
                  className="flex-1 rounded-xl bg-slate-600 px-6 py-4 text-base font-semibold text-white shadow-md transition hover:bg-slate-500 disabled:cursor-not-allowed disabled:opacity-50 sm:py-5 sm:text-lg"
                >
                  業務終了
                </button>
              </div>
              {openRecord && (
                <p className="mt-3 text-center text-sm text-slate-600">活動中（開始: {formatTime(openRecord.startRounded)}）</p>
              )}
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
          <ShiftTab userId={currentUserId} shifts={shifts} onSave={handleSaveShifts} onRefresh={refresh} />
        ) : (
          <KpiTab userId={currentUserId} kpiRecords={kpiRecords} currentYearMonth={currentYearMonth} onSave={handleSaveKpi} onRefresh={refresh} />
        )}
      </main>

      <div className="fixed bottom-4 right-4 z-10 flex flex-col gap-2 rounded-xl border border-slate-300 bg-white p-3 shadow-lg">
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
            <h3 className="mb-4 text-sm font-semibold text-slate-800">PDF出力（請求書・実績レポート）</h3>
            <p className="mb-2 text-xs text-slate-600">ご自身のデータのみ出力できます。請求書（1枚目）と業務遂行実績報告書（2枚目以降）を1つのPDFで出力します。</p>
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
                  printMemberCombinedPdf(currentMember, effectiveMemberMonth, allRecords, allKpiRecords);
                }}
                className="rounded bg-slate-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-600"
              >
                PDFを出力（請求書・実績レポート）
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
