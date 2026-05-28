/**
 * Googleフォーム（GAS namedValues）→ DB マッピング
 * キーはフォーム設問タイトル（日本語）または GAS 統合キー（invoice_registration_number）。
 */

import {
  coerceFormText,
  contractTypeToIsIntern,
  normalizeContractType,
  type ContractTypeCanonical,
} from "@/lib/form-coerce";
import { pickInvoiceRegistrationFromFormPayload } from "@/lib/invoice-registration-number";

/** フォーム設問タイトル（GAS が日本語キーで送る場合） */
export const GOOGLE_FORM_JP_LABELS = {
  name: "名前　※フルネーム",
  furigana: "フリガナ　※フルネーム",
  email: "メールアドレス",
  contractType: "契約形態",
  postCode: "郵便番号",
  address: "住所",
  bankName: "銀行名（例：三菱UFJ銀行）",
  branchName: "支店名（例：恵比寿支店）",
  accountType: "口座種別",
  accountNumber: "口座番号",
  accountHolder: "口座名義（カタカナ）",
  phoneNumber: "携帯電話番号",
  /** 14番: T番号入力欄 */
  invoiceRegistrationDetail: "インボイス番号をあるにした方は以下に記載",
  /** 13番: 有無（あり/なし）— GAS 統合前 */
  invoiceHasRegistration: "インボイス番号",
} as const;

/** GAS が統合して送るキー（DB: invoice_registration_number） */
export const GAS_INVOICE_REGISTRATION_KEY = "invoice_registration_number" as const;

export type GoogleFormJpRegisterPayload = {
  name: string;
  furigana: string;
  email: string;
  contractType: ContractTypeCanonical;
  postCode: string;
  address: string;
  bankName: string;
  branchName: string;
  accountType: string;
  accountNumber: string;
  accountHolder: string;
  phoneNumber: string;
  invoiceRegistrationNumber: string;
};

/** 全角スペース・連続空白を正規化してキー比較 */
export function normalizeFormQuestionKey(key: string): string {
  return key.replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();
}

/** 設問タイトル（日本語）から値を取得。該当キーのみ。 */
export function pickByFormLabel(o: Record<string, unknown>, formLabel: string): string {
  const normTarget = normalizeFormQuestionKey(formLabel);
  for (const [k, v] of Object.entries(o)) {
    if (normalizeFormQuestionKey(k) === normTarget) {
      return coerceFormText(v);
    }
  }
  return "";
}

/**
 * GAS から届く JSON をパース。
 * - invoice_registration_number: GAS で 13/14 番を統合した T 番号（推奨）
 * - 日本語キー直接 POST も後方互換
 */
export function parseGoogleFormJpRegisterPayload(raw: unknown): GoogleFormJpRegisterPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const name = pickByFormLabel(o, GOOGLE_FORM_JP_LABELS.name);
  const email = pickByFormLabel(o, GOOGLE_FORM_JP_LABELS.email);
  if (name === "" || email === "") return null;

  const accountTypeRaw = pickByFormLabel(o, GOOGLE_FORM_JP_LABELS.accountType);

  return {
    name,
    furigana: pickByFormLabel(o, GOOGLE_FORM_JP_LABELS.furigana),
    email,
    contractType: normalizeContractType(pickByFormLabel(o, GOOGLE_FORM_JP_LABELS.contractType)),
    postCode: pickByFormLabel(o, GOOGLE_FORM_JP_LABELS.postCode),
    address: pickByFormLabel(o, GOOGLE_FORM_JP_LABELS.address),
    bankName: pickByFormLabel(o, GOOGLE_FORM_JP_LABELS.bankName),
    branchName: pickByFormLabel(o, GOOGLE_FORM_JP_LABELS.branchName),
    accountType: accountTypeRaw !== "" ? accountTypeRaw : "普通",
    accountNumber: pickByFormLabel(o, GOOGLE_FORM_JP_LABELS.accountNumber),
    accountHolder: pickByFormLabel(o, GOOGLE_FORM_JP_LABELS.accountHolder),
    phoneNumber: pickByFormLabel(o, GOOGLE_FORM_JP_LABELS.phoneNumber),
    invoiceRegistrationNumber: pickInvoiceRegistrationFromFormPayload(o),
  };
}

export { contractTypeToIsIntern };

/** @deprecated pickInvoiceRegistrationFromFormPayload を使用 */
export function pickInvoiceRegistrationNumber(o: Record<string, unknown>): string {
  return pickInvoiceRegistrationFromFormPayload(o);
}

export function resolveInvoiceRegistrationNumber(o: Record<string, unknown>): string {
  return pickInvoiceRegistrationFromFormPayload(o);
}
