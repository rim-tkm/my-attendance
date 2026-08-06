import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { FreeeSyncLogRow } from "@/lib/freee-sync-log";

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

type DbFreeeSyncLog = {
  id: string;
  started_at: string;
  trigger_kind: string;
  ok: boolean;
  company_name: string | null;
  created_count: number | null;
  updated_count: number | null;
  error_count: number | null;
  error_detail: string | null;
};

function toFreeeSyncLogRow(r: DbFreeeSyncLog): FreeeSyncLogRow {
  return {
    id: r.id,
    startedAt: r.started_at,
    triggerKind: r.trigger_kind === "cron" ? "cron" : "manual",
    ok: r.ok === true,
    companyName: r.company_name,
    createdCount: r.created_count ?? 0,
    updatedCount: r.updated_count ?? 0,
    errorCount: r.error_count ?? 0,
    errorDetail: r.error_detail,
  };
}

/** freee 同期の直近10件（管理設定の freee連携カード用・管理者のみ）。テーブル未作成時は空配列で返す */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ ok: false, error: "管理者のみ利用できます" }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY が未設定です" }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("freee_sync_logs")
    .select("id, started_at, trigger_kind, ok, company_name, created_count, updated_count, error_count, error_detail")
    .order("started_at", { ascending: false })
    .limit(10);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const logs = ((data as DbFreeeSyncLog[]) ?? []).map(toFreeeSyncLogRow);
  return NextResponse.json({ ok: true, logs });
}
