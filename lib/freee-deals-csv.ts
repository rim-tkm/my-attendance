import type { KpiRecord, Member, WorkRecord } from "@/lib/attendance";
import { sumBillableMinutesForUserMonth } from "@/lib/attendance";
import { calcMemberMonthlyPayYen, isInternMember, splitTaxInclusiveLineAmount } from "@/lib/invoice-intern";

/**
 * freee の「取引（支出）インポート」形式で月次外注費 CSV を生成する（税理士・大槻さん指定のフォーマット）。
 * - 発生日=対象月の末日、決済期日=翌月15日（末日締め・翌月15日払いの運用値）
 * - 金額は税込（請求書と同じ計算: 一般=時給×稼働時間、インターン=確定数×単価）
 * - 税区分はインボイス登録番号の有無で判定（あり=課対仕入10% / なし=経過措置の課対仕入（控80）10%）
 * - 税額は請求書 PDF と同一の端数処理（税込→税抜=floor(総額/1.1)、税額=差分。サンプル 55000→5000 と一致）
 * - 取引先名は現在のメンバー表示名（freee の取引先と同期済みのため一致する）
 */

export const FREEE_DEALS_CSV_HEADERS = [
  "収支区分",
  "発生日",
  "決済期日",
  "取引先",
  "勘定科目",
  "税区分",
  "金額",
  "税計算区分",
  "税額",
  "備考",
  "品目",
] as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 対象月（YYYY-MM）の末日・翌月15日を YYYY/MM/DD で返す */
export function freeeDealDatesForMonth(yearMonth: string): { occurredOn: string; dueOn: string } {
  const [y, m] = yearMonth.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const due = new Date(y, m, 15); // m は 1 始まりなので Date(y, m, …) = 翌月
  return {
    occurredOn: `${y}/${pad2(m)}/${pad2(lastDay)}`,
    dueOn: `${due.getFullYear()}/${pad2(due.getMonth() + 1)}/${pad2(due.getDate())}`,
  };
}

export type FreeeDealRow = {
  memberName: string;
  amount: number;
  tax: number;
  taxCategory: string;
  isIntern: boolean;
};

/** 対象月に支払いが発生するメンバーの外注費行を計算（金額0円は除外・名前順） */
export function buildFreeeDealRows(input: {
  members: Member[];
  records: WorkRecord[];
  kpiRecords: KpiRecord[];
  yearMonth: string;
  defaultHourlyRate: number;
}): FreeeDealRow[] {
  const { members, records, kpiRecords, yearMonth, defaultHourlyRate } = input;
  const rows: FreeeDealRow[] = [];
  for (const member of members) {
    // 月の途中で無効化されたメンバーの支払い漏れを防ぐため、有効/無効は問わず「対象月に支払いが発生するか」で判定する
    if ((member.loginAccount ?? "").trim().toLowerCase() === "admin") continue;
    // 請求書PDF・一括記帳と同一の集計（旧形式日付の正規化・duration異常時の打刻時刻からの再計算を含む）
    const minutes = sumBillableMinutesForUserMonth(records, member.id, yearMonth);
    const amount = calcMemberMonthlyPayYen(member, minutes, kpiRecords, yearMonth, defaultHourlyRate);
    if (amount <= 0) continue;
    const hasInvoiceRegistration = (member.invoiceRegistrationNumber ?? "").trim() !== "";
    rows.push({
      memberName: member.name,
      amount,
      tax: splitTaxInclusiveLineAmount(amount).tax,
      taxCategory: hasInvoiceRegistration ? "課対仕入10%" : "課対仕入（控80）10%",
      isIntern: isInternMember(member),
    });
  }
  return rows.sort((a, b) => a.memberName.localeCompare(b.memberName, "ja"));
}

/** freee 取引インポート形式の CSV 行列（ヘッダー含む） */
export function buildFreeeDealsCsvRows(input: {
  members: Member[];
  records: WorkRecord[];
  kpiRecords: KpiRecord[];
  yearMonth: string;
  defaultHourlyRate: number;
}): string[][] {
  const { occurredOn, dueOn } = freeeDealDatesForMonth(input.yearMonth);
  const monthLabel = `${Number(input.yearMonth.split("-")[1])}月分`;
  const out: string[][] = [FREEE_DEALS_CSV_HEADERS.slice() as unknown as string[]];
  for (const r of buildFreeeDealRows(input)) {
    out.push([
      "支出",
      occurredOn,
      dueOn,
      r.memberName,
      "外注費",
      r.taxCategory,
      String(r.amount),
      "税込",
      String(r.tax),
      monthLabel,
      r.isIntern ? "テレアポ業務（成果報酬）" : "テレアポ業務",
    ]);
  }
  return out;
}
