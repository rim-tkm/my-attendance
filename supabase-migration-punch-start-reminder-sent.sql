-- 稼働予定開始後の「業務開始」未打刻アラートを同一枠につき1日1回までに制限する
CREATE TABLE IF NOT EXISTS public.punch_start_reminder_sent (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  slot_kind TEXT NOT NULL CHECK (slot_kind IN ('primary', 'secondary')),
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, work_date, slot_kind)
);

CREATE INDEX IF NOT EXISTS idx_punch_start_reminder_sent_work_date ON public.punch_start_reminder_sent(work_date);

ALTER TABLE public.punch_start_reminder_sent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for punch_start_reminder_sent" ON public.punch_start_reminder_sent FOR ALL USING (true) WITH CHECK (true);
