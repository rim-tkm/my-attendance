import JSZip from "jszip";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { buildInvoiceBulkZipFileName, buildInvoiceCombinedPdfFileName } from "@/lib/invoice-html";
import { renderMemberCombinedPdfBlob } from "@/lib/member-combined-pdf";
import { preloadJpFontsForPdf } from "@/lib/invoice-pdf-pdflib";
import { loadKpiInDateRange, loadMembers, loadRecords } from "@/lib/supabase-data";

export const maxDuration = 300;

const YEAR_MONTH_RE = /^\d{4}-\d{2}$/;

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

function monthRangeFromYearMonth(yearMonth: string): { monthStart: string; monthEnd: string } {
  const [yStr, mStr] = yearMonth.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    monthStart: `${yStr}-${mStr}-01`,
    monthEnd: `${yStr}-${mStr}-${String(lastDay).padStart(2, "0")}`,
  };
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !isAdmin(session)) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON ボディが必要です" }, { status: 400 });
  }

  const yearMonth =
    typeof (body as { yearMonth?: unknown }).yearMonth === "string"
      ? (body as { yearMonth: string }).yearMonth.trim()
      : "";
  const memberIdsRaw = (body as { memberIds?: unknown }).memberIds;
  if (!YEAR_MONTH_RE.test(yearMonth)) {
    return NextResponse.json({ error: "yearMonth は YYYY-MM 形式で指定してください" }, { status: 400 });
  }
  if (!Array.isArray(memberIdsRaw) || memberIdsRaw.length === 0) {
    return NextResponse.json({ error: "memberIds を1件以上指定してください" }, { status: 400 });
  }
  const memberIds = memberIdsRaw.filter((id): id is string => typeof id === "string" && id.trim() !== "");
  if (memberIds.length === 0) {
    return NextResponse.json({ error: "memberIds が不正です" }, { status: 400 });
  }

  const members = await loadMembers();
  if (!members || members.length === 0) {
    return NextResponse.json({ error: "メンバー一覧の取得に失敗しました" }, { status: 500 });
  }

  const { monthStart, monthEnd } = monthRangeFromYearMonth(yearMonth);
  const [allRecords, allKpiRecords] = await Promise.all([
    loadRecords(),
    loadKpiInDateRange(monthStart, monthEnd),
  ]);

  try {
    await preloadJpFontsForPdf();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `PDF用フォントの読み込みに失敗しました: ${msg}` }, { status: 500 });
  }

  const zip = new JSZip();
  const errors: { memberId: string; message: string }[] = [];

  for (const memberId of memberIds) {
    const member = members.find((m) => m.id === memberId);
    if (!member) {
      errors.push({ memberId, message: "メンバーが見つかりません" });
      continue;
    }
    try {
      const blob = await renderMemberCombinedPdfBlob(member, yearMonth, allRecords, allKpiRecords);
      const buf = Buffer.from(await blob.arrayBuffer());
      zip.file(buildInvoiceCombinedPdfFileName(member, yearMonth), buf);
    } catch (e) {
      errors.push({
        memberId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (Object.keys(zip.files).length === 0) {
    return NextResponse.json(
      { error: "ZIP に含める PDF を1件も生成できませんでした", errors },
      { status: 500 }
    );
  }

  const zipBuf = await zip.generateAsync({ type: "nodebuffer" });
  const zipName = buildInvoiceBulkZipFileName(yearMonth);
  const headers = new Headers({
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`,
  });
  if (errors.length > 0) {
    headers.set("X-Invoice-Zip-Warnings", JSON.stringify(errors));
  }
  return new Response(new Uint8Array(zipBuf), { status: 200, headers });
}
