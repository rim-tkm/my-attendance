-- kpis 確定数カラム（正式名）。未作成環境向け。
-- 旧名 confirmed_decision_maker_apps 等を使っていた場合は手動で RENAME するか、データ移行後に旧列を DROP してください。
ALTER TABLE public.kpis ADD COLUMN IF NOT EXISTS confirmed_dm INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.kpis ADD COLUMN IF NOT EXISTS confirmed_non_dm INTEGER NOT NULL DEFAULT 0;
