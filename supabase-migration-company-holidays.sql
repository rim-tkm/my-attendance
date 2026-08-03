-- company_holidays: 会社休業日（お盆・年末年始など）。冪等マイグレーション。
-- 期間（start_date〜end_date）で保持し、期間内の日はメンバーのシフト提出を「稼働予定なし」固定にする。
--
-- 実行後の PostgREST スキーマキャッシュ:
--   Supabase ダッシュボード → Project Settings → API →「Reload schema」
--   または SQL エディタで次を 1 回実行:
--     NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS public.company_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_date <= end_date)
);

ALTER TABLE public.company_holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for company_holidays" ON public.company_holidays;
CREATE POLICY "Allow all for company_holidays"
  ON public.company_holidays FOR ALL USING (true) WITH CHECK (true);
