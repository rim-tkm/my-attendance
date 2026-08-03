import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getFreeeClientConfig, loadFreeeTokens } from "@/lib/freee-api";

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

/** freee 連携の接続状態（管理設定カードの表示用・管理者のみ） */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !isAdmin(session)) {
    return NextResponse.json({ error: "管理者のみ利用できます" }, { status: 403 });
  }
  const configured = getFreeeClientConfig() != null;
  const tokens = configured ? await loadFreeeTokens() : null;
  return NextResponse.json({
    ok: true,
    configured,
    connected: tokens != null && tokens.company_id != null,
    companyName: tokens?.company_name ?? null,
  });
}
