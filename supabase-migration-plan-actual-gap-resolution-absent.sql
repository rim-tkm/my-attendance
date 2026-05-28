-- 予実調整に「稼働なし（欠勤）」resolution=absent を追加（既存DB向け）
ALTER TABLE public.plan_actual_gap_approvals
  DROP CONSTRAINT IF EXISTS plan_actual_gap_approvals_resolution_check;

ALTER TABLE public.plan_actual_gap_approvals
  ADD CONSTRAINT plan_actual_gap_approvals_resolution_check
  CHECK (resolution IS NULL OR resolution IN ('planned', 'actual', 'absent'));
