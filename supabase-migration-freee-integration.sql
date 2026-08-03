-- freee 連携: OAuth トークン保管テーブル＋users に freee 取引先ID。冪等マイグレーション。
--
-- ⚠️ freee_oauth_tokens は RLS を有効化し **ポリシーを作らない**（anon キーからは読み書き不可）。
--    サーバー側の service_role キー（SUPABASE_SERVICE_ROLE_KEY）経由でのみアクセスする。
--    誤って "Allow all" ポリシーを付けるとブラウザからトークンが読めてしまうので付けないこと。
--
-- 実行後の PostgREST スキーマキャッシュ:
--   Supabase ダッシュボード → Project Settings → API →「Reload schema」
--   または SQL エディタで次を 1 回実行:
--     NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS public.freee_oauth_tokens (
  id TEXT PRIMARY KEY DEFAULT 'default',
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  company_id BIGINT,
  company_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.freee_oauth_tokens ENABLE ROW LEVEL SECURITY;
-- ポリシーは意図的に作成しない（service_role のみアクセス可能にするため）

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS freee_partner_id BIGINT;
