-- users に銀行コード・支店コードを追加（freee 連携＝取引先の振込口座登録の前提）。冪等マイグレーション。
-- bank_code は全銀協4桁、branch_code は3桁。名称（bank_name/branch_name）と併存させる。
--
-- 実行後の PostgREST スキーマキャッシュ:
--   Supabase ダッシュボード → Project Settings → API →「Reload schema」
--   または SQL エディタで次を 1 回実行:
--     NOTIFY pgrst, 'reload schema';

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS bank_code TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS branch_code TEXT;
