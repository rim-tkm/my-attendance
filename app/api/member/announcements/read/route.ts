import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { isAnnouncementTargetedAt, normalizeAnnouncementTarget } from "@/lib/announcements";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * 本人によるお知らせ確認の記録。
 * - 宛先に含まれない人からの確認は 403（画面を回避した経路も塞ぐ）
 * - 送られた版数が最新でなければ 409（編集直後の競合。クライアントは再取得する）
 * - 二重送信（一意制約違反）は成功として扱う
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "不正な JSON です" }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;
  const announcementId = typeof o.announcementId === "string" ? o.announcementId.trim() : "";
  const version =
    typeof o.version === "number" && Number.isFinite(o.version) ? Math.floor(o.version) : NaN;
  if (!announcementId || !Number.isFinite(version)) {
    return NextResponse.json({ ok: false, error: "announcementId と version が必要です" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY が未設定です" }, { status: 500 });
  }

  const [{ data: annRow, error: annErr }, { data: meRow, error: meErr }] = await Promise.all([
    supabase.from("announcements").select("id, target, version").eq("id", announcementId).maybeSingle(),
    supabase.from("users").select("is_intern, is_active, login_account").eq("id", userId).maybeSingle(),
  ]);
  if (annErr) {
    return NextResponse.json({ ok: false, error: annErr.message }, { status: 500 });
  }
  if (meErr) {
    return NextResponse.json({ ok: false, error: meErr.message }, { status: 500 });
  }
  if (!annRow) {
    return NextResponse.json({ ok: false, error: "お知らせが見つかりません" }, { status: 404 });
  }
  if (!meRow) {
    return NextResponse.json({ ok: false, error: "メンバーが見つかりません" }, { status: 404 });
  }

  const targeted = isAnnouncementTargetedAt(normalizeAnnouncementTarget(annRow.target as string | null), {
    isIntern: meRow.is_intern === true,
    isActive: meRow.is_active !== false,
    loginAccount: (meRow.login_account as string | null) ?? "",
  });
  if (!targeted) {
    return NextResponse.json({ ok: false, error: "このお知らせの対象ではありません" }, { status: 403 });
  }

  const currentVersion = typeof annRow.version === "number" ? annRow.version : 1;
  if (currentVersion !== version) {
    return NextResponse.json(
      { ok: false, error: "お知らせが更新されています。最新の内容を確認してください。", currentVersion },
      { status: 409 }
    );
  }

  const { error: insErr } = await supabase.from("announcement_reads").insert({
    announcement_id: announcementId,
    user_id: userId,
    version: currentVersion,
  });
  if (insErr && !/duplicate key|unique|23505/i.test(insErr.message ?? "")) {
    return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
