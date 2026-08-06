import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { buildNakanoStepTree } from "@/lib/nakano";
import { loadNakanoKnowledge } from "@/lib/nakano-data";
import { loadNakanoContext } from "@/lib/nakano-server";

export const dynamic = "force-dynamic";

/**
 * ステップ式クイック回答のツリー。
 *
 * 一度これを返せば、以降のボタン遷移はブラウザ内で完結する（サーバー往復もAPI課金も無い）。
 * 稼働時間帯・回数の制限は掛けない。費用が発生しないうえ、
 * 稼働時間外にルールを確認したい場面は正当なため。対象者かどうかだけは見る。
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }

  try {
    const ctx = await loadNakanoContext(userId);
    if (!ctx) {
      return NextResponse.json({ ok: false, error: "メンバーが見つかりません" }, { status: 404 });
    }
    // 対象外（インターン・無効メンバー）には知識そのものを渡さない。
    if (
      ctx.access.allowed === false &&
      (ctx.access.reason === "not_eligible" || ctx.access.reason === "not_launched")
    ) {
      return NextResponse.json({ ok: false, error: ctx.access.message }, { status: 403 });
    }

    const knowledge = await loadNakanoKnowledge();
    return NextResponse.json({ ok: true, steps: buildNakanoStepTree(knowledge) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
