import {
  getKpiForMonth,
  getKpiForUser,
  getRecordsForMonth,
  getRecordsForUser,
  type KpiRecord,
  type Member,
  type WorkRecord,
} from "@/lib/attendance";
import { buildInvoicePdfModelForMember } from "@/lib/invoice-html";

export type InvoiceBatchExportRow = {
  clientName: string;
  paymentDate: string;
  country: "JAPAN";
  invoiceNo: string;
  invoiceDate: string;
  amount: number;
  fileName: string;
  /** Drive 直アップロード時は省略（GAS は driveFileId を参照） */
  pdfBase64?: string;
  /** アプリ側 Drive 直アップロード済み（推奨） */
  driveFileId?: string;
  driveViewUrl?: string;
  /** GAS 側検証用（任意） */
  pdfByteLength?: number;
};

export const INVOICE_BATCH_YEAR_MONTH_RE = /^\d{4}-\d{2}$/;

/** YYYY/M/D（月・日はゼロ埋めしない） */
export function formatSlashDate(y: number, month: number, day: number): string {
  return `${y}/${month}/${day}`;
}

/** 一括記帳スプレッドシート「入金日」: 請求対象月の翌月15日（例: 2026-06 → 2026/7/15） */
export function paymentDateForYearMonth(yearMonth: string): string {
  const [yStr, mStr] = yearMonth.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const next = new Date(y, m, 15);
  return formatSlashDate(next.getFullYear(), next.getMonth() + 1, next.getDate());
}

export function invoiceDateForYearMonth(yearMonth: string): string {
  const [yStr, mStr] = yearMonth.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const lastDay = new Date(y, m, 0).getDate();
  return formatSlashDate(y, m, lastDay);
}

export function invoiceBatchExportFileName(memberName: string, yearMonth: string): string {
  return `請求書_${memberName}_${yearMonth}.pdf`;
}

/** 範囲指定の並び順を毎回同じにする（名前昇順 → id 昇順） */
export function sortMembersForBatchExport(members: Member[]): Member[] {
  return [...members].sort((a, b) => {
    const byName = a.name.localeCompare(b.name, "ja");
    if (byName !== 0) return byName;
    return a.id.localeCompare(b.id);
  });
}

export function parsePositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    return Number.isInteger(n) && n >= 1 ? n : null;
  }
  return null;
}

/** startIndex/endIndex（1始まり・両端含む）。未指定なら全員 */
export function resolveMemberRange(
  body: unknown,
  totalCount: number
):
  | { ok: true; startIndex: number; endIndex: number; rangeSpecified: boolean }
  | { ok: false; error: string } {
  const raw = body as { startIndex?: unknown; endIndex?: unknown };
  const hasStart = raw.startIndex !== undefined && raw.startIndex !== null;
  const hasEnd = raw.endIndex !== undefined && raw.endIndex !== null;

  if (!hasStart && !hasEnd) {
    if (totalCount === 0) {
      return { ok: true, startIndex: 1, endIndex: 0, rangeSpecified: false };
    }
    return { ok: true, startIndex: 1, endIndex: totalCount, rangeSpecified: false };
  }

  if (!hasStart || !hasEnd) {
    return { ok: false, error: "startIndex と endIndex は両方指定するか、両方省略してください" };
  }

  const startIndex = parsePositiveInt(raw.startIndex);
  const endIndex = parsePositiveInt(raw.endIndex);
  if (startIndex == null || endIndex == null) {
    return { ok: false, error: "startIndex と endIndex は 1 以上の整数で指定してください" };
  }
  if (startIndex > endIndex) {
    return { ok: false, error: "startIndex は endIndex 以下にしてください" };
  }
  if (totalCount > 0 && startIndex > totalCount) {
    return { ok: false, error: `startIndex が範囲外です（全 ${totalCount} 人）` };
  }

  return {
    ok: true,
    startIndex,
    endIndex: Math.min(endIndex, totalCount),
    rangeSpecified: true,
  };
}

export function memberHasMonthActivity(
  member: Member,
  yearMonth: string,
  allRecords: WorkRecord[],
  allKpiRecords: KpiRecord[]
): boolean {
  const userRecords = getRecordsForMonth(getRecordsForUser(allRecords, member.id), yearMonth);
  const userKpi = getKpiForMonth(getKpiForUser(allKpiRecords, member.id), yearMonth);
  return userRecords.length > 0 || userKpi.length > 0;
}

export function buildInvoiceBatchExportRow(
  member: Member,
  yearMonth: string,
  allRecords: WorkRecord[],
  allKpiRecords: KpiRecord[],
  pdfBase64: string
): InvoiceBatchExportRow {
  const model = buildInvoicePdfModelForMember(member, yearMonth, allRecords, allKpiRecords);
  return {
    clientName: member.name,
    paymentDate: paymentDateForYearMonth(yearMonth),
    country: "JAPAN",
    invoiceNo: model.invoiceNo,
    invoiceDate: invoiceDateForYearMonth(yearMonth),
    amount: model.totalWithTax,
    pdfBase64,
    fileName: invoiceBatchExportFileName(member.name, yearMonth),
  };
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("PDF の base64 変換に失敗しました"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("PDF の base64 変換に失敗しました"));
    reader.readAsDataURL(blob);
  });
}

/** base64 が PDF バイナリ（%PDF）か簡易検証 */
export function isValidPdfBase64(pdfBase64: string): boolean {
  if (typeof pdfBase64 !== "string" || pdfBase64.length < 100) return false;
  try {
    if (typeof window === "undefined") {
      const buf = Buffer.from(pdfBase64.slice(0, 48), "base64");
      return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
    }
    return atob(pdfBase64.slice(0, 24)).startsWith("%PDF");
  } catch {
    return false;
  }
}

export function coerceInvoiceBatchExportRows(raw: unknown): InvoiceBatchExportRow[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: InvoiceBatchExportRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const o = item as Record<string, unknown>;
    if (typeof o.clientName !== "string") return null;
    if (typeof o.paymentDate !== "string") return null;
    if (o.country !== "JAPAN") return null;
    if (typeof o.invoiceNo !== "string") return null;
    if (typeof o.invoiceDate !== "string") return null;
    if (typeof o.amount !== "number" || !Number.isFinite(o.amount)) return null;
    if (typeof o.fileName !== "string" || o.fileName.trim() === "") return null;
    const pdfBase64 = typeof o.pdfBase64 === "string" ? o.pdfBase64 : undefined;
    const driveFileId = typeof o.driveFileId === "string" ? o.driveFileId : undefined;
    if (!driveFileId && (!pdfBase64 || !isValidPdfBase64(pdfBase64))) return null;
    out.push({
      clientName: o.clientName,
      paymentDate: o.paymentDate,
      country: "JAPAN",
      invoiceNo: o.invoiceNo,
      invoiceDate: o.invoiceDate,
      amount: o.amount,
      fileName: o.fileName,
      ...(pdfBase64 ? { pdfBase64 } : {}),
      ...(driveFileId ? { driveFileId } : {}),
      ...(typeof o.driveViewUrl === "string" ? { driveViewUrl: o.driveViewUrl } : {}),
      ...(typeof o.pdfByteLength === "number" ? { pdfByteLength: o.pdfByteLength } : {}),
    });
  }
  return out;
}
