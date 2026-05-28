import { getSupabase } from "@/lib/supabase";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ExternalUpdateBankBody = {
  email: string;
  bankName: string;
  branchName: string;
  accountType: string;
  accountNumber: string;
  accountHolder: string;
};

export type ExternalUpdateBankOutcome =
  | { ok: true }
  | { ok: false; error: string; status: number };

function firstStringByKeyIncludes(o: Record<string, unknown>, includesTest: (key: string) => boolean): string {
  for (const [k, v] of Object.entries(o)) {
    if (!includesTest(k)) continue;
    if (typeof v === "string") {
      const t = v.trim();
      if (t !== "") return t;
    }
  }
  return "";
}

function pickStrExact(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string") {
      const t = v.trim();
      if (t !== "") return t;
    }
  }
  return "";
}

export function parseExternalUpdateBankPayload(raw: unknown): ExternalUpdateBankBody | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const email =
    firstStringByKeyIncludes(o, (k) => k.includes("メールアドレス")) || pickStrExact(o, "email");
  const bankName =
    firstStringByKeyIncludes(o, (k) => k.includes("銀行名")) || pickStrExact(o, "bankName");
  const branchName =
    firstStringByKeyIncludes(o, (k) => k.includes("支店名")) || pickStrExact(o, "branchName");
  const accountType =
    firstStringByKeyIncludes(o, (k) => k.includes("口座種別")) || pickStrExact(o, "accountType");
  const accountNumber =
    firstStringByKeyIncludes(o, (k) => k.includes("口座番号")) || pickStrExact(o, "accountNumber");
  const accountHolder =
    firstStringByKeyIncludes(o, (k) => k.includes("口座名義")) ||
    firstStringByKeyIncludes(o, (k) => k.includes("名義")) ||
    pickStrExact(o, "accountHolder");

  if (!email || !bankName || !branchName || !accountType || !accountNumber || !accountHolder) {
    return null;
  }
  return {
    email,
    bankName,
    branchName,
    accountType,
    accountNumber,
    accountHolder,
  };
}

/**
 * login_account（メール）が一致するユーザーの銀行口座情報を更新する（Supabase）。
 * Prisma は未使用のため、postgrest の update に相当する処理。
 */
export async function updateBankInfoByEmail(body: ExternalUpdateBankBody): Promise<ExternalUpdateBankOutcome> {
  if (!EMAIL_RE.test(body.email)) {
    return { ok: false, error: "メールアドレスの形式が正しくありません。", status: 400 };
  }

  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: "Supabase が設定されていません。", status: 503 };
  }

  const target = body.email.trim().toLowerCase();
  const { data: rows, error: selErr } = await supabase.from("users").select("id, login_account");
  if (selErr) {
    console.error("[external-update-bank] select failed:", selErr);
    return { ok: false, error: "ユーザー検索に失敗しました。", status: 502 };
  }

  const row = (rows ?? []).find((r: { id: string; login_account: string | null }) => {
    return (r.login_account ?? "").trim().toLowerCase() === target;
  });

  if (!row) {
    return { ok: false, error: "指定のメールアドレスに一致するユーザーが見つかりません。", status: 404 };
  }

  const { error: upErr } = await supabase
    .from("users")
    .update({
      bank_name: body.bankName.trim(),
      branch_name: body.branchName.trim(),
      account_type: body.accountType.trim(),
      account_number: body.accountNumber.trim(),
      account_holder: body.accountHolder.trim(),
    })
    .eq("id", row.id);

  if (upErr) {
    console.error("[external-update-bank] update failed:", upErr);
    return { ok: false, error: upErr.message ?? String(upErr), status: 502 };
  }

  return { ok: true };
}
