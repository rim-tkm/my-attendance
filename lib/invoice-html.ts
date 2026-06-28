import type { KpiRecord, Member, WorkRecord } from "@/lib/attendance";
import { DEFAULT_HOURLY_RATE, getRecordsForMonth, getRecordsForUser } from "@/lib/attendance";
import {
  calcInternInvoiceAmounts,
  getInternUnitRates,
  isInternMember,
  splitTaxInclusiveLineAmount,
  sumInternConfirmedAppsForMonth,
} from "@/lib/invoice-intern";
import { formatInvoiceRegistrationDisplayLine } from "@/lib/invoice-registration-number";

/** 請求書No.を [西暦4桁][月2桁][請求管理番号3桁] で生成（例: 202603001） */
export function getInvoiceNumber(yearMonth: string, managementNumber: string | null | undefined): string {
  const [y, m] = yearMonth.split("-");
  const year = (y ?? "").slice(0, 4);
  const month = (m ?? "").padStart(2, "0");
  const num = String(managementNumber ?? "0").replace(/\D/g, "").slice(-3);
  const padded = num.padStart(3, "0");
  return `${year}${month}${padded}`;
}

/** 対象月の翌月15日を支払期限として返す（例: 2026-03 → 2026/04/15） */
export function getPaymentDueDate(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const next = new Date(y, m, 15);
  const yy = next.getFullYear();
  const mm = String(next.getMonth() + 1).padStart(2, "0");
  const dd = String(next.getDate()).padStart(2, "0");
  return `${yy}/${mm}/${dd}`;
}

/** 委託料単価を税込として合計→小計・消費税を逆算（各ユーザーの時給 × 実稼働時間） */
export function calcInvoiceAmounts(
  totalMinutes: number,
  hourlyRateTaxInclusive: number
): { totalWithTax: number; subtotal: number; taxRate: number } {
  const totalWithTax = Math.round((totalMinutes / 60) * hourlyRateTaxInclusive);
  const subtotal = Math.floor(totalWithTax / 1.1);
  const taxRate = totalWithTax - subtotal;
  return { totalWithTax, subtotal, taxRate };
}

export function formatHoursForInvoice(totalMinutes: number): string {
  const h = totalMinutes / 60;
  return h % 1 === 0 ? String(h) : h.toFixed(1);
}

/** 請求書 PDF／HTML 共通の確定データ（計算結果・表示用文字列） */
export type InvoicePdfModel = {
  memberName: string;
  yearMonth: string;
  totalMinutes: number;
  hourlyRateTaxInclusive: number;
  subtotal: number;
  taxRate: number;
  totalWithTax: number;
  invoiceNo: string;
  paymentDueDate: string;
  postalCode: string;
  address: string;
  phoneNumber: string;
  bankName: string;
  branchName: string;
  accountType: string;
  accountNumber: string;
  accountHolder: string;
  /** 登録済みのときのみ「登録番号：T…」形式 */
  invoiceRegistrationLine?: string;
  monthLabel: string;
  periodLabel: string;
  hoursLabel: string;
  subjectLine: string;
  isIntern: boolean;
  /** 明細行（インターンは複数行、通常は1行） */
  detailLines: InvoicePdfDetailLine[];
};

export type InvoicePdfDetailLine = {
  description: string;
  quantity: string;
  unit: string;
  unitPriceTaxInclusive: number;
  subtotal: number;
  tax: number;
  total: number;
};

