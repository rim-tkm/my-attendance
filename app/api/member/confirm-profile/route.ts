import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { buildMemberDisplayName } from "@/lib/attendance";
import { authOptions } from "@/lib/auth";
import { getTodayJstDateString } from "@/lib/export-schedule";
import { appendProfileConfirmationLog } from "@/lib/profile-confirmation-log";
import { getUsersDb } from "@/lib/supabase-data";

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
  const supabase = getUsersDb();
  if (!supabase) {
    return NextResponse.json({ error: "データベースに接続できません" }, { status: 500 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    lastName?: unknown;
    firstName?: unknown;
    furigana?: unknown;
    invoiceIntent?: unknown;
    markConfirmed?: unknown;
  };
  // false のときは姓名等の保存のみで「当月確認完了」にはしない（「変更がある」経由。
  // 確認完了はフォーム保存時に bank-profile API が付ける＝実際に修正するまで稼働ブロックを維持）
  const markConfirmed = body.markConfirmed !== false;
  const lastName = typeof body.lastName === "string" ? body.lastName.trim().replace(/[\s　]+/g, "") : "";
  const firstName = typeof body.firstName === "string" ? body.firstName.trim().replace(/[\s　]+/g, "") : "";
  const furigana = typeof body.furigana === "string" ? body.furigana.trim() : "";
  const invoiceIntent =
    typeof body.invoiceIntent === "string" && ["yes", "no", "unknown"].includes(body.invoiceIntent)
      ? body.invoiceIntent
      : "";

  const currentMonth = getTodayJstDateString().slice(0, 7);
  const updates: Record<string, unknown> = markConfirmed ? { profile_confirmed_month: currentMonth } : {};
  if (lastName !== "" && firstName !== "") {
    updates.last_name = lastName;
    updates.first_name = firstName;
    updates.name = buildMemberDisplayName(lastName, firstName);
  }
  if (furigana !== "") {
    updates.furigana = furigana;
  }
  if (invoiceIntent !== "") {
    updates.invoice_registration_intent = invoiceIntent;
  }
  if (Object.keys(updates).length > 0) {
    const { data: updatedRows, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", userId)
      .eq("is_active", true)
      .select("id");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!updatedRows || updatedRows.length === 0) {
      return NextResponse.json({ error: "アカウントが見つかりません（無効化されている可能性があります）" }, { status: 403 });
    }
  }
  // エビデンス: 「間違いなし」で確認完了したときのみスナップショットを記録
  // （「変更がある」経由は実際の保存時に bank-profile API が updated として記録する）
  if (markConfirmed) {
    await appendProfileConfirmationLog(supabase, userId, "no_change");
  }
  return NextResponse.json({ ok: true, month: markConfirmed ? currentMonth : null });
}
