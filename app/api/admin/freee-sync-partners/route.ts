import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { syncAllMembersToFreee } from "@/lib/freee-partner-sync";
import { recordFreeeSyncLog } from "@/lib/freee-sync-log";

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

/**
 * 有効メンバー（管理者除く）を freee の取引先として同期する（管理設定の手動ボタン用・管理者のみ）。
 * 実処理は lib/freee-partner-sync.ts の syncAllMembersToFreee（毎日の Cron と共通）。
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !isAdmin(session)) {
    return NextResponse.json({ error: "管理者のみ利用できます" }, { status: 403 });
  }
  const startedAt = new Date();
  const result = await syncAllMembersToFreee();
  await recordFreeeSyncLog("manual", result, startedAt);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    companyName: result.companyName,
    created: result.created,
    updated: result.updated,
    errors: result.errors,
    linked: result.linked,
  });
}
