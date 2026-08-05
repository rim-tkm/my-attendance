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

const READ_ROWS_PAGE_SIZE = 1000;

type DbReadRow = { announcement_id: string; version: number; read_at: string };

/**
 * 本人の確認記録を全件取得（PostgREST の 1 リクエスト行上限を超えないようページング）。
 * announcement_reads はお知らせ×版数の分だけ増えるため、1000行を超えると
 * 確認記録が黙って切り捨てられ、確認済みの必読で再びブロックされてしまう。
 * 途中で失敗したら部分結果を返さず throw する（管理者側と同じ方針）。
 */
async function loadMyAnnouncementReadRows(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  userId: string
): Promise<DbReadRow[]> {
  const out: DbReadRow[] = [];
  for (let from = 0; ; from += READ_ROWS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("announcement_reads")
      .select("announcement_id, version, read_at")
      .eq("user_id", userId)
      .order("read_at")
      .order("id")
      .range(from, from + READ_ROWS_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []) as DbReadRow[];
    out.push(...chunk);
    if (chunk.length < READ_ROWS_PAGE_SIZE) break;
  }
  return out;
}

/**
 * ログイン中メンバーが対象のお知らせ一覧（公開中・終了の両方）を新しい順で返す。
 * readAt は「現在の版に対する本人の確認日時」。未確認は null。
 * announcements テーブルは RLS でポリシーを持たないため service_role でのみ読める。
 * 取得失敗時は 500 を返す。呼び出し側は fail-open とし、稼働をブロックしないこと（設計書のエラー処理方針）。
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

  const [{ data: meRow, error: meErr }, { data: rows, error: listErr }] = await Promise.all([
    supabase.from("users").select("is_intern, is_active, login_account").eq("id", userId).maybeSingle(),
    supabase
      .from("announcements")
      .select("id, title, body, target, is_required, is_published, version, created_at, updated_at")
      .order("created_at", { ascending: false }),
  ]);
  if (meErr) {
    return NextResponse.json({ ok: false, error: meErr.message }, { status: 500 });
  }
  if (!meRow) {
    return NextResponse.json({ ok: false, error: "メンバーが見つかりません" }, { status: 404 });
  }
  if (listErr) {
    return NextResponse.json({ ok: false, error: listErr.message }, { status: 500 });
  }

  let readRows: DbReadRow[];
  try {
    readRows = await loadMyAnnouncementReadRows(supabase, userId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  const member = {
    isIntern: meRow.is_intern === true,
    isActive: meRow.is_active !== false,
    loginAccount: (meRow.login_account as string | null) ?? "",
  };

  const readMap = new Map<string, string>();
  for (const r of readRows) {
    readMap.set(`${r.announcement_id}\t${r.version}`, r.read_at);
  }

  const announcements = ((rows as DbAnnouncement[]) ?? [])
    .filter((r) => isAnnouncementTargetedAt(normalizeAnnouncementTarget(r.target), member))
    .map((r) => toAnnouncement(r, readMap.get(`${r.id}\t${r.version ?? 1}`) ?? null));

  return NextResponse.json({ ok: true, announcements });
}
