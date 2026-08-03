-- company_holiday_suggestion_dismissals: 休業日提案の「今回は不要」記録。冪等マイグレーション。
-- suggestion_key はロジック側の安定キー（例: "obon-2026", "nh-2026-09-21"）。
-- 年ごとにキーが変わるため、翌年の同じ連休はまた提案される。
--
-- 実行後の PostgREST スキーマキャッシュ:
--   Supabase ダッシュボード → Project Settings → API →「Reload schema」
--   または SQL エディタで次を 1 回実行:
--     NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS public.company_holiday_suggestion_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_key TEXT NOT NULL UNIQUE,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.company_holiday_suggestion_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for company_holiday_suggestion_dismissals" ON public.company_holiday_suggestion_dismissals;
CREATE POLICY "Allow all for company_holiday_suggestion_dismissals"
  ON public.company_holiday_suggestion_dismissals FOR ALL USING (true) WITH CHECK (true);
