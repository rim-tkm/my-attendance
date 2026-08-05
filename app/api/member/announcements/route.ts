import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  isAnnouncementTargetedAt,
  normalizeAnnouncementTarget,
  toAnnouncement,
  type DbAnnouncement,
} from "@/lib/announcements";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * ログイン中メンバーが対象のお知らせ一覧（公開中・終了の両方）を新しい順で返す。
 * readAt は「現在の版に対する本人の確認日時」。未確認は null。
 * announcements テーブルは RLS でポリシーを持たないため service_role でのみ読める。
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY が未設定です" }, { status: 500 });
  }

  const { data: meRow, error: meErr } = await supabase
    .from("users")
    .select("is_intern, is_active, login_account")
    .eq("id", userId)
    .maybeSingle();
  if (meErr) {
    return NextResponse.json({ ok: false, error: meErr.message }, { status: 500 });
  }
  if (!meRow) {
    return NextResponse.json({ ok: false, error: "メンバーが見つかりません" }, { status: 404 });
  }
  const member = {
    isIntern: meRow.is_intern === true,
    isActive: meRow.is_active !== false,
    loginAccount: (meRow.login_account as string | null) ?? "",
  };

  const [{ data: rows, error: listErr }, { data: readRows, error: readErr }] = await Promise.all([
    supabase.from("announcements").select("*").order("created_at", { ascending: false }),
    supabase.from("announcement_reads").select("announcement_id, version, read_at").eq("user_id", userId),
  ]);
  if (listErr) {
    return NextResponse.json({ ok: false, error: listErr.message }, { status: 500 });
  }
  if (readErr) {
    return NextResponse.json({ ok: false, error: readErr.message }, { status: 500 });
  }

  const readMap = new Map<string, string>();
  for (const r of (readRows ?? []) as { announcement_id: string; version: number; read_at: string }[]) {
    readMap.set(`${r.announcement_id}\t${r.version}`, r.read_at);
  }

  const announcements = ((rows as DbAnnouncement[]) ?? [])
    .filter((r) => isAnnouncementTargetedAt(normalizeAnnouncementTarget(r.target), member))
    .map((r) => toAnnouncement(r, readMap.get(`${r.id}\t${r.version ?? 1}`) ?? null));

  return NextResponse.json({ ok: true, announcements });
}
