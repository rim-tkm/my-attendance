import type { Member } from "@/lib/attendance";
import { bankByCode, branchByCode } from "@/lib/bank-master";
import {
  accountNumberForTransfer,
  branchNameForFreee,
  splitJpAddress,
  toHalfWidthKana,
} from "@/lib/freee-partners-csv";

/**
 * freee 取引先（partner）API の作成・更新ペイロードをメンバーから組み立てる（サーバー専用）。
 * フィールド名は freee 公式 OpenAPI スキーマ（partnerCreateParams / partnerUpdateParams）に準拠。
 * 支払条件は CSV 出力と同じ全員共通の運用値（末日締め＝cutoff_day 32・翌月＝additional_months 1・15日払い）。
 */

/** freee の都道府県コード（0=北海道 〜 46=沖縄。JIS コード−1） */
const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

function prefectureCode(prefecture: string): number {
  const i = PREFECTURES.indexOf(prefecture);
  return i >= 0 ? i : -1; // -1 = 設定しない
}

export type FreeePartnerPayload = Record<string, unknown>;

/** 取引先の作成・更新に使う共通ペイロード（company_id は呼び出し側で付与） */
export function buildFreeePartnerPayload(member: Member, companyId: number): FreeePartnerPayload {
  const { prefecture, rest } = splitJpAddress(member.address ?? "");
  const bankCode = (member.bankCode ?? "").trim();
  const branchCode = (member.branchCode ?? "").trim();
  const bankMaster = bankCode !== "" ? bankByCode(bankCode) : null;
  const branchMaster = bankCode !== "" && branchCode !== "" ? branchByCode(bankCode, branchCode) : null;
  const invReg = (member.invoiceRegistrationNumber ?? "").trim();
  const accountType = ((member.accountType ?? "普通").trim() || "普通") === "当座" ? "checking" : "ordinary";
  const accountHolderKana = (member.accountHolder ?? "").trim() || (member.furigana ?? "").trim();

  const payload: FreeePartnerPayload = {
    company_id: companyId,
    name: member.name,
    org_code: 2, // 個人
    country_code: "JP",
    phone: (member.phoneNumber ?? "").trim(),
    qualified_invoice_issuer: invReg !== "",
    payment_term_attributes: { cutoff_day: 32, additional_months: 1, fixed_day: 15 },
  };
  if (invReg !== "" && /^T[1-9][0-9]{12}$/.test(invReg)) {
    payload.invoice_registration_number = invReg;
  }
  if ((member.address ?? "").trim() !== "" || (member.postalCode ?? "").trim() !== "") {
    payload.address_attributes = {
      zipcode: (member.postalCode ?? "").trim(),
      prefecture_code: prefectureCode(prefecture),
      street_name1: rest,
      street_name2: "",
    };
  }
  if ((member.bankName ?? "").trim() !== "") {
    payload.partner_bank_account_attributes = {
      bank_name: (member.bankName ?? "").trim(),
      bank_name_kana: bankMaster ? toHalfWidthKana(bankMaster.kana) : "",
      bank_code: bankCode,
      branch_name: branchNameForFreee(member.branchName ?? ""),
      branch_kana: branchMaster ? toHalfWidthKana(branchMaster.kana) : "",
      branch_code: branchCode,
      account_type: accountType,
      account_number: accountNumberForTransfer(member.accountNumber ?? "", (member.bankName ?? "").trim(), bankCode),
      long_account_name: member.name,
      account_name: toHalfWidthKana(accountHolderKana),
    };
  }
  return payload;
}
