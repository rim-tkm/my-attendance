-- 振込先・インボイス・電話番号用カラム追加（既存の users テーブルに実行）
-- Supabase SQL Editor で実行してください。postal_code がある場合は zip_code も追加し、phone_number を追加します。

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS zip_code TEXT NOT NULL DEFAULT '';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS bank_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS branch_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT '普通';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS account_number TEXT NOT NULL DEFAULT '';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS account_holder TEXT NOT NULL DEFAULT '';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS invoice_number TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_number TEXT NOT NULL DEFAULT '';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
-- 既存の postal_code を zip_code にコピー（postal_code カラムがある場合のみ手動で実行）
-- UPDATE public.users SET zip_code = COALESCE(postal_code, '') WHERE postal_code IS NOT NULL;
