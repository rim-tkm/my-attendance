import { NextRequest, NextResponse } from "next/server";
import {
  parseExternalMemberDetailsPayload,
  updateMemberDetailsByEmail,
} from "@/lib/external-update-member-details";

/**
 * メール（login_account）をキーに、口座・インボイス等の追加情報を部分更新する（GAS / スプレッドシート向け）。
 * DB は Supabase（Prisma 未使用）。認証なし。
 *
 * メールアドレス必須。その他は送られたキーワード列のみ更新。
 *
 * 列名キーワード例:
 * 名前（フルネーム）/ 氏名 / name → name
 * フリガナ / furigana → furigana
 * 郵便番号 / postCode → zip_code
 * 住所 / address → address
 * 銀行名 / 支店名 / 口座種別 / 口座番号 / 口座名義
 * 携帯電話番号 → phone_number
 * インボイス番号 / invoiceRegistrationNumber → invoice_registration_number（請求管理番号 invoice_number とは別）
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON 本文が不正です。" }, { status: 400 });
  }

  const patch = parseExternalMemberDetailsPayload(json);
  if (!patch) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "メールアドレス（メールアドレス列または email）と、更新する項目（名前・フリガナ・郵便番号・住所・口座・携帯・インボイス番号等）のいずれか1つ以上が必要です。",
      },
      { status: 400 }
    );
  }

  const result = await updateMemberDetailsByEmail(patch);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
