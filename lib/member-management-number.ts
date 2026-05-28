/**
 * 請求管理番号（DB: users.invoice_number / Member.invoiceNumber）の自動採番。
 * 既存値の数値部分の最大値 + 1 を返す（未登録のみなら "1"）。
 */

/** 管理番号文字列から数値部分を抽出（非数字は除去） */
export function parseManagementNumberNumeric(value: string | number | null | undefined): number | null {
  const raw = String(value ?? "").replace(/\D/g, "");
  if (raw === "") return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** 既存の管理番号一覧から、次に割り当てる番号（max + 1）を文字列で返す */
export function computeNextManagementNumber(
  existing: (string | number | null | undefined)[]
): string {
  let max = 0;
  for (const v of existing) {
    const n = parseManagementNumberNumeric(v);
    if (n != null && n > max) max = n;
  }
  return String(max + 1);
}
