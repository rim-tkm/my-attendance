-- data_change_history に活動記録（管理者手動上書きログ等）を追加（既存DB向け）
-- 列 CHECK の自動名は多くの環境で data_change_history_entity_type_check
ALTER TABLE public.data_change_history
  DROP CONSTRAINT IF EXISTS data_change_history_entity_type_check;

ALTER TABLE public.data_change_history
  ADD CONSTRAINT data_change_history_entity_type_check
  CHECK (entity_type IN ('shift', 'kpi', 'attendance'));
