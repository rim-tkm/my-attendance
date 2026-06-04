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

export const maxDuration = 300;

/**
 * 1回の GAS POST に含めるメンバー数。
 * GAS 側の Drive 保存が重いため 1 人ずつ送信（1 = 1人1POST）。
 * 人数が多いと maxDuration 内に全員終わらない場合があり、その場合は途中まで記帳済み・残りは再実行で続きから追記される（GAS は追記方式）。
 */
const CHUNK_SIZE = 1;

/** GAS Webhook への POST 待ち時間上限（ms）。Drive 保存に余裕を持たせる */
const GAS_POST_TIMEOUT_MS = 60_000;

const LOG_PREFIX = "[invoice-batch-export]";
const DEBUG_PREFIX = "[invoice-debug]";

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

type BatchError = { memberId: string; memberName: string; message: string };

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

function chunkMembers<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function gasInsertedCount(gasResult: unknown): number {
  if (gasResult && typeof gasResult === "object" && "inserted" in gasResult) {
    const n = Number((gasResult as { inserted: unknown }).inserted);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function isBillableMember(
  member: Member,
  yearMonth: string,
  allRecords: Awaited<ReturnType<typeof loadRecords>>,
  allKpiRecords: Awaited<ReturnType<typeof loadKpiInDateRange>>
): boolean {
  if (!memberHasMonthActivity(member, yearMonth, allRecords, allKpiRecords)) {
    return false;
  }
  const model = buildInvoicePdfModelForMember(member, yearMonth, allRecords, allKpiRecords);
  return model.totalWithTax > 0;
}

/** 行データを GAS Webhook へ POST（Drive アップロードは GAS 側で実施） */
async function postToGas(yearMonth: string, rows: InvoiceBatchExportRow[]): Promise<unknown> {
  console.log(`${LOG_PREFIX} GASへPOST開始: yearMonth=${yearMonth} rows=${rows.length}`);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GAS_POST_TIMEOUT_MS);

  try {
    const res = await fetch(INVOICE_GAS_WEBHOOK_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: INVOICE_GAS_TOKEN, yearMonth, rows }),
      signal: controller.signal,
    });
    const text = await res.text();
    const elapsed = Date.now() - started;
    console.log(`${LOG_PREFIX} GAS応答: status=${res.status} 所要${elapsed}ms`);

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
  } catch (err) {
    const elapsed = Date.now() - started;
    if (err instanceof Error && err.name === "AbortError") {
      console.log(`${LOG_PREFIX} GAS応答: タイムアウト(${GAS_POST_TIMEOUT_MS}ms) 所要${elapsed}ms`);
      throw new Error(`GAS POST が ${GAS_POST_TIMEOUT_MS / 1000} 秒以内に応答しませんでした`);
    }
    console.log(`${LOG_PREFIX} GAS応答: エラー 所要${elapsed}ms`, err);
    throw err;
  } finally {
    clearTimeout(timer);
  }
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

