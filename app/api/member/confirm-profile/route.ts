import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { buildMemberDisplayName } from "@/lib/attendance";
import { authOptions } from "@/lib/auth";
import { getTodayJstDateString } from "@/lib/export-schedule";
import { appendProfileConfirmationLog } from "@/lib/profile-confirmation-log";
import { getSupabase } from "@/lib/supabase";

/**
 * ログイン中メンバー本人が「登録情報に変更なし」を確認した記録（users.profile_confirmed_month = 当月）。
 * 月が変わるとメンバー画面に確認モーダルが再表示される。
 * body に lastName / firstName（両方非空）があれば姓・名を保存し、表示名を「姓 名」（半角スペース）に更新する
 * （税理士要望: freee 取引先名の「姓 名」統一。既存メンバーの姓名分割を本人確認で収集するため）。
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id?.trim();
  if (!userId) {
    return NextResponse.json({ error: "ログインしてください" }, { status: 401 });
  }
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "データベースに接続できません" }, { status: 500 });
  }
  const body = (await req.json().catch(() => ({}))) as { lastName?: unknown; firstName?: unknown };
  const lastName = typeof body.lastName === "string" ? body.lastName.trim().replace(/[\s　]+/g, "") : "";
  const firstName = typeof body.firstName === "string" ? body.firstName.trim().replace(/[\s　]+/g, "") : "";

  const currentMonth = getTodayJstDateString().slice(0, 7);
  const updates: Record<string, unknown> = { profile_confirmed_month: currentMonth };
  if (lastName !== "" && firstName !== "") {
    updates.last_name = lastName;
    updates.first_name = firstName;
    updates.name = buildMemberDisplayName(lastName, firstName);
  }
  const { error } = await supabase.from("users").update(updates).eq("id", userId).eq("is_active", true);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // エビデンス: 確認時点の登録内容スナップショットを記録（失敗しても確認自体は成立させる）
  await appendProfileConfirmationLog(supabase, userId, "no_change");
  return NextResponse.json({ ok: true, month: currentMonth });
}
