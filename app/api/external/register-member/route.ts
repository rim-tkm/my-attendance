import { NextRequest, NextResponse } from "next/server";
import { verifyExternalRegisterSecret } from "@/lib/external-register-auth";
import {
  parseExternalRegisterPayload,
  registerMemberFromGoogleForm,
} from "@/lib/external-register-member";

/**
 * Googleフォーム（Apps Script 等）からメンバーを登録する（従来パス）。
 * 新規連携は `/api/webhooks/google-form-register` も利用可。
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

  const body = parseExternalRegisterPayload(json);
  if (!body) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "氏名/名前・メールアドレスが必須です。契約形態は「インターン」または「業務委託」。フリガナ・住所・振込先・携帯・インボイス番号は任意です。",
      },
      { status: 400 }
    );
  }

  const result = await registerMemberFromGoogleForm(body);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    id: result.id,
    invoiceManagementNumber: result.invoiceManagementNumber,
    isIntern: result.isIntern,
  });
}
