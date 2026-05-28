import { NextRequest, NextResponse } from "next/server";
import {
  parseExternalUpdateBankPayload,
  updateBankInfoByEmail,
} from "@/lib/external-update-bank-info";

/**
 * メールアドレス（login_account）をキーに銀行口座情報を更新する（スプレッドシート / GAS 向け）。
 * DB は Supabase（Prisma 未使用）。認証なし。
 *
 * JSON 例（英語キー）:
 * { "email", "bankName", "branchName", "accountType", "accountNumber", "accountHolder" }
 *
 * 列名はキーワード部分一致可:
 * メールアドレス、銀行名、支店名、口座種別、口座番号、名義（または口座名義）
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON 本文が不正です。" }, { status: 400 });
  }

  const body = parseExternalUpdateBankPayload(json);
  if (!body) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "メールアドレス・銀行名・支店名・口座種別・口座番号・名義（いずれもキーワード列名可）がすべて必須です。",
      },
      { status: 400 }
    );
  }

  const result = await updateBankInfoByEmail(body);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
