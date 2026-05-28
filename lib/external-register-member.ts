import bcrypt from "bcryptjs";
import { DEFAULT_CAN_WORK_MORNING_FOR_NEW_MEMBER, DEFAULT_HOURLY_RATE } from "@/lib/attendance";
import {
  contractTypeToIsIntern,
  parseGoogleFormJpRegisterPayload,
  type GoogleFormJpRegisterPayload,
} from "@/lib/google-form-jp-register-parser";
import { allocateNextInvoiceManagementNumber } from "@/lib/supabase-data";
import { getSupabase } from "@/lib/supabase";

/** Googleフォーム等からの登録用。ログイン後の初期パスワード */
export const EXTERNAL_REGISTER_DEFAULT_PASSWORD = "12345";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ExternalRegisterOutcome =
  | {
      ok: true;
      id: string;
      invoiceManagementNumber: string;
      isIntern: boolean;
      contractType: "intern" | "contractor";
    }
  | { ok: false; error: string; status: number };

/** Supabase users テーブルへの INSERT 行（フォーム全14項目 + システム採番） */
export type GoogleFormUserInsertRow = {
  id: string;
  name: string;
  furigana: string;
  login_account: string;
  password: string;
  hourly_rate: number;
  zip_code: string;
  address: string;
  bank_name: string;
  branch_name: string;
  account_type: string;
  account_number: string;
  account_holder: string;
  invoice_number: string;
  invoice_registration_number: string;
  phone_number: string;
  is_active: boolean;
  first_work_date: string | null;
  can_work_morning: boolean;
  is_intern: boolean;
};

export function buildGoogleFormUserInsertRow(
  payload: GoogleFormJpRegisterPayload,
  invoiceManagementNumber: string,
  passwordHash: string,
  id: string = crypto.randomUUID()
): GoogleFormUserInsertRow {
  const isIntern = contractTypeToIsIntern(payload.contractType);

  return {
    id,
    name: payload.name,
    furigana: payload.furigana,
    login_account: payload.email,
    password: passwordHash,
    hourly_rate: isIntern ? 0 : DEFAULT_HOURLY_RATE,
    zip_code: payload.postCode,
    address: payload.address,
    bank_name: payload.bankName,
    branch_name: payload.branchName,
    account_type: payload.accountType,
    account_number: payload.accountNumber,
    account_holder: payload.accountHolder,
    invoice_number: invoiceManagementNumber,
    invoice_registration_number: payload.invoiceRegistrationNumber,
    phone_number: payload.phoneNumber,
    is_active: true,
    first_work_date: null,
    can_work_morning: DEFAULT_CAN_WORK_MORNING_FOR_NEW_MEMBER,
    is_intern: isIntern,
  };
}

export async function registerMemberFromGoogleForm(
  payload: GoogleFormJpRegisterPayload
): Promise<ExternalRegisterOutcome> {
  if (!EMAIL_RE.test(payload.email)) {
    return { ok: false, error: "メールアドレスの形式が正しくありません。", status: 400 };
  }

  const loginNorm = payload.email.trim().toLowerCase();
  if (loginNorm === "admin") {
    return { ok: false, error: "このログインIDは使用できません。", status: 400 };
  }

  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: "Supabase が設定されていません。", status: 503 };
  }

  const { data: loginRows, error: loginErr } = await supabase.from("users").select("login_account");
  if (loginErr) {
    console.error("[external-register] login check failed:", loginErr);
    return { ok: false, error: "ユーザー情報の確認に失敗しました。", status: 502 };
  }
  const taken = (loginRows ?? []).some(
    (r: { login_account: string | null }) => (r.login_account ?? "").trim().toLowerCase() === loginNorm
  );
  if (taken) {
    return { ok: false, error: "このメールアドレスは既に登録されています。", status: 409 };
  }

  const invoiceManagementNumber = await allocateNextInvoiceManagementNumber();
  const passwordHash = await bcrypt.hash(EXTERNAL_REGISTER_DEFAULT_PASSWORD, 10);
  const insertRow = buildGoogleFormUserInsertRow(payload, invoiceManagementNumber, passwordHash);
  const isIntern = insertRow.is_intern;

  const { error } = await supabase.from("users").insert(insertRow);
  if (error) {
    const message = error.message ?? String(error);
    console.error("[external-register] insert failed:", error);
    if (/duplicate key|unique constraint|23505/i.test(message) && /login/i.test(message)) {
      return { ok: false, error: "このメールアドレスは既に登録されています。", status: 409 };
    }
    return { ok: false, error: message, status: 502 };
  }

  return {
    ok: true,
    id: insertRow.id,
    invoiceManagementNumber,
    isIntern,
    contractType: payload.contractType,
  };
}

export function parseExternalRegisterPayload(raw: unknown): GoogleFormJpRegisterPayload | null {
  return parseGoogleFormJpRegisterPayload(raw);
}

export type { GoogleFormJpRegisterPayload as GoogleFormRegisterPayload };
