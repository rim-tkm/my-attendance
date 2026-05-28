-- インターン管理・成果報酬確定数（Supabase SQL Editor で実行）
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_intern BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.kpis ADD COLUMN IF NOT EXISTS confirmed_dm INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.kpis ADD COLUMN IF NOT EXISTS confirmed_non_dm INTEGER NOT NULL DEFAULT 0;
