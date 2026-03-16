-- 活動記録の自動補完フラグと乖離承認用テーブル（既存DB用）
-- Supabase SQL Editor で実行してください。

-- attendance に自動補完フラグを追加
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS is_auto_completed BOOLEAN NOT NULL DEFAULT false;

-- 乖離承認テーブル（承認済みの work_record_id を保持）
CREATE TABLE IF NOT EXISTS public.deviation_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_record_id UUID NOT NULL REFERENCES public.attendance(id) ON DELETE CASCADE,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(work_record_id)
);

ALTER TABLE public.deviation_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for deviation_approvals" ON public.deviation_approvals FOR ALL USING (true) WITH CHECK (true);