export function buildInvoicePdfModelForMember(
  member: Member,
  yearMonth: string,
  allRecords: WorkRecord[],
  allKpiRecords: KpiRecord[] = []
): InvoicePdfModel {
  const userRecords = getRecordsForMonth(getRecordsForUser(allRecords, member.id), yearMonth);
  const totalMinutes = userRecords.reduce((s, r) => s + r.durationMinutes, 0);
  const invoiceNo = getInvoiceNumber(yearMonth, member.invoiceNumber);
  const paymentDueDate = getPaymentDueDate(yearMonth);
  const [y, m] = yearMonth.split("-");
  const monthLabel = `${y}年${m}月`;
  const lastDay = new Date(Number(y), Number(m), 0).getDate();
  const periodLabel = `${y}年${m}月1日 - ${y}年${m}月${lastDay}日`;
  const intern = isInternMember(member);
  const invoiceRegistrationLine =
    formatInvoiceRegistrationDisplayLine(member.invoiceRegistrationNumber) ?? undefined;

  if (intern) {
    const totals = sumInternConfirmedAppsForMonth(allKpiRecords, member.id, yearMonth);
    const internRates = getInternUnitRates(member);
    const amounts = calcInternInvoiceAmounts(totals, internRates);
    const dmSplit = splitTaxInclusiveLineAmount(amounts.decisionAmount);
    const ndmSplit = splitTaxInclusiveLineAmount(amounts.nonDecisionAmount);
    const detailLines: InvoicePdfDetailLine[] = [];
    if (totals.decisionCount > 0) {
      detailLines.push({
        description: `${monthLabel}分 決裁者商談確定`,
        quantity: String(totals.decisionCount),
        unit: "件",
        unitPriceTaxInclusive: internRates.decisionMaker,
        subtotal: dmSplit.subtotal,
        tax: dmSplit.tax,
        total: dmSplit.total,
      });
    }
    if (totals.nonDecisionCount > 0) {
      detailLines.push({
        description: `${monthLabel}分 非決裁者商談確定`,
        quantity: String(totals.nonDecisionCount),
        unit: "件",
        unitPriceTaxInclusive: internRates.nonDecisionMaker,
        subtotal: ndmSplit.subtotal,
        tax: ndmSplit.tax,
        total: ndmSplit.total,
      });
    }
    if (detailLines.length === 0) {
      detailLines.push({
        description: `${monthLabel}分 成果報酬（確定数なし）`,
        quantity: "0",
        unit: "件",
        unitPriceTaxInclusive: 0,
        subtotal: 0,
        tax: 0,
        total: 0,
      });
    }
    return {
      memberName: member.name,
      yearMonth,
      totalMinutes,
      hourlyRateTaxInclusive: 0,
      subtotal: amounts.subtotal,
      taxRate: amounts.taxRate,
      totalWithTax: amounts.totalWithTax,
      invoiceNo,
      paymentDueDate,
      postalCode: member.postalCode ?? "",
      address: member.address ?? "",
      phoneNumber: member.phoneNumber ?? "",
      bankName: member.bankName ?? "",
      branchName: member.branchName ?? "",
      accountType: member.accountType ?? "普通",
      accountNumber: member.accountNumber ?? "",
      accountHolder: member.accountHolder ?? "",
      invoiceRegistrationLine,
      monthLabel,
      periodLabel,
      hoursLabel: "—",
      subjectLine: `${monthLabel}分の業務委託の請求書（成果報酬）`,
      isIntern: true,
      detailLines,
    };
  }

  const hourlyRateTaxInclusive = member.hourlyRate != null ? member.hourlyRate : DEFAULT_HOURLY_RATE;
  const { subtotal, taxRate, totalWithTax } = calcInvoiceAmounts(totalMinutes, hourlyRateTaxInclusive);
  const lineSplit = splitTaxInclusiveLineAmount(totalWithTax);
  return {
    memberName: member.name,
    yearMonth,
    totalMinutes,
    hourlyRateTaxInclusive,
    subtotal,
    taxRate,
    totalWithTax,
    invoiceNo,
    paymentDueDate,
    postalCode: member.postalCode ?? "",
    address: member.address ?? "",
    phoneNumber: member.phoneNumber ?? "",
    bankName: member.bankName ?? "",
    branchName: member.branchName ?? "",
    accountType: member.accountType ?? "普通",
    accountNumber: member.accountNumber ?? "",
    accountHolder: member.accountHolder ?? "",
    invoiceRegistrationLine,
    monthLabel,
    periodLabel,
    hoursLabel: formatHoursForInvoice(totalMinutes),
    subjectLine: `${monthLabel}分の業務委託の請求書`,
    isIntern: false,
    detailLines: [
      {
        description: `${monthLabel}分 業務委託`,
        quantity: formatHoursForInvoice(totalMinutes),
        unit: "時間",
        unitPriceTaxInclusive: hourlyRateTaxInclusive,
        subtotal: lineSplit.subtotal,
        tax: lineSplit.tax,
        total: lineSplit.total,
      },
    ],
  };
}

