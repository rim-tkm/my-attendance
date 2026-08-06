import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

/**
 * 中野くんを表示してよいかだけを返す、メンバー画面のマウント時に叩く軽い問い合わせ。
 *
 * 知識が1件も入っていない間はボタンごと出さない。
 * 空のまま公開すると、全メンバーが押しては「準備中です」を見ることになり、
 * 「使えないもの」という第一印象がついてしまうため。
 *
 * テーブル未作成・接続不可などの失敗はすべて ready:false に倒して 200 を返す。
 * ここでエラーを返すと、機能をまだ使っていないメンバーの画面にエラーが出てしまう。
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ ok: true, ready: false });
  }

  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ ok: true, ready: false });

    const { count, error } = await supabase
      .from("nakano_knowledge")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);
    if (error) return NextResponse.json({ ok: true, ready: false });

    return NextResponse.json({ ok: true, ready: (count ?? 0) > 0 });
  } catch {
    return NextResponse.json({ ok: true, ready: false });
  }
}
