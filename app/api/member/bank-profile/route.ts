import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { validateQualifiedInvoiceRegistrationNumber } from "@/lib/invoice-registration-number";
import { coerceMemberSelfBankProfileBody } from "@/lib/member-bank-profile-api";
import { getSupabase } from "@/lib/supabase";
import { updateMemberSelfBankProfileOrThrow } from "@/lib/supabase-data";

/**
 * ログイン中メンバー本人のみ: 振込先・住所・電話・適格請求書登録番号の更新。
 * 請求管理番号（users.invoice_number）は更新対象外。
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id?.trim();
  if (!userId) {
    return NextResponse.json({ error: "ログインしてください" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "不正な JSON です" }, { status: 400 });
  }

  const updates = coerceMemberSelfBankProfileBody(json);
  if (!updates) {
    return NextResponse.json({ error: "更新内容が不正です" }, { status: 400 });
  }

  const zip = (updates.postalCode ?? "").trim();
  const addr = (updates.address ?? "").trim();
  const bank = (updates.bankName ?? "").trim();
  const branch = (updates.branchName ?? "").trim();
  const accNum = (updates.accountNumber ?? "").trim();
  const accHolder = (updates.accountHolder ?? "").trim();
  const phone = (updates.phoneNumber ?? "").trim();
  const missing: string[] = [];
  if (!zip) missing.push("郵便番号");
  if (!addr) missing.push("住所");
  if (!bank) missing.push("銀行名");
  if (!branch) missing.push("支店名");
  if (!accNum) missing.push("口座番号");
  if (!accHolder) missing.push("口座名義");
  if (!phone) missing.push("電話番号");
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `未入力の項目があります: ${missing.join("、")}` },
      { status: 400 }
    );
  }

  const invRegRaw =
    updates.invoiceRegistrationNumber !== undefined
      ? String(updates.invoiceRegistrationNumber)
      : "";
  const invRegCheck = validateQualifiedInvoiceRegistrationNumber(invRegRaw);
  if (!invRegCheck.ok) {
    return NextResponse.json({ error: invRegCheck.message }, { status: 400 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "データベースに接続できません" }, { status: 500 });
  }

  const { data: row, error: selErr } = await supabase
    .from("users")
    .select("id, is_active, login_account")
    .eq("id", userId)
    .maybeSingle();
  if (selErr) {
    const m = (selErr as { message?: string }).message ?? String(selErr);
    return NextResponse.json({ error: m }, { status: 500 });
  }
  if (!row || row.is_active === false) {
    return NextResponse.json({ error: "アカウントが見つかりません" }, { status: 403 });
  }
  if ((row.login_account as string | null | undefined)?.trim().toLowerCase() === "admin") {
    return NextResponse.json({ error: "管理者アカウントはこの API では更新できません" }, { status: 403 });
  }

  try {
    await updateMemberSelfBankProfileOrThrow(userId, {
      postalCode: zip,
      address: addr,
      bankName: bank,
      branchName: branch,
      accountType: (updates.accountType ?? "普通").trim() || "普通",
      accountNumber: accNum,
      accountHolder: accHolder,
      phoneNumber: phone,
      invoiceRegistrationNumber: invRegCheck.value,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
