import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * サーバ専用の Supabase クライアント（service_role キー）。
 *
 * ⚠️ 重要:
 * - service_role キーは RLS をバイパスする管理者権限。**絶対にクライアント（"use client"）へ
 *   import しない**。NEXT_PUBLIC_ 環境変数にも入れない（ブラウザに漏れると RLS が無意味になる）。
 * - このモジュールは API ルート / Server Action など**サーバ実行コードからのみ**使うこと。
 * - RLS を締めた後、users 等の保護テーブルへアクセスする唯一の正規経路。
 *
 * 環境変数:
 * - NEXT_PUBLIC_SUPABASE_URL（URL は公開情報なので共用で可）
 * - SUPABASE_SERVICE_ROLE_KEY（サーバ専用・未設定時は null を返す）
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  // 誤ってクライアントバンドルに載った場合に実行時点で気付けるようにする。
  if (typeof window !== "undefined") {
    throw new Error("getSupabaseAdmin() はサーバ専用です。クライアントから呼び出さないでください。");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
