import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { toMember, type DbUser } from "@/lib/supabase-data";

/**
 * ログイン中メンバーの「自分自身の」メンバー情報を返す（RLS段階移行フェーズ1）。
 * - 認証必須（誰でも＝一般メンバー含む）。ただし返すのは**セッション本人の1件のみ**。
 * - service_role で読む（RLSを締めた後もサーバから読める正規経路）。
 * - パスワード（ハッシュ）は返さない。
 *
 * 用途: RLS締め後、クライアントが users を anon 直読みする代わりに、
 *       一般メンバーは本APIで自分の情報を取得する（管理者は /api/admin/members）。
 * まだクライアント未使用（追加のみ・既存動作は不変）。
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY が未設定です" },
      { status: 500 }
    );
  }

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: "メンバーが見つかりません" }, { status: 404 });
  }

  // パスワード（ハッシュ）はクライアントに返さない
  const member = { ...toMember(data as DbUser), password: "" };
  return NextResponse.json({ ok: true, member });
}
