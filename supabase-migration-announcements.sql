-- お知らせ機能。管理者が登録したお知らせをメンバーのログイン時に表示し、
-- 「必読」は確認するまで稼働開始・シフト提出をブロックする。
--
-- 実行後、PostgREST のスキーマキャッシュを更新すること:
--   Supabase ダッシュボード → Project Settings → API →「Reload schema」
--   または SQL エディタで: NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT 'all' CHECK (target IN ('all', 'contractor', 'intern')),
  is_required BOOLEAN NOT NULL DEFAULT true,
  is_published BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_announcements_published
  ON public.announcements(is_published, created_at DESC);

-- 確認記録。(お知らせ, ユーザー, 版数) で一意。版数が上がると再確認が必要になる。
CREATE TABLE IF NOT EXISTS public.announcement_reads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, user_id, version)
);

CREATE INDEX IF NOT EXISTS idx_announcement_reads_user
  ON public.announcement_reads(user_id);

-- RLS は有効化するがポリシーを作らない = 公開 anon キーからは一切アクセス不可。
-- サーバー（service_role）経由のみ。users の RLS 締め（2026-08-05）と同じ方針。
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_reads ENABLE ROW LEVEL SECURITY;
