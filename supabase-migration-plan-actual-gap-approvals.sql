-- plan_actual_gap_approvals: 冪等マイグレーション（テーブル未作成・列不足・resolution CHECK 更新）
--
-- 実行後の PostgREST スキーマキャッシュ:
--   Supabase ダッシュボード → Project Settings → API →「Reload schema」
--   または SQL エディタで次を 1 回実行:
--     NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS public.plan_actual_gap_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolution TEXT,
  kpi_id UUID REFERENCES public.kpis(id) ON DELETE SET NULL,
  original_start TIMESTAMPTZ,
  original_end TIMESTAMPTZ,
  approved_start TIMESTAMPTZ,
  approved_end TIMESTAMPTZ,
  admin_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE(user_id, date)
);

ALTER TABLE public.plan_actual_gap_approvals ADD COLUMN IF NOT EXISTS resolution TEXT;
ALTER TABLE public.plan_actual_gap_approvals ADD COLUMN IF NOT EXISTS kpi_id UUID REFERENCES public.kpis(id) ON DELETE SET NULL;
ALTER TABLE public.plan_actual_gap_approvals ADD COLUMN IF NOT EXISTS original_start TIMESTAMPTZ;
ALTER TABLE public.plan_actual_gap_approvals ADD COLUMN IF NOT EXISTS original_end TIMESTAMPTZ;
ALTER TABLE public.plan_actual_gap_approvals ADD COLUMN IF NOT EXISTS approved_start TIMESTAMPTZ;
ALTER TABLE public.plan_actual_gap_approvals ADD COLUMN IF NOT EXISTS approved_end TIMESTAMPTZ;
ALTER TABLE public.plan_actual_gap_approvals ADD COLUMN IF NOT EXISTS admin_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.plan_actual_gap_approvals
  DROP CONSTRAINT IF EXISTS plan_actual_gap_approvals_resolution_check;

ALTER TABLE public.plan_actual_gap_approvals
  ADD CONSTRAINT plan_actual_gap_approvals_resolution_check
  CHECK (resolution IS NULL OR resolution IN ('planned', 'actual', 'absent', 'manual'));

ALTER TABLE public.plan_actual_gap_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for plan_actual_gap_approvals" ON public.plan_actual_gap_approvals;
CREATE POLICY "Allow all for plan_actual_gap_approvals"
  ON public.plan_actual_gap_approvals FOR ALL USING (true) WITH CHECK (true);