/** 請求対象0件の原因切り分け用（ロジック変更なし・診断ログのみ） */
function logInvoiceDebugDiagnostics(
  yearMonth: string,
  monthStart: string,
  monthEnd: string,
  members: Member[],
  allRecords: Awaited<ReturnType<typeof loadRecords>>,
  allKpiRecords: Awaited<ReturnType<typeof loadKpiInDateRange>>
): void {
  console.log(`${DEBUG_PREFIX} loadRecords 件数: ${allRecords.length}`);
  console.log(`${DEBUG_PREFIX} yearMonth=${yearMonth}（getRecordsForMonth / getKpiForMonth の比較に使用）`);
  console.log(`${DEBUG_PREFIX} loadKpiInDateRange 引数: monthStart=${monthStart} monthEnd=${monthEnd}`);
  console.log(`${DEBUG_PREFIX} loadKpiInDateRange 件数: ${allKpiRecords.length}`);

  if (allRecords.length > 0) {
    console.log(`${DEBUG_PREFIX} WorkRecord サンプル(先頭1件):`, JSON.stringify(allRecords[0]));
    const dateSamples = Array.from(new Set(allRecords.slice(0, 30).map((r) => r.date)));
    console.log(`${DEBUG_PREFIX} WorkRecord.date サンプル(先頭30件から重複除去): ${JSON.stringify(dateSamples)}`);
  } else {
    console.log(`${DEBUG_PREFIX} WorkRecord サンプル: 0件（loadRecords が空。Supabase 未接続 or attendance テーブル空の可能性）`);
  }

  const monthRecordsAllUsers = getRecordsForMonth(allRecords, yearMonth);
  console.log(
    `${DEBUG_PREFIX} getRecordsForMonth(allRecords, "${yearMonth}") 件数: ${monthRecordsAllUsers.length}（全ユーザー合計・date.startsWith("${yearMonth}") 一致）`
  );
  if (allRecords.length > 0 && monthRecordsAllUsers.length === 0) {
    const foreignDates = Array.from(new Set(allRecords.map((r) => r.date))).slice(0, 10);
    console.log(
      `${DEBUG_PREFIX} ⚠ yearMonth "${yearMonth}" に一致する date が0件。DB上の date 値サンプル(最大10種): ${JSON.stringify(foreignDates)}`
    );
    console.log(
      `${DEBUG_PREFIX} ⚠ getRecordsForMonth は r.date.startsWith("${yearMonth}") のみ。形式が "2026/5/1" 等だと全件不一致になります`
    );
  }

  if (allKpiRecords.length > 0) {
    console.log(`${DEBUG_PREFIX} KPI サンプル(先頭1件):`, JSON.stringify(allKpiRecords[0]));
    const kpiDateSamples = Array.from(new Set(allKpiRecords.slice(0, 10).map((k) => k.date)));
    console.log(`${DEBUG_PREFIX} KPI.date サンプル: ${JSON.stringify(kpiDateSamples)}`);
  }

  const activeMembers = members.filter((m) => m.isActive !== false);
  console.log(`${DEBUG_PREFIX} アクティブメンバー数: ${activeMembers.length} / 全${members.length}`);

  const debugTarget =
    activeMembers.find((m) => getRecordsForUser(allRecords, m.id).length > 0) ?? activeMembers[0] ?? members[0];
  if (debugTarget) {
    const userAllRecords = getRecordsForUser(allRecords, debugTarget.id);
    const userMonthRecords = getRecordsForMonth(userAllRecords, yearMonth);
    const userMonthKpi = getKpiForMonth(getKpiForUser(allKpiRecords, debugTarget.id), yearMonth);
    const model = buildInvoicePdfModelForMember(debugTarget, yearMonth, allRecords, allKpiRecords);
    const hasActivity = memberHasMonthActivity(debugTarget, yearMonth, allRecords, allKpiRecords);
    console.log(
      `${DEBUG_PREFIX} メンバー詳細(代表1名): name="${debugTarget.name}" id=${debugTarget.id} isActive=${debugTarget.isActive !== false}`
    );
    console.log(
      `${DEBUG_PREFIX}   全期間 records=${userAllRecords.length} / 当月 records=${userMonthRecords.length} / 当月 kpi=${userMonthKpi.length}`
    );
    if (userAllRecords.length > 0) {
      console.log(
        `${DEBUG_PREFIX}   代表メンバーの date サンプル: ${JSON.stringify(userAllRecords.slice(0, 5).map((r) => r.date))}`
      );
    }
    console.log(
      `${DEBUG_PREFIX}   totalMinutes=${model.totalMinutes} hourlyRateTaxInclusive=${model.hourlyRateTaxInclusive} totalWithTax=${model.totalWithTax} isIntern=${model.isIntern}`
    );
    console.log(
      `${DEBUG_PREFIX}   memberHasMonthActivity=${hasActivity} → isBillableMember=${hasActivity && model.totalWithTax > 0}`
    );
    if (hasActivity && model.totalWithTax === 0) {
      console.log(`${DEBUG_PREFIX}   ⚠ 実績はあるが請求額0（稼働0分 or インターン確定0 or 時給0の可能性）`);
    }
    if (!hasActivity && userAllRecords.length > 0) {
      console.log(`${DEBUG_PREFIX}   ⚠ 全期間に records ありだが当月フィルタで0件 → date 形式 or yearMonth 不一致の可能性`);
    }
  }

  console.log(`${DEBUG_PREFIX} --- 全アクティブメンバー判定一覧 ---`);
  for (const m of activeMembers) {
    const userMonthRecords = getRecordsForMonth(getRecordsForUser(allRecords, m.id), yearMonth);
    const userMonthKpi = getKpiForMonth(getKpiForUser(allKpiRecords, m.id), yearMonth);
    const hasActivity = userMonthRecords.length > 0 || userMonthKpi.length > 0;
    const model = buildInvoicePdfModelForMember(m, yearMonth, allRecords, allKpiRecords);
    let skipReason = "請求対象";
    if (!hasActivity) skipReason = "skip:当月実績なし";
    else if (model.totalWithTax === 0) {
      skipReason = `skip:請求額0 (minutes=${model.totalMinutes}, rate=${model.hourlyRateTaxInclusive})`;
    }
    console.log(
      `${DEBUG_PREFIX} ${m.name}: ${skipReason} | monthRecords=${userMonthRecords.length} monthKpi=${userMonthKpi.length} totalWithTax=${model.totalWithTax}`
    );
  }
}

