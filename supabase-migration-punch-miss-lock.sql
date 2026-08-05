-- 打刻押し忘れロック（月3回でロック→規約同意→公式LINE報告→管理者解除）
-- カウント自体は punch_start_reminder_sent / punch_end_reminder_sent（未打刻アラート送信履歴）から
-- 都度計算するため、users には「解除の記録」と「規約同意の記録」だけを持つ。
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS punch_miss_released_month TEXT;          -- 解除が有効な月（YYYY-MM）
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS punch_miss_released_count INTEGER;       -- 解除時点の押し忘れ回数（これを超える新たな押し忘れで再ロック）
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS punch_miss_agreed_month TEXT;            -- 規約に同意した月（YYYY-MM）
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS punch_miss_agreed_at TIMESTAMPTZ;        -- 規約同意日時（エビデンス）
