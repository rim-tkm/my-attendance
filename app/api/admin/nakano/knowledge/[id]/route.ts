import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { normalizeNakanoCategory } from "@/lib/nakano";
import {
  deleteNakanoKnowledge,
  loadNakanoKnowledge,
  updateNakanoKnowledge,
  type NakanoKnowledgeInput,
} from "@/lib/nakano-data";

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

/**
 * nextParentId を親にすると循環になるかを判定する。
 * 循環したまま保存すると管理画面のツリー表示が無限に潜って固まるため、保存前に必ず弾く。
 * 既に壊れたデータが入っていても止まれるよう、遡る回数を件数で打ち切る。
 */
function wouldCreateCycle(
  id: string,
  nextParentId: string,
  all: { id: string; parentId: string | null }[]
): boolean {
  const parentOf = new Map(all.map((k) => [k.id, k.parentId]));
  let cursor: string | null = nextParentId;
  for (let hops = 0; cursor != null && hops <= all.length; hops += 1) {
    if (cursor === id) return true;
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}

/** 知識の更新（管理者のみ）。渡されたフィールドだけを部分更新する */
export async function POST(req: Request, context: { params: { id: string } }) {
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

  const patch: Partial<NakanoKnowledgeInput> = {};
  if (typeof o.title === "string") {
    const t = o.title.trim();
    if (!t) return NextResponse.json({ ok: false, error: "タイトルを入力してください" }, { status: 400 });
    patch.title = t;
  }
  if (typeof o.body === "string") {
    const t = o.body.trim();
    if (!t) return NextResponse.json({ ok: false, error: "本文を入力してください" }, { status: 400 });
    patch.body = t;
  }
  if (o.category !== undefined) patch.category = normalizeNakanoCategory(o.category);
  if (typeof o.showAsStep === "boolean") patch.showAsStep = o.showAsStep;
  if (typeof o.isActive === "boolean") patch.isActive = o.isActive;
  if (typeof o.sortOrder === "number" && Number.isFinite(o.sortOrder)) patch.sortOrder = o.sortOrder;

  let nextParentId: string | null | undefined;
  if (o.parentId === null) {
    nextParentId = null;
  } else if (typeof o.parentId === "string") {
    // 空文字の親IDは「親なし」の意味で送られてくるので NULL に倒す。
    nextParentId = o.parentId.trim() ? o.parentId.trim() : null;
  }

  try {
    if (nextParentId !== undefined) {
      if (nextParentId === id) {
        return NextResponse.json({ ok: false, error: "自分自身を親にはできません" }, { status: 400 });
      }
      if (nextParentId !== null) {
        const all = await loadNakanoKnowledge();
        if (wouldCreateCycle(id, nextParentId, all)) {
          return NextResponse.json(
            { ok: false, error: "親子関係が循環します。別の親を選んでください" },
            { status: 400 }
          );
        }
      }
      patch.parentId = nextParentId;
    }

    const knowledge = await updateNakanoKnowledge(id, patch);
    return NextResponse.json({ ok: true, knowledge });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * 知識の削除（管理者のみ）。
 * 子は DB の ON DELETE CASCADE で一緒に消える（孤児になった子がステップUIから
 * 消えるのは buildNakanoStepTree 側でも担保しているが、行自体を残さない）。
 */
export async function DELETE(_req: Request, context: { params: { id: string } }) {
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

  try {
    await deleteNakanoKnowledge(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
