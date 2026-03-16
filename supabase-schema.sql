-- Supabase で業務進捗報告アプリ用テーブルを作成するSQL
-- Supabase ダッシュボードの SQL Editor で実行してください。

-- 1. users（メンバー）
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  login_account TEXT NOT NULL DEFAULT '',
  password TEXT NOT NULL DEFAULT '',
  hourly_rate INTEGER NOT NULL DEFAULT 1400
);

-- 2. attendance（稼働履歴・完了した打刻）
CREATE TABLE IF NOT EXISTS public.attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  start_raw TIMESTAMPTZ NOT NULL,
  start_rounded TIMESTAMPTZ NOT NULL,
  end_raw TIMESTAMPTZ NOT NULL,
  end_rounded TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL,
  date DATE NOT NULL
);

-- 3. open_records（未終了の稼働・終了打刻待ち）
CREATE TABLE IF NOT EXISTS public.open_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  start_raw TIMESTAMPTZ NOT NULL,
  start_rounded TIMESTAMPTZ NOT NULL,
  date DATE NOT NULL
);

-- 4. shifts（稼働予定）
CREATE TABLE IF NOT EXISTS public.shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  start_planned TEXT NOT NULL,
  end_planned TEXT NOT NULL,
  start_planned2 TEXT,
  end_planned2 TEXT
);

-- 5. kpis（KPI・テレアポ成果）
CREATE TABLE IF NOT EXISTS public.kpis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  total_calls INTEGER NOT NULL DEFAULT 0,
  valid_calls INTEGER NOT NULL DEFAULT 0,
  kc_count INTEGER NOT NULL DEFAULT 0,
  follow_up_created INTEGER NOT NULL DEFAULT 0,
  decision_maker_apo INTEGER NOT NULL DEFAULT 0,
  non_decision_maker_apo INTEGER NOT NULL DEFAULT 0
);

-- RLS: アノンキーで読み書きできるようにする（本番では適宜制限をかけてください）
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for users" ON public.users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for attendance" ON public.attendance FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for open_records" ON public.open_records FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for shifts" ON public.shifts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for kpis" ON public.kpis FOR ALL USING (true) WITH CHECK (true);
