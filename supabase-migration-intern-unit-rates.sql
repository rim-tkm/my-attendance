-- インターン成果報酬のユーザー別単価（Supabase SQL Editor で実行）
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS intern_rate_decision_maker_apps INTEGER NOT NULL DEFAULT 2000;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS intern_rate_non_decision_maker_apps INTEGER NOT NULL DEFAULT 500;
