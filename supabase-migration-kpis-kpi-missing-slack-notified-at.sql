-- KPI 未入力（終了打刻後）Slack 通知済みの記録（同一 user_id + date の KPI 行に付与）
ALTER TABLE public.kpis
  ADD COLUMN IF NOT EXISTS kpi_missing_slack_notified_at TIMESTAMPTZ;
