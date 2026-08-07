import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { approveNakanoDraft, rejectNakanoDraft } from "@/lib/nakano-loop-data";

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

/** ドラフトの承認（編集込み）・却下（管理者のみ） */
export async function PATCH(req: Request, context: { params: { id: string } }) {
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
  const action = o.action;

  try {
    if (action === "approve") {
      const title = typeof o.title === "string" ? o.title.trim() : "";
      const text = typeof o.body === "string" ? o.body.trim() : "";
      if (!title) {
        return NextResponse.json({ ok: false, error: "タイトルを入力してください" }, { status: 400 });
      }
      if (!text) {
        return NextResponse.json({ ok: false, error: "本文を入力してください" }, { status: 400 });
      }
      const knowledge = await approveNakanoDraft(id, { title, body: text });
      return NextResponse.json({ ok: true, knowledge });
    }
    if (action === "reject") {
      await rejectNakanoDraft(id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "action は approve か reject です" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
