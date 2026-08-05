import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { normalizeAnnouncementTarget } from "@/lib/announcements";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

/**
 * お知らせの編集・公開終了（管理者のみ）。
 * requireReconfirm=true のとき版数を +1 し、確認済みのメンバーも未確認に戻す。
 */
export async function POST(req: Request, context: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ ok: false, error: "管理者のみ利用できます" }, { status: 403 });
  }
  const id = (context.params.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ ok: false, error: "ID が指定されていません" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "不正な JSON です" }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY が未設定です" }, { status: 500 });
  }

  const { data: current, error: selErr } = await supabase
    .from("announcements")
    .select("version")
    .eq("id", id)
    .maybeSingle();
  if (selErr) {
    return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 });
  }
  if (!current) {
    return NextResponse.json({ ok: false, error: "お知らせが見つかりません" }, { status: 404 });
  }
  const currentVersion = typeof current.version === "number" ? current.version : 1;
  const nextVersion = o.requireReconfirm === true ? currentVersion + 1 : currentVersion;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), version: nextVersion };
  if (typeof o.title === "string") {
    const t = o.title.trim();
    if (!t) return NextResponse.json({ ok: false, error: "タイトルを入力してください" }, { status: 400 });
    patch.title = t;
  }
  if (typeof o.body === "string") {
    const t = o.body.trim();
    if (!t) return NextResponse.json({ ok: false, error: "本文を入力してください" }, { status: 400 });
    patch.body = t;
  }
  if (typeof o.target === "string") patch.target = normalizeAnnouncementTarget(o.target);
  if (typeof o.isRequired === "boolean") patch.is_required = o.isRequired;
  if (typeof o.isPublished === "boolean") patch.is_published = o.isPublished;

  const { error: upErr } = await supabase.from("announcements").update(patch).eq("id", id);
  if (upErr) {
    return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, version: nextVersion });
}
