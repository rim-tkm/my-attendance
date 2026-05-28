-- メンバーの初回稼働日（管理画面で設定。初回設定時に Slack 通知）
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS first_work_date DATE;
