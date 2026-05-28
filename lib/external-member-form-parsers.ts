/** Googleフォーム / GAS 連携向けの JSON キー解釈（日本語列名の部分一致） */

import {
  coerceFormText,
  contractTypeToIsIntern,
  normalizeContractType,
  type ContractTypeCanonical,
} from "@/lib/form-coerce";
import {
  parseGoogleFormJpRegisterPayload,
  type GoogleFormJpRegisterPayload,
} from "@/lib/google-form-jp-register-parser";
import { pickInvoiceRegistrationFromFormPayload } from "@/lib/invoice-registration-number";

export type { ContractTypeCanonical };
export { coerceFormText, contractTypeToIsIntern, normalizeContractType };
export type { GoogleFormJpRegisterPayload as GoogleFormRegisterPayload };
export { parseGoogleFormJpRegisterPayload as parseGoogleFormRegisterPayload };
export { GOOGLE_FORM_JP_LABELS } from "@/lib/google-form-jp-register-parser";

/** @deprecated parseGoogleFormJpRegisterPayload を使用。メールは『メールアドレス』列のみ */
export function pickEmailFromPayload(o: Record<string, unknown>): string {
  return (
    pickByNormalizedKeyFromO(o, "メールアドレス") ||
    firstStringByKeyIncludes(o, (k) => k.includes("メールアドレス")) ||
    pickStrExact(o, "email")
  );
}

function pickByNormalizedKeyFromO(o: Record<string, unknown>, target: string): string {
  const normTarget = target.replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();
  for (const [k, v] of Object.entries(o)) {
    const nk = k.replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();
    if (nk === normTarget) return coerceFormText(v);
  }
  return "";
}

/** @deprecated GOOGLE_FORM_JP_LABELS を参照 */
export const GOOGLE_FORM_REGISTER_JSON_KEYS = [
  "email",
  "name",
  "furigana",
  "contractType",
  "postCode",
  "address",
  "bankName",
  "branchName",
  "accountType",
  "accountNumber",
  "accountHolder",
  "phoneNumber",
  "invoiceRegistrationNumber",
] as const;

export type GoogleFormRegisterJsonKey = (typeof GOOGLE_FORM_REGISTER_JSON_KEYS)[number];

export function firstStringByKeyIncludes(
  o: Record<string, unknown>,
  includesTest: (key: string) => boolean
): string {
  for (const [k, v] of Object.entries(o)) {
    if (!includesTest(k)) continue;
    const t = coerceFormText(v);
    if (t !== "") return t;
  }
  return "";
}

export function pickStrExact(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const t = coerceFormText(o[k]);
    if (t !== "") return t;
  }
  return "";
}

function isEnglishNameKey(key: string): boolean {
  const k = key.toLowerCase();
  return k.includes("英語") || k.includes("english");
}

export function pickMemberName(o: Record<string, unknown>): string {
  return (
    firstStringByKeyIncludes(
      o,
      (k) =>
        !isEnglishNameKey(k) &&
        ((k.includes("名前") && k.includes("フルネーム")) || k.includes("フルネーム"))
    ) ||
    firstStringByKeyIncludes(
      o,
      (k) =>
        !isEnglishNameKey(k) &&
        (k.includes("氏名") ||
          (k.includes("名前") && !k.includes("フリガナ") && !k.includes("口座") && !k.includes("名義")))
    ) ||
    pickStrExact(o, "name")
  );
}

export function pickMemberEmail(o: Record<string, unknown>): string {
  return (
    firstStringByKeyIncludes(o, (k) => k.includes("メールアドレス") || (k.includes("メール") && !k.includes("携帯"))) ||
    pickStrExact(o, "email")
  );
}

export function pickFurigana(o: Record<string, unknown>): string {
  return (
    firstStringByKeyIncludes(o, (k) => !isEnglishNameKey(k) && k.includes("フリガナ")) ||
    pickStrExact(o, "furigana", "nameKana", "name_kana")
  );
}

export function pickPostCode(o: Record<string, unknown>): string {
  return (
    firstStringByKeyIncludes(o, (k) => k.includes("郵便番号")) ||
    pickStrExact(o, "postCode", "postalCode", "zipCode", "zip_code")
  );
}

export function pickAddress(o: Record<string, unknown>): string {
  return firstStringByKeyIncludes(o, (k) => k.includes("住所") && !k.includes("郵便")) || pickStrExact(o, "address");
}

export function pickBankName(o: Record<string, unknown>): string {
  return firstStringByKeyIncludes(o, (k) => k.includes("銀行名")) || pickStrExact(o, "bankName");
}

export function pickBranchName(o: Record<string, unknown>): string {
  return firstStringByKeyIncludes(o, (k) => k.includes("支店名")) || pickStrExact(o, "branchName");
}

export function pickAccountType(o: Record<string, unknown>): string {
  return firstStringByKeyIncludes(o, (k) => k.includes("口座種別")) || pickStrExact(o, "accountType");
}

export function pickAccountNumber(o: Record<string, unknown>): string {
  return firstStringByKeyIncludes(o, (k) => k.includes("口座番号")) || pickStrExact(o, "accountNumber");
}

export function pickAccountHolder(o: Record<string, unknown>): string {
  return (
    firstStringByKeyIncludes(o, (k) => k.includes("口座名義")) ||
    pickStrExact(o, "accountHolder")
  );
}

export function pickMobilePhone(o: Record<string, unknown>): string {
  return (
    firstStringByKeyIncludes(o, (k) => k.includes("携帯電話番号")) ||
    firstStringByKeyIncludes(o, (k) => k.includes("携帯") && k.includes("電話")) ||
    firstStringByKeyIncludes(o, (k) => k.includes("携帯電話")) ||
    pickStrExact(o, "phoneNumber", "mobilePhone", "mobile")
  );
}

/** @deprecated pickInvoiceRegistrationFromFormPayload を使用 */
export function pickInvoiceRegistrationNumber(o: Record<string, unknown>): string {
  return pickInvoiceRegistrationFromFormPayload(o);
}

export function pickContractTypeLabel(o: Record<string, unknown>): string {
  return (
    firstStringByKeyIncludes(
      o,
      (k) => k.includes("契約形態") || k.includes("契約") || k.includes("contract")
    ) || pickStrExact(o, "contractType", "contract_type", "contract", "isIntern", "is_intern")
  );
}

export function parseIsInternFromContractLabel(raw: string): boolean | null {
  const normalized = normalizeContractType(raw);
  if (raw.trim() === "" && normalized === "contractor") return null;
  return contractTypeToIsIntern(normalized);
}

export function normalizeIsIntern(o: Record<string, unknown>): boolean {
  if (typeof o.isIntern === "boolean") return o.isIntern;
  if (typeof o.is_intern === "boolean") return o.is_intern;
  const exact = pickStrExact(o, "isIntern", "is_intern");
  if (exact === "true" || exact === "1") return true;
  if (exact === "false" || exact === "0") return false;

  const contractLabel = pickContractTypeLabel(o);
  return contractTypeToIsIntern(normalizeContractType(contractLabel));
}
