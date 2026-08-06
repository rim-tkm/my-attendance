import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getOrCreateNakanoConversation, loadNakanoMessages } from "@/lib/nakano-data";
import { loadNakanoContext } from "@/lib/nakano-server";

export const dynamic = "force-dynamic";

/**
 * パネルを開いたときの復元。過去のやりとりと、今AIに質問できるかを返す。
 * 利用可否はここで返すが、画面はこれを表示に使うだけで、実際の遮断は chat 側で行う。
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

    const conversation = await getOrCreateNakanoConversation(userId);
    const messages = await loadNakanoMessages(conversation.id);

    return NextResponse.json({
      ok: true,
      available: ctx.access.allowed,
      message: ctx.access.allowed ? null : ctx.access.message,
      remainingHour: ctx.access.remainingHour,
      remainingDay: ctx.access.remainingDay,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        escalated: m.escalated,
        source: m.source,
        createdAt: m.createdAt,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
