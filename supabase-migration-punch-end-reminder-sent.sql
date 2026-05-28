-- 予定終了＋猶予後も終了打刻がない場合のアラートを、同一枠（予定1/2）につき1日1回までに制限する
CREATE TABLE IF NOT EXISTS public.punch_end_reminder_sent (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  slot_kind TEXT NOT NULL CHECK (slot_kind IN ('primary', 'secondary')),
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, work_date, slot_kind)
);

CREATE INDEX IF NOT EXISTS idx_punch_end_reminder_sent_work_date ON public.punch_end_reminder_sent(work_date);

ALTER TABLE public.punch_end_reminder_sent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for punch_end_reminder_sent" ON public.punch_end_reminder_sent FOR ALL USING (true) WITH CHECK (true);
