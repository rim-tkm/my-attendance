-- 業務委託メンバーの区分（一般 / SV / 正社員候補）
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS member_category TEXT NOT NULL DEFAULT 'general';

COMMENT ON COLUMN public.users.member_category IS '業務委託区分: general | sv | fulltime_candidate（インターンとは別）';
