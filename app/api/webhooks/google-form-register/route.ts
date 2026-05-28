import { NextRequest, NextResponse } from "next/server";
import { verifyExternalRegisterSecret } from "@/lib/external-register-auth";
import { GOOGLE_FORM_JP_LABELS } from "@/lib/google-form-jp-register-parser";
import {
  parseExternalRegisterPayload,
  registerMemberFromGoogleForm,
} from "@/lib/external-register-member";

/**
 * Googleフォーム（GAS）→ メンバー自動登録 Webhook
 *
 * GAS から届く JSON キー = フォーム設問タイトル（日本語）そのもの。
 *
 * マッピング:
 * - 『名前　※フルネーム』 → name
 * - 『フリガナ　※フルネーム』 → furigana
 * - 『メールアドレス』 → email（login_account）
 * - 『契約形態』 → contractType（intern | contractor）→ is_intern
 * - 『郵便番号』 → postCode（zip_code）
 * - 『住所』 → address
 * - 『銀行名（例：三菱UFJ銀行）』 → bankName
 * - 『支店名（例：恵比寿支店）』 → branchName
 * - 『口座種別』 → accountType
 * - 『口座番号』 → accountNumber
 * - 『口座名義（カタカナ）』 → accountHolder
 * - 『携帯電話番号』 → phoneNumber
 * - invoice_registration_number（GAS 統合キー: 13番あり/なし + 14番T番号 → T+13桁のみ）
 *   または『インボイス番号をあるにした方は以下に記載』等の日本語キー（後方互換）
 * - 請求管理番号 → invoice_number（allocateNextInvoiceManagementNumber で自動採番）
 *
 * 認証（推奨）: Authorization: Bearer <EXTERNAL_REGISTER_SECRET>
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = verifyExternalRegisterSecret(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON 本文が不正です。" }, { status: 400 });
  }

  const payload = parseExternalRegisterPayload(json);
  if (!payload) {
    return NextResponse.json(
      {
        ok: false,
        error: `『${GOOGLE_FORM_JP_LABELS.name}』と『${GOOGLE_FORM_JP_LABELS.email}』は必須です。`,
      },
      { status: 400 }
    );
  }

  const result = await registerMemberFromGoogleForm(payload);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    id: result.id,
    invoiceManagementNumber: result.invoiceManagementNumber,
    isIntern: result.isIntern,
    contractType: result.contractType,
    saved: {
      name: payload.name,
      furigana: payload.furigana,
      email: payload.email,
      contractType: payload.contractType,
      postCode: payload.postCode,
      address: payload.address,
      bankName: payload.bankName,
      branchName: payload.branchName,
      accountType: payload.accountType,
      accountNumber: payload.accountNumber,
      accountHolder: payload.accountHolder,
      phoneNumber: payload.phoneNumber,
      invoiceRegistrationNumber: payload.invoiceRegistrationNumber,
      invoiceManagementNumber: result.invoiceManagementNumber,
    },
  });
}
