import type { MemberUpdatePayload } from "@/lib/supabase-data";

/** 一般ユーザーの振込先 API では更新・送信ともに禁止するキー（DB: invoice_number） */
export const INVOICE_MANAGEMENT_NUMBER_FORBIDDEN_KEYS = [
  "invoiceNumber",
  "invoice_number",
  "management_number",
  "managementNumber",
  "managementNo",
  "management_no",
] as const;

/** リクエスト JSON から振込先更新用フィールドのみ抽出（管理番号系キーは無視） */
export function coerceMemberSelfBankProfileBody(raw: unknown): MemberUpdatePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  for (const k of INVOICE_MANAGEMENT_NUMBER_FORBIDDEN_KEYS) {
    if (k in o) {
      console.warn("[member-bank-profile] 請求管理番号は一般ユーザーから更新できません。キーを無視しました:", k);
    }
  }
  const out: MemberUpdatePayload = {};
  if (typeof o.postalCode === "string") out.postalCode = o.postalCode;
  if (typeof o.address === "string") out.address = o.address;
  if (typeof o.bankName === "string") out.bankName = o.bankName;
  if (typeof o.branchName === "string") out.branchName = o.branchName;
  if (typeof o.accountType === "string") out.accountType = o.accountType;
  if (typeof o.accountNumber === "string") out.accountNumber = o.accountNumber;
  if (typeof o.accountHolder === "string") out.accountHolder = o.accountHolder;
  if (typeof o.phoneNumber === "string") out.phoneNumber = o.phoneNumber;
  if (typeof o.invoiceRegistrationNumber === "string") {
    out.invoiceRegistrationNumber = o.invoiceRegistrationNumber;
  }
  if (Object.keys(out).length === 0) return null;
  return out;
}
