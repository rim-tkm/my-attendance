import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getLastMonthYearMonthJst, getTodayJstDateString } from "@/lib/export-schedule";
import { buildInvoiceCombinedPdfFileName } from "@/lib/invoice-html";
import { getLastJpFontLoadLabel, preloadJpFontsForPdf } from "@/lib/invoice-pdf-pdflib";
import { renderMemberCombinedPdfBlob } from "@/lib/member-combined-pdf";
import { loadKpiInDateRange, loadMembers, loadRecords } from "@/lib/supabase-data";

export const maxDuration = 60;

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
  const sessionUserId = (session?.user as { id?: string } | undefined)?.id;
  if (!session?.user || !sessionUserId) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
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
  const memberIdRaw = (body as { memberId?: unknown }).memberId;
  const admin = isAdmin(session);

  if (!YEAR_MONTH_RE.test(yearMonth)) {
    return NextResponse.json({ error: "yearMonth は YYYY-MM 形式で指定してください" }, { status: 400 });
  }

  const targetMemberId =
    admin && typeof memberIdRaw === "string" && memberIdRaw.trim() !== ""
      ? memberIdRaw.trim()
      : sessionUserId;

  if (!admin && targetMemberId !== sessionUserId) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  const maxMemberMonth = getLastMonthYearMonthJst();
  const maxAdminMonth = getTodayJstDateString().slice(0, 7);
  const maxAllowedMonth = admin ? maxAdminMonth : maxMemberMonth;
  if (yearMonth > maxAllowedMonth) {
    return NextResponse.json(
      {
        error: admin
          ? `対象月は ${maxAdminMonth} 以前を指定してください`
          : `前月分の PDF は翌月1日から出力できます（${maxMemberMonth} 以前を指定してください）`,
      },
      { status: 400 }
    );
  }

  const members = await loadMembers();
  if (!members || members.length === 0) {
    return NextResponse.json({ error: "メンバー一覧の取得に失敗しました" }, { status: 500 });
  }

  const member = members.find((m) => m.id === targetMemberId);
  if (!member) {
    return NextResponse.json({ error: "メンバーが見つかりません" }, { status: 404 });
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

  try {
    const blob = await renderMemberCombinedPdfBlob(member, yearMonth, allRecords, allKpiRecords);
    const buf = Buffer.from(await blob.arrayBuffer());
    const fileName = buildInvoiceCombinedPdfFileName(member, yearMonth);
    const headers = new Headers({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
    const fontLabel = getLastJpFontLoadLabel();
    if (fontLabel) headers.set("X-Invoice-Pdf-Font", fontLabel);
    return new Response(new Uint8Array(buf), { status: 200, headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `PDF生成に失敗しました: ${msg}` }, { status: 500 });
  }
}
