-- Supabase で業務進捗・活動報告アプリ用テーブルを作成するSQL
-- Supabase ダッシュボードの SQL Editor で実行してください。

-- 1. users（メンバー・振込先含む）
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  furigana TEXT NOT NULL DEFAULT '',
  login_account TEXT NOT NULL DEFAULT '',
  password TEXT NOT NULL DEFAULT '',
  hourly_rate INTEGER NOT NULL DEFAULT 1400,
  zip_code TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  branch_name TEXT NOT NULL DEFAULT '',
  account_type TEXT NOT NULL DEFAULT '普通',
  account_number TEXT NOT NULL DEFAULT '',
  account_holder TEXT NOT NULL DEFAULT '',
  invoice_number TEXT,
  invoice_registration_number TEXT NOT NULL DEFAULT '',
  phone_number TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  first_work_date DATE,
  can_work_morning BOOLEAN NOT NULL DEFAULT false,
  is_intern BOOLEAN NOT NULL DEFAULT false,
  intern_rate_decision_maker_apps INTEGER NOT NULL DEFAULT 2000,
  intern_rate_non_decision_maker_apps INTEGER NOT NULL DEFAULT 500
);

-- 2. attendance（活動記録・完了した業務開始〜終了）
CREATE TABLE IF NOT EXISTS public.attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  start_raw TIMESTAMPTZ NOT NULL,
  start_rounded TIMESTAMPTZ NOT NULL,
  end_raw TIMESTAMPTZ NOT NULL,
  end_rounded TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL,
  date DATE NOT NULL,
  is_auto_completed BOOLEAN NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS attendance_user_date_jst_start_minute_uidx
ON public.attendance (
  user_id,
  date,
  (
    (EXTRACT(HOUR FROM (start_rounded AT TIME ZONE 'Asia/Tokyo'))::integer * 60)
    + EXTRACT(MINUTE FROM (start_rounded AT TIME ZONE 'Asia/Tokyo'))::integer
  )
);

-- 2b. deviation_approvals（稼働乖離の管理者承認）
CREATE TABLE IF NOT EXISTS public.deviation_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_record_id UUID NOT NULL REFERENCES public.attendance(id) ON DELETE CASCADE,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(work_record_id)
);

-- 3. open_records（未終了の活動・業務終了記録待ち）
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

CREATE UNIQUE INDEX IF NOT EXISTS shifts_user_id_date_uidx ON public.shifts (user_id, date);

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
  non_decision_maker_apo INTEGER NOT NULL DEFAULT 0,
  kpi_missing_slack_notified_at TIMESTAMPTZ,
  start_time TIME NOT NULL DEFAULT '00:00:00',
  confirmed_dm INTEGER NOT NULL DEFAULT 0,
  confirmed_non_dm INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.kpis ADD COLUMN IF NOT EXISTS kpi_missing_slack_notified_at TIMESTAMPTZ;
ALTER TABLE public.kpis ADD COLUMN IF NOT EXISTS start_time TIME NOT NULL DEFAULT '00:00:00';

CREATE UNIQUE INDEX IF NOT EXISTS kpis_user_date_start_time_uidx ON public.kpis (user_id, date, start_time);

-- 5a. plan_actual_gap_approvals（予実乖離アーカイブの承認・メンバー×日単位・手動確定の監査列。kpis より後に定義）
CREATE TABLE IF NOT EXISTS public.plan_actual_gap_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolution TEXT CHECK (resolution IS NULL OR resolution IN ('planned', 'actual', 'absent', 'manual')),
  kpi_id UUID REFERENCES public.kpis(id) ON DELETE SET NULL,
  original_start TIMESTAMPTZ,
  original_end TIMESTAMPTZ,
  approved_start TIMESTAMPTZ,
  approved_end TIMESTAMPTZ,
  admin_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE(user_id, date)
);

-- 5b. punch_start_reminder_sent（予定開始後の業務開始未打刻アラート・同一枠につき1日1回）
CREATE TABLE IF NOT EXISTS public.punch_start_reminder_sent (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  slot_kind TEXT NOT NULL CHECK (slot_kind IN ('primary', 'secondary')),
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, work_date, slot_kind)
);

CREATE INDEX IF NOT EXISTS idx_punch_start_reminder_sent_work_date ON public.punch_start_reminder_sent(work_date);

-- 5c. punch_end_reminder_sent（予定終了後の終了未打刻アラート・同一枠につき1日1回）
CREATE TABLE IF NOT EXISTS public.punch_end_reminder_sent (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  slot_kind TEXT NOT NULL CHECK (slot_kind IN ('primary', 'secondary')),
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, work_date, slot_kind)
);

CREATE INDEX IF NOT EXISTS idx_punch_end_reminder_sent_work_date ON public.punch_end_reminder_sent(work_date);

-- 5d. kpi_productivity_alert_sent（生産性低下 Slack 即時アラート・同一ユーザー×稼働日で1回）
CREATE TABLE IF NOT EXISTS public.kpi_productivity_alert_sent (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_kpi_productivity_alert_sent_work_date ON public.kpi_productivity_alert_sent(work_date);

-- 5e. kpi_missing_after_punch_alert_sent（終了打刻後の KPI 未入力 Slack・同一ユーザー×稼働日で1回）
CREATE TABLE IF NOT EXISTS public.kpi_missing_after_punch_alert_sent (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_kpi_missing_after_punch_alert_sent_work_date
  ON public.kpi_missing_after_punch_alert_sent(work_date);

-- RLS: アノンキーで読み書きできるようにする（本番では適宜制限をかけてください）
-- kpis: クライアント（メンバーのマイページ）からの upsert 用。`Allow all for kpis` により (user_id,date,start_time) 衝突時の自己更新が可能。
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.punch_start_reminder_sent ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.punch_end_reminder_sent ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deviation_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_actual_gap_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_productivity_alert_sent ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_missing_after_punch_alert_sent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for users" ON public.users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for attendance" ON public.attendance FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for open_records" ON public.open_records FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for shifts" ON public.shifts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for kpis" ON public.kpis FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for punch_start_reminder_sent" ON public.punch_start_reminder_sent FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for punch_end_reminder_sent" ON public.punch_end_reminder_sent FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for deviation_approvals" ON public.deviation_approvals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for plan_actual_gap_approvals"
  ON public.plan_actual_gap_approvals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for kpi_productivity_alert_sent"
  ON public.kpi_productivity_alert_sent FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for kpi_missing_after_punch_alert_sent"
  ON public.kpi_missing_after_punch_alert_sent FOR ALL USING (true) WITH CHECK (true);

-- Slack メンション用（任意・未実行でもアプリは動作します。列がある場合のみ slack_id が保存されます）
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS slack_id text;

-- 重要データの変更履歴（詳細は supabase-migration-data-change-history.sql）
CREATE TABLE IF NOT EXISTS public.data_change_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('shift', 'kpi', 'attendance')),
  entity_id UUID NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT,
  old_row JSONB,
  new_row JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS data_change_history_entity_time_idx
  ON public.data_change_history (entity_type, entity_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS data_change_history_user_time_idx
  ON public.data_change_history (user_id, changed_at DESC);
ALTER TABLE public.data_change_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for data_change_history"
  ON public.data_change_history FOR ALL USING (true) WITH CHECK (true);
