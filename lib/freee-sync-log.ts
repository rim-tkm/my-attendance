import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { FreeeSyncSummary } from "@/lib/freee-partner-sync";

/** error_detail に入れる文字列の上限（暴走したエラーメッセージでレコードが肥大化しないように） */
const ERROR_DETAIL_MAX_LENGTH = 2000;

/** freee_sync_logs テーブルの1行（camelCase） */
export type FreeeSyncLogRow = {
  id: string;
  startedAt: string;
  triggerKind: "manual" | "cron";
  ok: boolean;
  companyName: string | null;
  createdCount: number;
  updatedCount: number;
  errorCount: number;
  errorDetail: string | null;
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…（省略）` : text;
}

/** メンバー単位のエラー一覧を「件数＋先頭数件の名前・内容」に要約する（全件を詰め込まない） */
function summarizeMemberErrors(errors: { name: string; detail?: string }[]): string {
  const SHOWN = 5;
  const shown = errors
    .slice(0, SHOWN)
    .map((e) => `${e.name}: ${e.detail ?? "エラー"}`)
    .join(" / ");
  const rest = errors.length - SHOWN;
  return rest > 0 ? `${errors.length}件のエラー — ${shown} 他${rest}件` : `${errors.length}件のエラー — ${shown}`;
}

/**
 * freee 取引先同期の実行結果を freee_sync_logs に1行記録する（サーバー専用）。
 * ⚠️ 記録の失敗は同期本体に影響させない: insert 自体を try/catch で握りつぶし、
 * テーブル未作成（マイグレーション未実行）や一時的な接続断でも同期の成否には無関係にする。
 * 呼び出し側は結果を待つ必要はないが、await して例外が漏れないことだけ保証する。
 */
export async function recordFreeeSyncLog(
  triggerKind: "manual" | "cron",
  result: FreeeSyncSummary,
  startedAt: Date
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      console.warn("[freee-sync-log] SUPABASE_SERVICE_ROLE_KEY が未設定のため記録をスキップしました");
      return;
    }
    const row = result.ok
      ? {
          started_at: startedAt.toISOString(),
          trigger_kind: triggerKind,
          ok: true,
          company_name: result.companyName,
          created_count: result.created,
          updated_count: result.updated,
          error_count: result.errors.length,
          error_detail: result.errors.length > 0 ? truncate(summarizeMemberErrors(result.errors), ERROR_DETAIL_MAX_LENGTH) : null,
        }
      : {
          started_at: startedAt.toISOString(),
          trigger_kind: triggerKind,
          ok: false,
          company_name: null,
          created_count: 0,
          updated_count: 0,
          error_count: 0,
          error_detail: truncate(result.error, ERROR_DETAIL_MAX_LENGTH),
        };
    const { error } = await supabase.from("freee_sync_logs").insert(row);
    if (error) console.warn("[freee-sync-log] 記録に失敗しました:", error);
  } catch (e) {
    // テーブル未作成・ネットワークエラー等、想定外の例外もここで必ず飲み込む
    console.warn("[freee-sync-log] 記録中に例外が発生しました:", e instanceof Error ? e.message : String(e));
  }
}
