-- 中野くん知識ループ: エスカレ投稿の対応表と、知識の承認待ちドラフト
-- 設計: docs/superpowers/specs/2026-08-07-nakano-knowledge-loop-design.md §5
--
-- 実行後、PostgREST のスキーマキャッシュを更新すること:
--   Supabase ダッシュボード → Project Settings → API →「Reload schema」
--   または SQL エディタで: NOTIFY pgrst, 'reload schema';

-- Bot投稿（エスカレ通知）と質問の対応表。
-- リアクションが付いた投稿の ts から「どの質問か」を逆引きするために使う。
CREATE TABLE IF NOT EXISTS public.nakano_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.nakano_conversations(id) ON DELETE SET NULL,
  -- 会話が削除されてもエスカレ記録は残す（ログ保持の要件）。
  -- users への FK は張らない。メンバー削除後もログとして残したいため。
  user_id UUID NOT NULL,
  question TEXT NOT NULL,
  slack_channel_id TEXT NOT NULL,
  slack_ts TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slack_channel_id, slack_ts)
);
ALTER TABLE public.nakano_escalations ENABLE ROW LEVEL SECURITY;

-- 知識の承認待ちドラフト。承認されるまで本番知識（nakano_knowledge）には入らない。
CREATE TABLE IF NOT EXISTS public.nakano_knowledge_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escalation_id UUID REFERENCES public.nakano_escalations(id) ON DELETE SET NULL,
  question TEXT NOT NULL,
  raw_answer TEXT NOT NULL,
  draft_title TEXT NOT NULL,
  draft_body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  slack_permalink TEXT,
  approved_knowledge_id UUID REFERENCES public.nakano_knowledge(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.nakano_knowledge_drafts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_nakano_drafts_status
  ON public.nakano_knowledge_drafts (status);

-- 同一エスカレに pending のドラフトは1件まで（📚同時押下の競合をDB層でも防ぐ）
CREATE UNIQUE INDEX IF NOT EXISTS uniq_nakano_drafts_pending_escalation
  ON public.nakano_knowledge_drafts (escalation_id) WHERE status = 'pending';
