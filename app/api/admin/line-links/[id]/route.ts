import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { unlinkLineUser } from "@/lib/line-link-data";

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

/** LINE連携の取り消し（管理者のみ。間違った紐付けの取り消し用。確認は管理画面側で行う） */
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
    if (action === "unlink") {
      await unlinkLineUser(id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "action は unlink です" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
