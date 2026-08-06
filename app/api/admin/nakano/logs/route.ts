import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { loadNakanoRecentMessages } from "@/lib/nakano-data";

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** 管理画面「届いた質問」。新しい順・ページング（管理者のみ） */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ ok: false, error: "管理者のみ利用できます" }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const rawLimit = Number(params.get("limit"));
  const rawOffset = Number(params.get("offset"));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_LIMIT) : DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
  const escalatedOnly = params.get("escalatedOnly") === "1";

  try {
    const { rows, hasMore } = await loadNakanoRecentMessages({ limit, offset, escalatedOnly });
    return NextResponse.json({ ok: true, rows, hasMore });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
