import { matchBankByName, matchBranchByName } from "@/lib/bank-master";
import { getSupabase } from "@/lib/supabase";
import { getUsersDb } from "@/lib/supabase-data";
import { postSlackIncomingWebhook, resolveSlackWebhookUrl } from "@/lib/slack-webhook";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalize(v: string | null | undefined): string {
  return (v ?? "").trim();
}

/** 口座番号は Slack 履歴に平文で残さない。末尾2桁だけ見せてマスクする（監査 2026-08-06）。 */
export function maskAccountNumberForSlack(v: string): string {
  const t = v.trim();
  if (t === "") return "（未設定）";
  if (t.length <= 2) return "*".repeat(t.length);
  return `${"*".repeat(t.length - 2)}${t.slice(-2)}`;
}

export type BankInfoSnapshot = {
  bankName: string;
  branchName: string;
  accountType: string;
  accountNumber: string;
  accountHolder: string;
};

/**
 * 振込先の変更点を Slack 通知テキストに整形する（純粋関数。テストしやすいよう export）。
 * - 変更が1つも無ければ null（GASフォームが同一内容を再送してきた場合に通知しないため）。
 * - 口座番号は全桁を出さず末尾2桁のみ（`maskAccountNumberForSlack`）。
 */
export function buildBankInfoChangeSlackMessage(params: {
  memberName: string;
  before: BankInfoSnapshot;
  after: BankInfoSnapshot;
}): string | null {
  const { memberName, before, after } = params;
  const lines: string[] = [];

  if (normalize(before.bankName) !== normalize(after.bankName)) {
    lines.push(`・銀行名: ${normalize(before.bankName) || "（未設定）"} → ${normalize(after.bankName) || "（未設定）"}`);
  }
  if (normalize(before.branchName) !== normalize(after.branchName)) {
    lines.push(`・支店名: ${normalize(before.branchName) || "（未設定）"} → ${normalize(after.branchName) || "（未設定）"}`);
  }
  if (normalize(before.accountType) !== normalize(after.accountType)) {
    lines.push(`・口座種別: ${normalize(before.accountType) || "（未設定）"} → ${normalize(after.accountType) || "（未設定）"}`);
  }
  if (normalize(before.accountHolder) !== normalize(after.accountHolder)) {
    lines.push(`・口座名義: ${normalize(before.accountHolder) || "（未設定）"} → ${normalize(after.accountHolder) || "（未設定）"}`);
  }
  if (normalize(before.accountNumber) !== normalize(after.accountNumber)) {
    lines.push(
      `・口座番号が変更されました（${maskAccountNumberForSlack(before.accountNumber)} → ${maskAccountNumberForSlack(after.accountNumber)}）`
    );
  }

  if (lines.length === 0) return null;

  return (
    `🏦 外部フォーム経由で振込先情報が変更されました: ${memberName}\n` +
    lines.join("\n") +
    `\n本人が申請した変更でなければ、本人に確認してください。`
  );
}

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

  const supabase = getUsersDb();
  if (!supabase) {
    return { ok: false, error: "Supabase が設定されていません。", status: 503 };
  }

  const target = body.email.trim().toLowerCase();
  // name・既存の銀行口座列も同じ問い合わせで取得する（Slack通知の宛先名・変更差分diffに使うため、
  // 2回目の往復を増やさない）。
  const { data: rows, error: selErr } = await supabase
    .from("users")
    .select("id, login_account, name, bank_name, branch_name, account_type, account_number, account_holder");
  if (selErr) {
    console.error("[external-update-bank] select failed:", selErr);
    return { ok: false, error: "ユーザー検索に失敗しました。", status: 502 };
  }

  type BankRow = {
    id: string;
    login_account: string | null;
    name: string | null;
    bank_name: string | null;
    branch_name: string | null;
    account_type: string | null;
    account_number: string | null;
    account_holder: string | null;
  };

  const row = (rows ?? []).find((r: BankRow) => {
    return (r.login_account ?? "").trim().toLowerCase() === target;
  });

  if (!row) {
    return { ok: false, error: "指定のメールアドレスに一致するユーザーが見つかりません。", status: 404 };
  }

  // 銀行・支店コードは新しい名称から必ず引き直す。名称だけ更新して旧コードを残すと、
  // freee連携が古いコードで振込先を作り誤送金につながるため（監査指摘 2026-08-05）。
  // マスタで特定できない場合はコードを空にして、管理画面の不足警告に載せる。
  const bankHit = matchBankByName(body.bankName.trim());
  const branchHit = bankHit ? matchBranchByName(bankHit.code, body.branchName.trim()) : null;

  const { error: upErr } = await supabase
    .from("users")
    .update({
      bank_name: body.bankName.trim(),
      branch_name: body.branchName.trim(),
      bank_code: bankHit?.code ?? "",
      branch_code: branchHit?.code ?? "",
      account_type: body.accountType.trim(),
      account_number: body.accountNumber.trim(),
      account_holder: body.accountHolder.trim(),
    })
    .eq("id", row.id);

  if (upErr) {
    console.error("[external-update-bank] update failed:", upErr);
    return { ok: false, error: upErr.message ?? String(upErr), status: 502 };
  }

  // 振込先の変更は「送金先が変わる」操作なのに、外部フォーム経由だと管理者に一切知らされていなかった。
  // 更新後に差分をSlack通知する（内容が同一の再送信は通知しない）。
  // Slack通知の失敗は更新自体を失敗させない（下で握りつぶし、必ず ok:true を返す）。
  try {
    const before: BankInfoSnapshot = {
      bankName: normalize(row.bank_name),
      branchName: normalize(row.branch_name),
      accountType: normalize(row.account_type),
      accountNumber: normalize(row.account_number),
      accountHolder: normalize(row.account_holder),
    };
    const after: BankInfoSnapshot = {
      bankName: body.bankName.trim(),
      branchName: body.branchName.trim(),
      accountType: body.accountType.trim(),
      accountNumber: body.accountNumber.trim(),
      accountHolder: body.accountHolder.trim(),
    };
    const memberName = normalize(row.name) || "（氏名不明）";
    const text = buildBankInfoChangeSlackMessage({ memberName, before, after });
    if (text) {
      const url = resolveSlackWebhookUrl("daily");
      if (url) {
        const r = await postSlackIncomingWebhook(url, { text });
        if (!r.ok) {
          console.warn("[external-update-bank] slack notify failed:", r.error, r.detail);
        }
      }
    }
  } catch (e) {
    console.warn("[external-update-bank] slack notify threw:", e instanceof Error ? e.message : String(e));
  }

  return { ok: true };
}
