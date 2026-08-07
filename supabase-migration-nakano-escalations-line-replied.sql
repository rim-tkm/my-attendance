-- 中野くんエスカレ: LINE返信の送信権（冪等ガード）用カラム追加
-- 設計: docs/superpowers/specs/2026-08-07-slack-line-reply-design.md §6
--
-- 押し直し・担当2人の同時操作で同じ回答が2通LINEに飛ぶ事故を防ぐため、
-- push直前に「送信権」をこのカラムでclaimする（lib/nakano-loop-data.ts の claimLineReply）。
--
-- 実行後、PostgRESTのスキーマキャッシュを更新すること:
--   Supabaseダッシュボード → Project Settings → API →「Reload schema」
--   または SQL エディタで: NOTIFY pgrst, 'reload schema';

ALTER TABLE public.nakano_escalations ADD COLUMN IF NOT EXISTS line_replied_at TIMESTAMPTZ;
