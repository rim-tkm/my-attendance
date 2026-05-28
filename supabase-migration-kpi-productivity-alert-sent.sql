-- KPI 保存後の「生産性低下」Slack 即時アラートを、同一ユーザー・同一稼働日で1回だけに制限する
CREATE TABLE IF NOT EXISTS public.kpi_productivity_alert_sent (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_kpi_productivity_alert_sent_work_date
  ON public.kpi_productivity_alert_sent (work_date);

ALTER TABLE public.kpi_productivity_alert_sent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for kpi_productivity_alert_sent"
  ON public.kpi_productivity_alert_sent FOR ALL USING (true) WITH CHECK (true);
