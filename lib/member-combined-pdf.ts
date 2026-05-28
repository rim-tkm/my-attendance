import { PDFDocument } from "pdf-lib";

import type { KpiRecord, Member, WorkRecord } from "@/lib/attendance";
import { buildInvoicePdfModelForMember } from "@/lib/invoice-html";
import {
  appendInvoicePagesToPdfDocument,
  embedJpFontsForPdfDocument,
  preloadJpFontsForPdf,
} from "@/lib/invoice-pdf-pdflib";
import { buildReportPdfModelForMember } from "@/lib/report-pdf-model";
import { appendReportPagesToPdfDocument } from "@/lib/report-pdf-pdflib";

/**
 * メンバー「PDF（請求書・実績）」と管理者一括 ZIP 兼用の、同一内容のマルチページ PDF。
 * 1 ページ目: 請求書（pdf-lib）／2 ページ目以降: 実績報告（pdf-lib）
 *
 * 請求・実績を別 PDF にして copyPages で結合すると、Preview 等で日本語が文字化けすることがあるため、
 * フォントを 1 回だけ embed した単一 PDFDocument に連続 append する。
 */
export async function renderMemberCombinedPdfBlob(
  member: Member,
  yearMonth: string,
  allRecords: WorkRecord[],
  allKpiRecords: KpiRecord[]
): Promise<Blob> {
  await preloadJpFontsForPdf();
  const invModel = buildInvoicePdfModelForMember(member, yearMonth, allRecords, allKpiRecords);
  const repModel = buildReportPdfModelForMember(member, yearMonth, allRecords, allKpiRecords);
  const pdfDoc = await PDFDocument.create();
  const fonts = await embedJpFontsForPdfDocument(pdfDoc);
  await appendInvoicePagesToPdfDocument(pdfDoc, fonts, invModel);
  await appendReportPagesToPdfDocument(pdfDoc, fonts, repModel);
  return new Blob([new Uint8Array(await pdfDoc.save())], { type: "application/pdf" });
}
