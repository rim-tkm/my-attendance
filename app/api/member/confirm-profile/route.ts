import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getTodayJstDateString } from "@/lib/export-schedule";
import { getSupabase } from "@/lib/supabase";

/**
 * ログイン中メンバー本人が「登録情報に変更なし」を確認した記録（users.profile_confirmed_month = 当月）。
 * 月が変わるとメンバー画面に確認モーダルが再表示される。
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id?.trim();
  if (!userId) {
    return NextResponse.json({ error: "ログインしてください" }, { status: 401 });
  }
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "データベースに接続できません" }, { status: 500 });
  }
  const currentMonth = getTodayJstDateString().slice(0, 7);
  const { error } = await supabase
    .from("users")
    .update({ profile_confirmed_month: currentMonth })
    .eq("id", userId)
    .eq("is_active", true);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, month: currentMonth });
}
