-- profile_confirmations: 本人による登録情報確認のエビデンスログ。冪等マイグレーション。
-- 「この内容で間違いありません」（no_change）または「変更して保存」（updated）の時点で、
-- 確認対象となった登録内容のスナップショット（JSON）と日時を残す。
-- 振込先の誤り等が起きた際に「いつ・本人が・どの内容を確認したか」を証明するための記録。
--
-- 実行後の PostgREST スキーマキャッシュ:
--   Supabase ダッシュボード → Project Settings → API →「Reload schema」
--   または SQL エディタで次を 1 回実行:
--     NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS public.profile_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind TEXT NOT NULL CHECK (kind IN ('no_change', 'updated')),
  snapshot JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profile_confirmations_user ON public.profile_confirmations(user_id, confirmed_at DESC);

ALTER TABLE public.profile_confirmations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for profile_confirmations" ON public.profile_confirmations;
CREATE POLICY "Allow all for profile_confirmations"
  ON public.profile_confirmations FOR ALL USING (true) WITH CHECK (true);
