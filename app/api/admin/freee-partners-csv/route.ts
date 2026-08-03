import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { buildFreeePartnersCsv } from "@/lib/freee-partners-csv";
import { loadMembers } from "@/lib/supabase-data";

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

/**
 * freee の取引先マスタインポート形式で有効メンバー（管理者除く）を CSV ダウンロードさせる（管理者のみ）。
 * UTF-8 (BOM 付き)。freee のインポートが文字コードで弾く場合は Shift_JIS 対応を検討する。
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "ログインしてください" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "管理者のみ利用できます" }, { status: 403 });
  }

  const members = await loadMembers();
  if (members === null) {
    return NextResponse.json({ error: "データベースに接続できません" }, { status: 500 });
  }

  const csv = "\uFEFF" + buildFreeePartnersCsv(members);
  const today = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="freee_partners_${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
