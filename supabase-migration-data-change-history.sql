-- 重要データ（shifts / kpis）の変更履歴。Supabase SQL Editor で実行してください。
-- アプリは upsert 前に差分を追記します。テーブルが無い場合は履歴のみスキップし保存は続行します。

CREATE TABLE IF NOT EXISTS public.data_change_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('shift', 'kpi')),
  entity_id UUID NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT,
  old_row JSONB,
  new_row JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS data_change_history_entity_time_idx
  ON public.data_change_history (entity_type, entity_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS data_change_history_user_time_idx
  ON public.data_change_history (user_id, changed_at DESC);

ALTER TABLE public.data_change_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for data_change_history"
  ON public.data_change_history FOR ALL USING (true) WITH CHECK (true);
