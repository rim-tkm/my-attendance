import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { normalizeNakanoCategory } from "@/lib/nakano";
import { insertNakanoKnowledge, loadNakanoKnowledge } from "@/lib/nakano-data";

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

/** 中野くんの知識を全件返す（管理者のみ） */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ ok: false, error: "管理者のみ利用できます" }, { status: 403 });
  }

  try {
    const knowledge = await loadNakanoKnowledge();
    return NextResponse.json({ ok: true, knowledge });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/** 知識の新規追加（管理者のみ） */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ ok: false, error: "管理者のみ利用できます" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "不正な JSON です" }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;

  const title = typeof o.title === "string" ? o.title.trim() : "";
  const text = typeof o.body === "string" ? o.body.trim() : "";
  if (!title) {
    return NextResponse.json({ ok: false, error: "タイトルを入力してください" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ ok: false, error: "本文を入力してください" }, { status: 400 });
  }

  // 空文字の親IDは「親なし」の意味で送られてくるので NULL に倒す（外部キー違反を避ける）。
  const rawParent = typeof o.parentId === "string" ? o.parentId.trim() : "";
  const parentId = rawParent ? rawParent : null;

  try {
    const knowledge = await insertNakanoKnowledge({
      title,
      body: text,
      category: normalizeNakanoCategory(o.category),
      parentId,
      showAsStep: o.showAsStep === true,
      isActive: o.isActive !== false,
      sortOrder: typeof o.sortOrder === "number" && Number.isFinite(o.sortOrder) ? o.sortOrder : 0,
    });
    return NextResponse.json({ ok: true, knowledge });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
