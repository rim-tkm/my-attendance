-- 中野くん知識ループ: エスカレ投稿の対応表と、知識の承認待ちドラフト
-- 設計: docs/superpowers/specs/2026-08-07-nakano-knowledge-loop-design.md §5

-- Bot投稿（エスカレ通知）と質問の対応表。
-- 📚リアクションが付いた投稿の ts から「どの質問か」を逆引きするために使う。
create table if not exists public.nakano_escalations (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.nakano_conversations(id) on delete cascade,
  -- users への FK は張らない。メンバー削除後もログとして残したいため
  user_id uuid not null,
  question text not null,
  slack_channel_id text not null,
  slack_ts text not null,
  created_at timestamptz not null default now(),
  unique (slack_channel_id, slack_ts)
);
alter table public.nakano_escalations enable row level security;

-- 知識の承認待ちドラフト。承認されるまで本番知識（nakano_knowledge）には入らない。
create table if not exists public.nakano_knowledge_drafts (
  id uuid primary key default gen_random_uuid(),
  escalation_id uuid references public.nakano_escalations(id) on delete set null,
  question text not null,
  raw_answer text not null,
  draft_title text not null,
  draft_body text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  slack_permalink text,
  approved_knowledge_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.nakano_knowledge_drafts enable row level security;
create index if not exists idx_nakano_drafts_status
  on public.nakano_knowledge_drafts (status);