/**
 * チャンク内メンバー分だけ PDF 生成→base64→rows を作り GAS へ POST。
 * 関数スコープを抜けると blob/buffer/base64/rows は GC 対象になる。
 */
async function processMemberChunk(
  chunkMembers: Member[],
  yearMonth: string,
  allRecords: Awaited<ReturnType<typeof loadRecords>>,
  allKpiRecords: Awaited<ReturnType<typeof loadKpiInDateRange>>
): Promise<{ inserted: number; errors: BatchError[] }> {
  const rows: InvoiceBatchExportRow[] = [];
  const errors: BatchError[] = [];
  const rowMemberIds = new Map<string, string>();

  for (const member of chunkMembers) {
    try {
      if (!memberHasMonthActivity(member, yearMonth, allRecords, allKpiRecords)) {
        continue;
      }

      const model = buildInvoicePdfModelForMember(member, yearMonth, allRecords, allKpiRecords);
      if (model.totalWithTax === 0) {
        continue;
      }

      console.log(`${LOG_PREFIX} PDF生成開始: ${member.name}`);
      const pdfStarted = Date.now();
      const pdfBlob = await renderInvoicePdfBlobFromModel(model);
      console.log(`${LOG_PREFIX} PDF生成完了: ${member.name} (${Date.now() - pdfStarted}ms)`);

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
      rowMemberIds.set(member.name, member.id);
    } catch (err) {
      errors.push({
        memberId: member.id,
        memberName: member.name,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (rows.length === 0) {
    return { inserted: 0, errors };
  }

  try {
    const gasResult = await postToGas(yearMonth, rows);
    return { inserted: gasInsertedCount(gasResult), errors };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    for (const row of rows) {
      errors.push({
        memberId: rowMemberIds.get(row.clientName) ?? "",
        memberName: row.clientName,
        message: `GAS 送信失敗: ${message}`,
      });
    }
    return { inserted: 0, errors };
  }
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

  console.log(`${LOG_PREFIX} 開始: 全メンバー数=${members.length} 対象月=${yearMonth}`);

  const [allRecords, allKpiRecords] = await Promise.all([
    loadRecords(),
    loadKpiInDateRange(monthStart, monthEnd),
  ]);

  logInvoiceDebugDiagnostics(yearMonth, monthStart, monthEnd, members, allRecords, allKpiRecords);

  const activeMembers = members.filter((m) => m.isActive !== false);
  const billableMembers = activeMembers.filter((m) => isBillableMember(m, yearMonth, allRecords, allKpiRecords));
  console.log(
    `${LOG_PREFIX} 請求対象メンバー数: ${billableMembers.length}（${billableMembers.map((m) => m.name).join("、") || "なし"}）`
  );

  const memberChunks = chunkMembers(activeMembers, CHUNK_SIZE);
  const totalChunks = memberChunks.length;

  let totalInserted = 0;
  const errors: BatchError[] = [];

  for (let i = 0; i < memberChunks.length; i++) {
    const chunk = memberChunks[i];
    console.log(
      `${LOG_PREFIX} chunk ${i + 1}/${totalChunks} 開始（${chunk.map((m) => m.name).join("、")}）`
    );
    const result = await processMemberChunk(chunk, yearMonth, allRecords, allKpiRecords);
    totalInserted += result.inserted;
    errors.push(...result.errors);
    console.log(
      `${LOG_PREFIX} chunk ${i + 1}/${totalChunks} 完了: inserted=${result.inserted} errors=${result.errors.length}`
    );
  }

  console.log(`${LOG_PREFIX} 完了: count=${totalInserted} errors=${errors.length}`);

  return NextResponse.json({
    ok: true,
    count: totalInserted,
    ...(errors.length > 0 ? { errors } : {}),
  });
}
