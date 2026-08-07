-- LINEアカウント紐付け（個別コード方式）用カラム追加
-- 設計: docs/superpowers/specs/2026-08-07-line-account-linking-design.md §4
--
-- 実行後、PostgREST のスキーマキャッシュを更新すること:
--   Supabase ダッシュボード → Project Settings → API →「Reload schema」
--   または SQL エディタで: NOTIFY pgrst, 'reload schema';

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS line_user_id TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS line_link_code TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS line_linked_at TIMESTAMPTZ;

-- 1つのLINEアカウントに複数メンバーが紐付く事故と、コードの重複採番をDB層でも防ぐ
CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_line_user_id
  ON public.users (line_user_id) WHERE line_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_line_link_code
  ON public.users (line_link_code) WHERE line_link_code IS NOT NULL;
