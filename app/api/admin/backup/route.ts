import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { exportAllDataFromSupabase, importAllDataToSupabase } from "@/lib/supabase-data";

/**
 * バックアップのエクスポート/復元（管理者のみ・RLS段階移行フェーズ1）。
 * 以前は管理画面のブラウザから anon 直クエリで実行していたが、users の RLS を
 * 締めた後も動くようサーバ経由に集約する（サーバでは users は service_role で読む）。
 * バックアップJSONにはパスワードハッシュ・口座情報が含まれるため管理者限定。
 */
function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

async function requireAdmin(): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ ok: false, error: "管理者のみ利用できます" }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const data = await exportAllDataFromSupabase();
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "不正な JSON です" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "不正なバックアップデータです" }, { status: 400 });
  }
  try {
    await importAllDataToSupabase(body as Parameters<typeof importAllDataToSupabase>[0]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
