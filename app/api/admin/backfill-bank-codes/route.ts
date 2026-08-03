import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { matchBankByName, matchBranchByName } from "@/lib/bank-master";
import { getSupabase } from "@/lib/supabase";

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

type BackfillResultRow = {
  name: string;
  bankName: string;
  branchName: string;
  status: "updated" | "unmatched";
  /** 照合できなかった側（銀行 / 支店） */
  detail?: string;
};

/**
 * 既存メンバーの銀行名・支店名から銀行コード・支店コードを一括照合して補完する（管理者のみ）。
 * 正規化名の完全一致（なければ前方一致が1件のときだけ）で照合し、曖昧なものは更新せず unmatched で返す。
 * コードが両方入っているメンバーはスキップ。何度実行しても安全（冪等）。
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "ログインしてください" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "管理者のみ利用できます" }, { status: 403 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "データベースに接続できません" }, { status: 500 });
  }

  const { data: rows, error } = await supabase
    .from("users")
    .select("id, name, login_account, is_active, bank_name, branch_name, bank_code, branch_code")
    .eq("is_active", true);
  if (error) {
    return NextResponse.json({ error: error.message ?? String(error) }, { status: 500 });
  }

  const results: BackfillResultRow[] = [];
  let updatedCount = 0;
  let skippedCount = 0;

  for (const r of rows ?? []) {
    if (((r.login_account as string | null) ?? "").trim().toLowerCase() === "admin") continue;
    const bankName = ((r.bank_name as string | null) ?? "").trim();
    const branchName = ((r.branch_name as string | null) ?? "").trim();
    const bankCode = ((r.bank_code as string | null) ?? "").trim();
    const branchCode = ((r.branch_code as string | null) ?? "").trim();
    if (bankName === "") continue; // 振込先未入力は対象外（未登録カードで別途検知される）
    if (bankCode !== "" && (branchCode !== "" || branchName === "")) {
      skippedCount++;
      continue;
    }

    const bankHit = bankCode !== "" ? { code: bankCode, name: bankName, kana: "" } : matchBankByName(bankName);
    if (!bankHit) {
      results.push({ name: r.name as string, bankName, branchName, status: "unmatched", detail: "銀行名を照合できません" });
      continue;
    }
    let nextBranchCode = branchCode;
    let branchUnmatched = false;
    if (branchCode === "" && branchName !== "") {
      const branchHit = matchBranchByName(bankHit.code, branchName);
      if (branchHit) nextBranchCode = branchHit.code;
      else branchUnmatched = true;
    }

    const body: Record<string, unknown> = { bank_code: bankHit.code };
    if (nextBranchCode !== "") body.branch_code = nextBranchCode;
    const { error: updErr } = await supabase.from("users").update(body).eq("id", r.id as string);
    if (updErr) {
      results.push({
        name: r.name as string,
        bankName,
        branchName,
        status: "unmatched",
        detail: `更新エラー: ${updErr.message}`,
      });
      continue;
    }
    updatedCount++;
    if (branchUnmatched) {
      results.push({
        name: r.name as string,
        bankName,
        branchName,
        status: "unmatched",
        detail: "支店名を照合できません（銀行コードのみ補完済み）",
      });
    } else {
      results.push({ name: r.name as string, bankName, branchName, status: "updated" });
    }
  }

  return NextResponse.json({
    ok: true,
    updatedCount,
    skippedCount,
    unmatched: results.filter((x) => x.status === "unmatched"),
  });
}
