-- 予実調整の resolution に「管理者による手動確定」manual を追加（既存DB向け）
ALTER TABLE public.plan_actual_gap_approvals
  DROP CONSTRAINT IF EXISTS plan_actual_gap_approvals_resolution_check;

ALTER TABLE public.plan_actual_gap_approvals
  ADD CONSTRAINT plan_actual_gap_approvals_resolution_check
  CHECK (resolution IS NULL OR resolution IN ('planned', 'actual', 'absent', 'manual'));
