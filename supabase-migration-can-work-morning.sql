-- 新人の午前稼働許可フラグ（管理者が true に変更可能）
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS can_work_morning boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.can_work_morning IS 'true のときのみ稼働予定の開始を 10:00 から選択可能。false は予定開始を 14:00 以降のみ。';

UPDATE public.users SET can_work_morning = true WHERE lower(trim(login_account)) = 'admin';
