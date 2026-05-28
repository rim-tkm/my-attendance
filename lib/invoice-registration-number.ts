/** 適格請求書発行事業者登録番号（T + 13桁） */

import { coerceFormText } from "@/lib/form-coerce";

const QUALIFIED_INVOICE_RE = /^T\d{13}$/;

/** フォームの「あり/なし」だけの値（T番号ではない） */
const INVOICE_YES_NO_ONLY = new Set([
  "あり",
  "なし",
  "有",
  "無",
  "yes",
  "no",
  "true",
  "false",
  "有り",
  "無し",
]);

/** 入力中の正規化（大文字 T + 数字のみ、最大14文字） */
export function sanitizeInvoiceRegistrationInput(raw: string): string {
  const upper = raw.toUpperCase().replace(/[\s\-－ー]/g, "");
  if (upper === "") return "";
  if (upper.startsWith("T")) {
    return `T${upper.slice(1).replace(/\D/g, "").slice(0, 13)}`;
  }
  const digits = upper.replace(/\D/g, "");
  if (digits.length === 0) return upper.includes("T") ? "T" : "";
  return `T${digits.slice(0, 13)}`;
}

/** 文字列から T+13桁を抽出。見つからなければ "" */
export function extractQualifiedInvoiceRegistrationNumber(raw: string): string {
  const compact = raw.trim().replace(/[\s\-－ー]/g, "").toUpperCase();
  if (compact === "") return "";
  const m = /T(\d{13})/.exec(compact);
  if (m) return `T${m[1]}`;
  return "";
}

function isYesNoOnlyValue(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  if (t === "") return true;
  return INVOICE_YES_NO_ONLY.has(t);
}

/**
 * Webhook / フォーム保存向け: DB に保存する値（T+13 または空）。
 * 「あり」「なし」だけの場合は空文字。
 */
export function resolveInvoiceRegistrationForStorage(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "" || isYesNoOnlyValue(trimmed)) return "";
  const extracted = extractQualifiedInvoiceRegistrationNumber(trimmed);
  if (extracted) return extracted;
  return "";
}

/** 保存・表示用に T+13桁へ正規化（完全形のみ） */
export function normalizeQualifiedInvoiceRegistrationNumber(raw: string): string {
  return resolveInvoiceRegistrationForStorage(raw);
}

export function validateQualifiedInvoiceRegistrationNumber(
  raw: string
): { ok: true; value: string } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (trimmed === "" || isYesNoOnlyValue(trimmed)) return { ok: true, value: "" };
  const compact = trimmed.replace(/[\s\-－ー]/g, "").toUpperCase();
  if (!QUALIFIED_INVOICE_RE.test(compact)) {
    return {
      ok: false,
      message:
        "適格請求書発行事業者登録番号は「T」+ 13桁の数字で入力してください（例: T1234567890123）。",
    };
  }
  return { ok: true, value: compact };
}

/** 請求書 PDF / HTML 用の1行（未登録時は null） */
export function formatInvoiceRegistrationDisplayLine(
  registrationNumber: string | undefined | null
): string | null {
  const normalized = resolveInvoiceRegistrationForStorage(registrationNumber ?? "");
  if (normalized === "" || !QUALIFIED_INVOICE_RE.test(normalized)) return null;
  return `登録番号：${normalized}`;
}

/** GAS 統合キー + 日本語設問キーから登録番号を解決 */
export function pickInvoiceRegistrationFromFormPayload(o: Record<string, unknown>): string {
  const gasMerged =
    coerceFormText(o.invoice_registration_number) || coerceFormText(o.invoiceRegistrationNumber);
  if (gasMerged !== "") {
    return resolveInvoiceRegistrationForStorage(gasMerged);
  }

  const detailLabel = "インボイス番号をあるにした方は以下に記載";
  const hasLabel = "インボイス番号";

  let fromDetail = "";
  let fromHas = "";
  for (const [k, v] of Object.entries(o)) {
    const nk = k.replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();
    const t = coerceFormText(v);
    if (t === "") continue;
    if (nk.includes("あるにした方") || (nk.includes("インボイス") && nk.includes("以下に記載"))) {
      fromDetail = t;
      continue;
    }
    if (nk === hasLabel || (nk.startsWith("インボイス番号") && !nk.includes("あるにした"))) {
      fromHas = t;
    }
  }

  const tDetail = resolveInvoiceRegistrationForStorage(fromDetail);
  if (tDetail) return tDetail;
  const tHas = resolveInvoiceRegistrationForStorage(fromHas);
  if (tHas) return tHas;

  return "";
}
