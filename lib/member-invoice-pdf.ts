import type { KpiRecord, Member, WorkRecord } from "@/lib/attendance";
import { buildInvoicePdfModelForMember } from "@/lib/invoice-html";
import { renderInvoicePdfBlobFromModel } from "@/lib/invoice-pdf-pdflib";

/**
 * メンバー・管理者共通の請求書 PDF（単体）。
 * pdf-lib + 埋め込み日本語フォントで描画し、html2canvas による文字化けを避ける。
 */
export async function renderMemberInvoicePdfBlob(
  member: Member,
  yearMonth: string,
  allRecords: WorkRecord[],
  allKpiRecords: KpiRecord[] = []
): Promise<Blob> {
  const model = buildInvoicePdfModelForMember(member, yearMonth, allRecords, allKpiRecords);
  return renderInvoicePdfBlobFromModel(model);
}
