-- 既存 DB で hourly_rate が無い場合の追加（新規スキーマでは既に定義済み）
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS hourly_rate INTEGER NOT NULL DEFAULT 1400;

COMMENT ON COLUMN public.users.hourly_rate IS '業務委託の時給単価（円・税込ベースで請求計算に使用）。既定 1400。';