export function buildInvoiceBody(
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
  accountHolder: string,
  invoiceRegistrationLine?: string
): string {
  const [y, m] = yearMonth.split("-");
  const monthLabel = `${y}年${m}月`;
  const lastDay = new Date(Number(y), Number(m), 0).getDate();
  const periodLabel = `${y}年${m}月1日 - ${y}年${m}月${lastDay}日`;
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
        ${invoiceRegistrationLine ? `<div>${invoiceRegistrationLine}</div>` : ""}
      </div>
    </div>
  </div>`;
}

/** 印刷プレビュー用 HTML のオプション（ブラウザのシステム／Web フォント） */
export type InvoiceHtmlBuildOptions = {
  embedWebFontsForPdf?: boolean;
};

const GOOGLE_NOTO_SANS_JP_LINKS = `<link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet"/>`;

function invoiceBodyFontFamily(embedPdf: boolean): string {
  return embedPdf
    ? '"Noto Sans JP","Hiragino Sans","Hiragino Kaku Gothic ProN","Meiryo",sans-serif'
    : '"Hiragino Sans","Hiragino Kaku Gothic ProN","Meiryo",sans-serif';
}

export function buildInvoiceHtml(
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
  phoneNumber?: string,
  buildOptions?: InvoiceHtmlBuildOptions
): string {
  const embedPdf = buildOptions?.embedWebFontsForPdf === true;
  const fontFamily = invoiceBodyFontFamily(embedPdf);
  const body = buildInvoiceBody(
    memberName,
    yearMonth,
    totalMinutes,
    hourlyRate,
    subtotal,
    taxRate,
    totalWithTax,
    invoiceNo,
    paymentDueDate,
    postalCode,
    address,
    phoneNumber ?? "",
    bankName,
    branchName,
    accountType,
    accountNumber,
    accountHolder
  );
  const style = `@page{size:A4;margin:16mm}body{margin:0;padding:0;font-family:${fontFamily};font-size:10pt;color:#1e293b}
.invoice-sheet{padding:16px;font-family:${fontFamily}}.invoice-header-row{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px}
.invoice-addressee{font-size:11pt;font-weight:bold}.invoice-sender-block{background:#fef9c3;padding:10px 12px;font-size:9pt;line-height:1.6;min-width:180px}
.sender-line.sender-name{font-weight:bold;margin:4px 0}.invoice-title{font-size:16pt;font-weight:bold;text-align:center;margin:12px 0 16px;border-bottom:2px solid #1e293b;padding-bottom:8px}
.invoice-total-bar{display:flex;align-items:center;margin-bottom:14px;border:1px solid #1e293b}.invoice-total-label{background:#1e293b;color:#fff;padding:10px 16px;font-weight:bold;font-size:11pt}
.invoice-total-amount{margin-left:16px;font-size:14pt;font-weight:bold}.invoice-info-table{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:9pt}.invoice-info-table th,.invoice-info-table td{border:1px solid #94a3b8;padding:6px 10px}.invoice-info-table th{background:#f1f5f9;width:90px}
.invoice-detail-table{width:100%;border-collapse:collapse;font-size:9pt}.invoice-detail-table th,.invoice-detail-table td{border:1px solid #94a3b8;padding:6px 8px}.invoice-detail-table th{background:#f1f5f9}.invoice-detail-table .number{text-align:right;font-variant-numeric:tabular-nums}
.invoice-detail-subtotal{background:#f8fafc;font-weight:600}.invoice-summary-block{margin-top:12px;margin-bottom:16px;border:1px solid #94a3b8;padding:10px 14px;max-width:320px;margin-left:auto}
.invoice-summary-row{display:flex;justify-content:space-between;padding:4px 0}.invoice-summary-total{border-top:1px solid #64748b;margin-top:6px;padding-top:8px;font-weight:bold;font-size:11pt}
.invoice-section{margin-top:14px}.invoice-section-title{font-size:10pt;font-weight:bold;margin-bottom:6px}.bank-block{background:#f8fafc;padding:12px;border:1px solid #e2e8f0;font-size:9pt;border-radius:2px}`;
  const fontHead = embedPdf ? GOOGLE_NOTO_SANS_JP_LINKS : "";
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"/>${fontHead}<title>請求書</title><style>${style}</style></head><body>${body}</body></html>`;
}

/** 単一メンバー・対象月の請求書フル HTML（印刷プレビュー用） */
export function buildInvoiceHtmlForMember(
  member: Member,
  yearMonth: string,
  allRecords: WorkRecord[],
  allKpiRecords: KpiRecord[] = [],
  buildOptions?: InvoiceHtmlBuildOptions
): string {
  const model = buildInvoicePdfModelForMember(member, yearMonth, allRecords, allKpiRecords);
  return buildInvoiceHtmlFromModel(model, buildOptions);
}

/** 請求書 PDF モデルから印刷用 HTML（インターンは成果報酬明細） */
export function buildInvoiceHtmlFromModel(
  model: InvoicePdfModel,
  buildOptions?: InvoiceHtmlBuildOptions
): string {
  const embedPdf = buildOptions?.embedWebFontsForPdf === true;
  const fontFamily = invoiceBodyFontFamily(embedPdf);
  const yen = (n: number) => n.toLocaleString("ja-JP");
  const detailRows = model.detailLines
    .map((line) => {
      if (model.isIntern) {
        return `<tr>
          <td>${line.description}</td>
          <td class="number">${line.quantity}</td>
          <td>${line.unit}</td>
          <td class="number">¥${yen(line.tax)}</td>
          <td class="number">¥${yen(line.subtotal)}</td>
          <td class="number">¥${yen(line.total)}</td>
        </tr>`;
      }
      return `<tr>
          <td>${line.description}</td>
          <td class="number">${line.quantity}</td>
          <td>${line.unit}</td>
          <td class="number">¥${yen(line.unitPriceTaxInclusive)}</td>
          <td class="number">¥${yen(line.tax)}</td>
          <td class="number">¥${yen(line.subtotal)}</td>
          <td class="number">¥${yen(line.total)}</td>
        </tr>`;
    })
    .join("");
  const detailHead = model.isIntern
    ? "<th>摘要</th><th>数量</th><th>単位</th><th>消費税</th><th>金額(税抜)</th><th>金額(税込)</th>"
    : "<th>摘要</th><th>数量</th><th>単位</th><th>単価</th><th>消費税</th><th>金額(税抜)</th><th>金額(税込)</th>";
  const subColspan = model.isIntern ? 3 : 4;
  const body = `
  <div class="invoice-sheet">
    <div class="invoice-header-row">
      <div class="invoice-addressee">株式会社RIM 御中</div>
      <div class="invoice-sender-block">
        <div class="sender-line">${model.postalCode ? `〒${model.postalCode}` : ""} ${model.address || ""}</div>
        <div class="sender-line sender-name">${model.memberName}</div>
        <div class="sender-line">${model.phoneNumber ? `TEL: ${model.phoneNumber}` : ""}</div>
      </div>
    </div>
    <h1 class="invoice-title">請求書</h1>
    <div class="invoice-total-bar">
      <span class="invoice-total-label">合計</span>
      <span class="invoice-total-amount">${yen(model.totalWithTax)} 円 (税込)</span>
    </div>
    <table class="invoice-info-table">
      <tr><th>請求書No.</th><td>${model.invoiceNo}</td><th>件名</th><td>${model.subjectLine}</td></tr>
      <tr><th>請求期間</th><td colspan="3">${model.periodLabel}</td></tr>
      <tr><th>支払期限</th><td colspan="3">${model.paymentDueDate}</td></tr>
    </table>
    <table class="invoice-detail-table">
      <thead><tr>${detailHead}</tr></thead>
      <tbody>
        ${detailRows}
        <tr class="invoice-detail-subtotal">
          <td>小計</td>${"<td></td>".repeat(subColspan)}
          <td class="number">¥${yen(model.taxRate)}</td>
          <td class="number">¥${yen(model.subtotal)}</td>
          <td class="number">¥${yen(model.totalWithTax)}</td>
        </tr>
      </tbody>
    </table>
    <div class="invoice-summary-block">
      <div class="invoice-summary-row"><span class="invoice-summary-label">小計（税抜）</span><span class="invoice-summary-value">¥${yen(model.subtotal)}</span></div>
      <div class="invoice-summary-row"><span class="invoice-summary-label">消費税（10%）</span><span class="invoice-summary-value">¥${yen(model.taxRate)}</span></div>
      <div class="invoice-summary-row invoice-summary-total"><span class="invoice-summary-label">合計（税込）</span><span class="invoice-summary-value">¥${yen(model.totalWithTax)}</span></div>
    </div>
    <div class="invoice-section">
      <div class="invoice-section-title">お振込先</div>
      <div class="bank-block">
        <div>${model.postalCode ? `〒${model.postalCode}` : ""} ${model.address || "（未登録）"}</div>
        <div>${model.bankName || "（未登録）"} ${model.branchName ? ` ${model.branchName}` : ""} ${model.accountType || ""} ${model.accountNumber || ""}</div>
        <div>口座名義: ${model.accountHolder || "（未登録）"}</div>
        ${model.invoiceRegistrationLine ? `<div>${model.invoiceRegistrationLine}</div>` : ""}
      </div>
    </div>
  </div>`;
  const style = `@page{size:A4;margin:16mm}body{margin:0;padding:0;font-family:${fontFamily};font-size:10pt;color:#1e293b}
.invoice-sheet{padding:16px;font-family:${fontFamily}}.invoice-header-row{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px}
.invoice-addressee{font-size:11pt;font-weight:bold}.invoice-sender-block{background:#fef9c3;padding:10px 12px;font-size:9pt;line-height:1.6;min-width:180px}
.sender-line.sender-name{font-weight:bold;margin:4px 0}.invoice-title{font-size:16pt;font-weight:bold;text-align:center;margin:12px 0 16px;border-bottom:2px solid #1e293b;padding-bottom:8px}
.invoice-total-bar{display:flex;align-items:center;margin-bottom:14px;border:1px solid #1e293b}.invoice-total-label{background:#1e293b;color:#fff;padding:10px 16px;font-weight:bold;font-size:11pt}
.invoice-total-amount{margin-left:16px;font-size:14pt;font-weight:bold}.invoice-info-table{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:9pt}.invoice-info-table th,.invoice-info-table td{border:1px solid #94a3b8;padding:6px 10px}.invoice-info-table th{background:#f1f5f9;width:90px}
.invoice-detail-table{width:100%;border-collapse:collapse;font-size:9pt}.invoice-detail-table th,.invoice-detail-table td{border:1px solid #94a3b8;padding:6px 8px}.invoice-detail-table th{background:#f1f5f9}.invoice-detail-table .number{text-align:right;font-variant-numeric:tabular-nums}
.invoice-detail-subtotal{background:#f8fafc;font-weight:600}.invoice-summary-block{margin-top:12px;margin-bottom:16px;border:1px solid #94a3b8;padding:10px 14px;max-width:320px;margin-left:auto}
.invoice-summary-row{display:flex;justify-content:space-between;padding:4px 0}.invoice-summary-total{border-top:1px solid #64748b;margin-top:6px;padding-top:8px;font-weight:bold;font-size:11pt}
.invoice-section{margin-top:14px}.invoice-section-title{font-size:10pt;font-weight:bold;margin-bottom:6px}.bank-block{background:#f8fafc;padding:12px;border:1px solid #e2e8f0;font-size:9pt;border-radius:2px}`;
  const fontHead = embedPdf ? GOOGLE_NOTO_SANS_JP_LINKS : "";
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"/>${fontHead}<title>請求書</title><style>${style}</style></head><body>${body}</body></html>`;
}

export function yearMonthToYyyymmFilePrefix(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  return `${y}${(m ?? "").padStart(2, "0")}`;
}

export function sanitizeInvoiceDownloadFileBase(name: string): string {
  const s = name.replace(/[\\/:*?"<>|\r\n]/g, "_").trim();
  return s || "氏名";
}

/**
 * 請求書＋実績の結合 PDF 用の統一ファイル名。
 * 【請求書】氏名_YYYY年MM月分_請求書No.pdf（請求書No. は {@link getInvoiceNumber} と同一）
 *
 * ブラウザの `<a download>` は UTF-8 のファイル名をそのまま渡す（encodeURIComponent は不可）。
 */
export function buildInvoiceCombinedPdfFileName(member: Member, yearMonth: string): string {
  const invoiceNo = getInvoiceNumber(yearMonth, member.invoiceNumber);
  const safeName = sanitizeInvoiceDownloadFileBase(member.name);
  const [y, mo] = yearMonth.split("-");
  const yy = (y ?? "").slice(0, 4);
  const mm = String(mo ?? "").padStart(2, "0");
  const monthPart = `${yy}年${mm}月分`;
  return `【請求書】${safeName}_${monthPart}_${invoiceNo}.pdf`;
}

/** 請求書一括 ZIP（アーカイブ本体）のファイル名 */
export function buildInvoiceBulkZipFileName(yearMonth: string): string {
  return `${yearMonthToYyyymmFilePrefix(yearMonth)}_請求書_一括.zip`;
}
