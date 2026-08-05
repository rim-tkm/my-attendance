import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { postSlackIncomingWebhook, resolveSlackWebhookUrl } from "@/lib/slack-webhook";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * 打刻押し忘れロック: 本人による規約同意の記録（エビデンス）。
 * - 認証必須。更新できるのはセッション本人の行のみ。
 * - 同意しただけではロックは解除されない（公式LINEの報告を管理者が確認して解除する）。
 * - 同意時に Slack へ通知し、管理者が LINE 確認 → 解除に動けるようにする。
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
  const month = typeof o.month === "string" && /^\d{4}-\d{2}$/.test(o.month) ? o.month : "";
  const count =
    typeof o.count === "number" && Number.isFinite(o.count) && o.count > 0 ? Math.floor(o.count) : 0;
  if (!month) {
    return NextResponse.json({ ok: false, error: "month が不正です" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY が未設定です" }, { status: 500 });
  }

  const { data: row, error: selErr } = await supabase
    .from("users")
    .select("name")
    .eq("id", userId)
    .maybeSingle();
  if (selErr || !row) {
    return NextResponse.json({ ok: false, error: "メンバーが見つかりません" }, { status: 404 });
  }

  const { error: upErr } = await supabase
    .from("users")
    .update({ punch_miss_agreed_month: month, punch_miss_agreed_at: new Date().toISOString() })
    .eq("id", userId);
  if (upErr) {
    return NextResponse.json({ ok: false, error: upErr.message ?? String(upErr) }, { status: 500 });
  }

  // 管理者向け通知（失敗しても同意記録は成立しているので結果は返す）
  const webhook = resolveSlackWebhookUrl("daily");
  if (webhook) {
    const name = ((row.name as string | null) ?? "").trim() || "（名前なし）";
    await postSlackIncomingWebhook(webhook, {
      text: `🔒 ${name} さんが打刻押し忘れ規約に同意しました（今月${count > 0 ? `${count}回目` : "3回以上"}）。\n公式LINEの報告メッセージを確認し、問題なければ管理画面の「管理設定 → メンバー」からロックを解除してください。`,
    });
  }

  return NextResponse.json({ ok: true });
}
