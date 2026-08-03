-- users に姓・名の分離欄を追加（税理士要望: freee 取引先名を「姓 名」半角スペース区切りに統一するため）。冪等マイグレーション。
-- name は表示名として維持し、姓・名が確定しているメンバーは name = 「姓 名」（半角スペース1つ）で保持する。
-- 既存メンバーの姓名は、本人確認モーダル（次回ログイン時）または管理者編集で収集する。
--
-- 実行後の PostgREST スキーマキャッシュ:
--   Supabase ダッシュボード → Project Settings → API →「Reload schema」
--   または SQL エディタで次を 1 回実行:
--     NOTIFY pgrst, 'reload schema';

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS first_name TEXT;
