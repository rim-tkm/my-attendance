import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  getKpiForMonth,
  getKpiForUser,
  getRecordsForMonth,
  getRecordsForUser,
  type Member,
} from "@/lib/attendance";
import { buildInvoicePdfModelForMember } from "@/lib/invoice-html";
import { renderInvoicePdfBlobFromModel } from "@/lib/invoice-pdf-pdflib";
import { loadKpiInDateRange, loadMembers, loadRecords } from "@/lib/supabase-data";

/** このルートで必須の環境変数 */
const INVOICE_GAS_WEBHOOK_URL = process.env.INVOICE_GAS_WEBHOOK_URL?.trim();
const INVOICE_GAS_TOKEN = process.env.INVOICE_GAS_TOKEN?.trim();

const YEAR_MONTH_RE = /^\d{4}-\d{2}$/;

export type InvoiceBatchExportRow = {
  clientName: string;
  paymentDate: string;
  country: "JAPAN";
  invoiceNo: string;
  invoiceDate: string;
  amount: number;
  pdfBase64: string;
  fileName: string;
};

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

function missingRequiredEnvResponse(): NextResponse | null {
  const missing: string[] = [];
  if (!INVOICE_GAS_WEBHOOK_URL) missing.push("INVOICE_GAS_WEBHOOK_URL");
  if (!INVOICE_GAS_TOKEN) missing.push("INVOICE_GAS_TOKEN");
  if (missing.length === 0) return null;
  return NextResponse.json({ error: `環境変数が未設定です: ${missing.join(", ")}` }, { status: 500 });
}

/** 対象月の月初・月末（YYYY-MM-DD） */
function monthRangeFromYearMonth(yearMonth: string): { monthStart: string; monthEnd: string } {
  const [yStr, mStr] = yearMonth.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const lastDay = new Date(y, m, 0).getDate();
  const monthStart = `${yStr}-${mStr}-01`;
  const monthEnd = `${yStr}-${mStr}-${String(lastDay).padStart(2, "0")}`;
  return { monthStart, monthEnd };
}

/** YYYY/M/D（月・日はゼロ埋めしない） */
function formatSlashDate(y: number, month: number, day: number): string {
  return `${y}/${month}/${day}`;
}

function paymentDateForYearMonth(yearMonth: string): string {
  const [yStr, mStr] = yearMonth.split("-");
  return formatSlashDate(Number(yStr), Number(mStr), 15);
}

function invoiceDateForYearMonth(yearMonth: string): string {
  const [yStr, mStr] = yearMonth.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const lastDay = new Date(y, m, 0).getDate();
  return formatSlashDate(y, m, lastDay);
}

/** 行データを GAS Webhook へ POST（Drive アップロードは GAS 側で実施） */
async function postToGas(yearMonth: string, rows: InvoiceBatchExportRow[]): Promise<unknown> {
  const res = await fetch(INVOICE_GAS_WEBHOOK_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: INVOICE_GAS_TOKEN, yearMonth, rows }),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`GAS レスポンスが JSON ではありません (${res.status}): ${text.slice(0, 500)}`);
  }
  if (!res.ok) {
    throw new Error(`GAS Webhook エラー (${res.status}): ${text.slice(0, 500)}`);
  }
  return json;
}

function memberHasMonthActivity(
  member: Member,
  yearMonth: string,
  allRecords: Awaited<ReturnType<typeof loadRecords>>,
  allKpiRecords: Awaited<ReturnType<typeof loadKpiInDateRange>>
): boolean {
  const userRecords = getRecordsForMonth(getRecordsForUser(allRecords, member.id), yearMonth);
  const userKpi = getKpiForMonth(getKpiForUser(allKpiRecords, member.id), yearMonth);
  return userRecords.length > 0 || userKpi.length > 0;
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !isAdmin(session)) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  const envError = missingRequiredEnvResponse();
  if (envError) return envError;

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
  if (!YEAR_MONTH_RE.test(yearMonth)) {
    return NextResponse.json({ error: "yearMonth は YYYY-MM 形式で指定してください" }, { status: 400 });
  }

  const { monthStart, monthEnd } = monthRangeFromYearMonth(yearMonth);

  const members = await loadMembers();
  if (!members || members.length === 0) {
    return NextResponse.json({ error: "メンバー一覧の取得に失敗しました" }, { status: 500 });
  }

  const [allRecords, allKpiRecords] = await Promise.all([
    loadRecords(),
    loadKpiInDateRange(monthStart, monthEnd),
  ]);

  const rows: InvoiceBatchExportRow[] = [];
  const errors: { memberId: string; memberName: string; message: string }[] = [];

  for (const member of members) {
    if (member.isActive === false) continue;

    try {
      if (!memberHasMonthActivity(member, yearMonth, allRecords, allKpiRecords)) {
        continue;
      }

      const model = buildInvoicePdfModelForMember(member, yearMonth, allRecords, allKpiRecords);
      if (model.totalWithTax === 0) {
        continue;
      }

      const pdfBlob = await renderInvoicePdfBlobFromModel(model);
      const buf = Buffer.from(await pdfBlob.arrayBuffer());
      const pdfBase64 = buf.toString("base64");
      const fileName = `請求書_${member.name}_${yearMonth}.pdf`;

      rows.push({
        clientName: member.name,
        paymentDate: paymentDateForYearMonth(yearMonth),
        country: "JAPAN",
        invoiceNo: member.invoiceNumber ?? "",
        invoiceDate: invoiceDateForYearMonth(yearMonth),
        amount: model.totalWithTax,
        pdfBase64,
        fileName,
      });
    } catch (err) {
      errors.push({
        memberId: member.id,
        memberName: member.name,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let gasResult: unknown = null;
  if (rows.length > 0) {
    try {
      gasResult = await postToGas(yearMonth, rows);
    } catch (err) {
      return NextResponse.json(
        {
          ok: false,
          count: rows.length,
          errors,
          gasError: err instanceof Error ? err.message : String(err),
        },
        { status: 502 }
      );
    }
  }

  return NextResponse.json({
    ok: true,
    count: rows.length,
    gasResult,
    ...(errors.length > 0 ? { errors } : {}),
  });
}
