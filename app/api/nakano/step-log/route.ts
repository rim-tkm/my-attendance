import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  getOrCreateNakanoConversation,
  insertNakanoMessage,
  loadNakanoKnowledge,
  touchNakanoConversation,
} from "@/lib/nakano-data";
import { loadNakanoContext } from "@/lib/nakano-server";

export const dynamic = "force-dynamic";

/**
 * ステップ式クイック回答の操作を記録する。
 *
 * どのステップまで進んで解決しなかったかが、FAQ改善の一番の材料になるため残す。
 * source='step' なので回数制限の対象外（Anthropic API を呼んでいない）。
 *
 * 表示した本文はクライアントから受け取らず、stepId から引き直す。
 * ログに残る文言を、送信元がいくらでも書き換えられる形にしないため。
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => null)) as { stepId?: unknown } | null;
    const stepId = typeof body?.stepId === "string" ? body.stepId.trim() : "";
    if (stepId === "") {
      return NextResponse.json({ ok: false, error: "stepId が必要です" }, { status: 400 });
    }

    const ctx = await loadNakanoContext(userId);
    if (!ctx) {
      return NextResponse.json({ ok: false, error: "メンバーが見つかりません" }, { status: 404 });
    }
    if (
      ctx.access.allowed === false &&
      (ctx.access.reason === "not_eligible" || ctx.access.reason === "not_launched")
    ) {
      return NextResponse.json({ ok: false, error: ctx.access.message }, { status: 403 });
    }

    const knowledge = await loadNakanoKnowledge();
    const node = knowledge.find((k) => k.id === stepId && k.showAsStep && k.isActive);
    if (!node) {
      return NextResponse.json({ ok: false, error: "該当の項目がありません" }, { status: 404 });
    }

    const conversation = await getOrCreateNakanoConversation(userId);
    // 質問と回答の両方を残す。片方だけだと、あとから会話を復元したとき
    // 「何を押したか」だけが並んで中身が分からない履歴になる。
    await insertNakanoMessage({
      conversationId: conversation.id,
      userId,
      role: "user",
      content: `［よくある質問］${node.title}`,
      source: "step",
    });
    await insertNakanoMessage({
      conversationId: conversation.id,
      userId,
      role: "assistant",
      content: node.body,
      source: "step",
    });
    await touchNakanoConversation(conversation.id);

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
