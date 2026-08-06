-- AIアシスタント「中野くん」。公式LINEに来ているメンバーの質問をアプリ内に集約する。
-- 設計: docs/superpowers/specs/2026-08-06-nakano-bot-design.md
--
-- 実行後、PostgREST のスキーマキャッシュを更新すること:
--   Supabase ダッシュボード → Project Settings → API →「Reload schema」
--   または SQL エディタで: NOTIFY pgrst, 'reload schema';

-- 知識。1行が「ステップUIのボタン＋回答」と「AIに渡す知識」を兼ねる。
-- 二重管理を避けるため、テーブルは分けない。
CREATE TABLE IF NOT EXISTS public.nakano_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('operation', 'rule', 'billing', 'other')),
  -- ステップUIの親。NULL なら最上段のボタン。
  parent_id UUID REFERENCES public.nakano_knowledge(id) ON DELETE CASCADE,
  -- true のときだけステップUIのボタンとして表示する（false は AI 専用の知識）。
  show_as_step BOOLEAN NOT NULL DEFAULT false,
  -- false にすると中野くんが参照しなくなる（削除せず一時停止）。
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nakano_knowledge_active
  ON public.nakano_knowledge(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_nakano_knowledge_parent
  ON public.nakano_knowledge(parent_id, sort_order);

-- 会話のまとまり。最新の会話が24時間以上前なら新しい会話を作る（別の日の質問で文脈が混ざるのを防ぐ）。
CREATE TABLE IF NOT EXISTS public.nakano_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nakano_conversations_user
  ON public.nakano_conversations(user_id, updated_at DESC);

-- 1つ1つの発言。
-- user_id は回数制限の集計を JOIN なしで行うための非正規化（1人あたり1日数十件を毎回数えるため）。
CREATE TABLE IF NOT EXISTS public.nakano_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.nakano_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  -- 'step' はステップUIの操作（Anthropic API を呼んでいない＝課金なし・回数制限の対象外）。
  source TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'step')),
  -- この回答で担当（Slack）に回したか。
  escalated BOOLEAN NOT NULL DEFAULT false,
  -- トークンは単価が違うので種別ごとに分けて持つ。
  -- 1つに合算すると、キャッシュ読み出し（入力の約1/10の単価）まで通常入力の単価で
  -- 計算してしまい、管理画面の概算費用が実際の10倍近く出る。
  -- その数字を見てモデルを下げる判断をするので、ここを丸めてはいけない。
  input_tokens INTEGER,          -- キャッシュに当たらなかった入力
  cache_read_tokens INTEGER,     -- キャッシュから読んだ入力（安い）
  cache_write_tokens INTEGER,    -- キャッシュへ書いた入力（高い）
  output_tokens INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nakano_messages_conversation
  ON public.nakano_messages(conversation_id, created_at);
-- 管理画面の新着順一覧用。
CREATE INDEX IF NOT EXISTS idx_nakano_messages_recent
  ON public.nakano_messages(created_at DESC);
-- 回数制限（直近60分／当日）の集計用。
CREATE INDEX IF NOT EXISTS idx_nakano_messages_quota
  ON public.nakano_messages(user_id, source, role, created_at DESC);

-- RLS は有効化するがポリシーを作らない = 公開 anon キーからは一切アクセス不可。
-- サーバー（service_role）経由のみ。users の RLS 締め（2026-08-05）と同じ方針。
-- 他人の会話がブラウザから読めてしまう事故を、仕組みの側で防ぐ。
ALTER TABLE public.nakano_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nakano_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nakano_messages ENABLE ROW LEVEL SECURITY;
