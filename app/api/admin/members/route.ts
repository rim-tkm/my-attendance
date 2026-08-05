import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { DEFAULT_HOURLY_RATE } from "@/lib/attendance";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { addMember, toMember, type DbUser } from "@/lib/supabase-data";

/**
 * サーバ側メンバー取得API（RLS段階移行フェーズ1・docs/RLS_MIGRATION_PLAN.md）。
 * - 認証必須（管理者のみ）。
 * - service_role クライアントで users を読む（RLSを締めた後もサーバからは読める正規経路）。
 * - **パスワード（ハッシュ）はレスポンスに含めない**。
 *
 * まだクライアントからは未使用（追加のみ・既存動作は不変）。
 * 検証: 管理者でログインした状態でブラウザから GET すると members が返る＝service_roleキーが有効。
 */
function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ ok: false, error: "管理者のみ利用できます" }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY が未設定です" },
      { status: 500 }
    );
  }

  const { data, error } = await supabase.from("users").select("*").order("name");
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // パスワード（ハッシュ）はクライアントに返さない
  const members = ((data as DbUser[]) ?? []).map(toMember).map((m) => ({ ...m, password: "" }));
  return NextResponse.json({ ok: true, count: members.length, members });
}

/** メンバー新規作成（管理者のみ）。管理画面のブラウザ直インサートを置き換えるサーバ経路。 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ ok: false, error: "管理者のみ利用できます" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "不正な JSON です" }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (!name) {
    return NextResponse.json({ ok: false, error: "名前を入力してください" }, { status: 400 });
  }
  const loginAccount = typeof o.loginAccount === "string" ? o.loginAccount.trim() : "";
  const password = typeof o.password === "string" ? o.password : "";
  const hourlyRate =
    typeof o.hourlyRate === "number" && Number.isFinite(o.hourlyRate) && o.hourlyRate >= 0
      ? o.hourlyRate
      : DEFAULT_HOURLY_RATE;

  try {
    const member = await addMember(name, { loginAccount, password, hourlyRate });
    return NextResponse.json({ ok: true, id: member.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
