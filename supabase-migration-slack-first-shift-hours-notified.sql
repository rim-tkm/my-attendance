-- 初回「稼働時間あり」のシフト提出時 Slack 通知済み（二重送信防止）
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS slack_first_shift_hours_notified_at TIMESTAMPTZ;
