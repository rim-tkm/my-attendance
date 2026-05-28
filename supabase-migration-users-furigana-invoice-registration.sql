-- 統合フォーム連携: フリガナ・適格請求書発行事業者登録番号（インボイス番号）
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS furigana TEXT NOT NULL DEFAULT '';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS invoice_registration_number TEXT NOT NULL DEFAULT '';
