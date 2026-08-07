import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { issueLineLinkCodes, loadLineLinkRows } from "@/lib/line-link-data";

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

/** LINE連携状況の一覧（管理者のみ） */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ ok: false, error: "管理者のみ利用できます" }, { status: 403 });
  }

  try {
    const rows = await loadLineLinkRows();
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/** 未発行メンバーへの連携コード一括発行（管理者のみ） */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ ok: false, error: "管理者のみ利用できます" }, { status: 403 });
  }

  try {
    const issued = await issueLineLinkCodes();
    return NextResponse.json({ ok: true, issued });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
