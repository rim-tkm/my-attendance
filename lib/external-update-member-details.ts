import { pickInvoiceRegistrationFromFormPayload } from "@/lib/invoice-registration-number";
import { getSupabase } from "@/lib/supabase";
import {
  pickAccountHolder,
  pickAccountNumber,
  pickAccountType,
  pickAddress,
  pickBankName,
  pickBranchName,
  pickFurigana,
  pickMemberEmail,
  pickMemberName,
  pickMobilePhone,
  pickPostCode,
} from "@/lib/external-member-form-parsers";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** パース結果: メール必須、その他は送られた項目のみ */
export type ExternalMemberDetailsPatch = {
  email: string;
  name?: string;
  furigana?: string;
  postCode?: string;
  address?: string;
  bankName?: string;
  branchName?: string;
  accountType?: string;
  accountNumber?: string;
  accountHolder?: string;
  phoneNumber?: string;
  invoiceRegistrationNumber?: string;
};

export type ExternalUpdateMemberDetailsOutcome =
  | { ok: true }
  | { ok: false; error: string; status: number };

/**
 * メール必須。他キーは列名キーワード部分一致で任意（1件以上あること）。
 */
export function parseExternalMemberDetailsPayload(raw: unknown): ExternalMemberDetailsPatch | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const email = pickMemberEmail(o);
  if (!email) return null;

  const patch: ExternalMemberDetailsPatch = { email };

  const name = pickMemberName(o);
  if (name) patch.name = name;

  const furigana = pickFurigana(o);
  if (furigana) patch.furigana = furigana;

  const postCode = pickPostCode(o);
  if (postCode) patch.postCode = postCode;

  const address = pickAddress(o);
  if (address) patch.address = address;

  const bankName = pickBankName(o);
  if (bankName) patch.bankName = bankName;

  const branchName = pickBranchName(o);
  if (branchName) patch.branchName = branchName;

  const accountType = pickAccountType(o);
  if (accountType) patch.accountType = accountType;

  const accountNumber = pickAccountNumber(o);
  if (accountNumber) patch.accountNumber = accountNumber;

  const accountHolder = pickAccountHolder(o);
  if (accountHolder) patch.accountHolder = accountHolder;

  const phoneNumber = pickMobilePhone(o);
  if (phoneNumber) patch.phoneNumber = phoneNumber;

  const invoiceRegistrationNumber = pickInvoiceRegistrationFromFormPayload(o);
  if (invoiceRegistrationNumber) patch.invoiceRegistrationNumber = invoiceRegistrationNumber;

  const hasAnyUpdate =
    !!patch.name ||
    !!patch.furigana ||
    !!patch.postCode ||
    !!patch.address ||
    !!patch.bankName ||
    !!patch.branchName ||
    !!patch.accountType ||
    !!patch.accountNumber ||
    !!patch.accountHolder ||
    !!patch.phoneNumber ||
    !!patch.invoiceRegistrationNumber;

  if (!hasAnyUpdate) return null;

  return patch;
}

async function findUserIdByEmail(email: string): Promise<
  { ok: true; id: string } | { ok: false; error: string; status: number }
> {
  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: "Supabase が設定されていません。", status: 503 };
  }
  const target = email.trim().toLowerCase();
  const { data: rows, error: selErr } = await supabase.from("users").select("id, login_account");
  if (selErr) {
    console.error("[external-update-member-details] select failed:", selErr);
    return { ok: false, error: "ユーザー検索に失敗しました。", status: 502 };
  }
  const row = (rows ?? []).find((r: { id: string; login_account: string | null }) => {
    return (r.login_account ?? "").trim().toLowerCase() === target;
  });
  if (!row) {
    return { ok: false, error: "指定のメールアドレスに一致するユーザーが見つかりません。", status: 404 };
  }
  return { ok: true, id: row.id };
}

/**
 * login_account（メール）でユーザーを特定し、指定フィールドのみ更新（Supabase = Prisma の user.update に相当）。
 */
export async function updateMemberDetailsByEmail(
  patch: ExternalMemberDetailsPatch
): Promise<ExternalUpdateMemberDetailsOutcome> {
  if (!EMAIL_RE.test(patch.email)) {
    return { ok: false, error: "メールアドレスの形式が正しくありません。", status: 400 };
  }

  const found = await findUserIdByEmail(patch.email);
  if (!found.ok) return found;

  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.furigana !== undefined) body.furigana = patch.furigana;
  if (patch.postCode !== undefined) body.zip_code = patch.postCode;
  if (patch.address !== undefined) body.address = patch.address;
  if (patch.bankName !== undefined) body.bank_name = patch.bankName;
  if (patch.branchName !== undefined) body.branch_name = patch.branchName;
  if (patch.accountType !== undefined) body.account_type = patch.accountType;
  if (patch.accountNumber !== undefined) body.account_number = patch.accountNumber;
  if (patch.accountHolder !== undefined) body.account_holder = patch.accountHolder;
  if (patch.phoneNumber !== undefined) body.phone_number = patch.phoneNumber;
  if (patch.invoiceRegistrationNumber !== undefined) {
    body.invoice_registration_number = patch.invoiceRegistrationNumber;
  }

  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: "Supabase が設定されていません。", status: 503 };
  }

  const { error: upErr } = await supabase.from("users").update(body).eq("id", found.id);
  if (upErr) {
    console.error("[external-update-member-details] update failed:", upErr);
    return { ok: false, error: upErr.message ?? String(upErr), status: 502 };
  }

  return { ok: true };
}
