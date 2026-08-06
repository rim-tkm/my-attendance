-- freee 取引先同期の実行履歴。手動（管理設定のボタン）・自動（毎日の Cron）どちらの
-- 実行も1行ずつ記録し、管理設定の freee連携カードで「最終同期」と「直近10件」を表示するために使う。
-- これまでは同期結果が画面を離れると消えてしまい、最後にいつ成功したか・エラーが
-- 続いていないかを管理者が確認できなかった。
--
-- 列名について: SQL標準では TRIGGER は予約語だが、実行トリガー種別を表す列名としては
-- 紛らわしく事故の元になるため、確実に安全な `trigger_kind` を採用する（`trigger` は避けた）。
--
-- 実行後、PostgREST のスキーマキャッシュを更新すること:
--   Supabase ダッシュボード → Project Settings → API →「Reload schema」
--   または SQL エディタで: NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS public.freee_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('manual', 'cron')),
  ok BOOLEAN NOT NULL,
  company_name TEXT,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  error_detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_freee_sync_logs_started_at
  ON public.freee_sync_logs(started_at DESC);

-- RLS は有効化するがポリシーを作らない = 公開 anon キーからは一切アクセス不可。
-- サーバー（service_role）経由のみ。announcements（2026-08-05〜）と同じ方針。
ALTER TABLE public.freee_sync_logs ENABLE ROW LEVEL SECURITY;
