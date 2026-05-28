-- KPI 保存で使用する start_time 列が無い環境向け（エラー:
-- Could not find the 'start_time' column of 'kpis' in the schema cache）
--
-- Supabase Dashboard → SQL Editor でこのファイル全体を実行してください。
-- 実行後、数秒待ってからアプリで KPI 保存を再試行してください。

-- 1) 列の追加（既にある場合はスキップ）
ALTER TABLE public.kpis ADD COLUMN IF NOT EXISTS start_time TIME NOT NULL DEFAULT '00:00:00';
ALTER TABLE public.kpis ADD COLUMN IF NOT EXISTS kpi_missing_slack_notified_at TIMESTAMPTZ;

-- 2) 旧インデックス（user_id + date のみ）が残っていると新しい一意制約と競合することがあるため削除
DROP INDEX IF EXISTS kpis_user_id_date_uidx;

-- 3) 追加直後は全行が同一 start_time のため、(user_id, date) 重複があれば id が小さい行を残して整理
DELETE FROM public.kpis k
WHERE k.id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (PARTITION BY user_id, date, start_time ORDER BY id) AS rn
    FROM public.kpis
  ) t
  WHERE t.rn > 1
);

-- 4) アプリの upsert と一致する一意インデックス
CREATE UNIQUE INDEX IF NOT EXISTS kpis_user_date_start_time_uidx ON public.kpis (user_id, date, start_time);

-- 5) PostgREST のスキーマキャッシュ更新（Dashboard の API がすぐ認識しないとき用）
NOTIFY pgrst, 'reload schema';

-- --- 実行後の確認（別クエリでも可） ---
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'kpis' AND column_name = 'start_time';
-- → 1 行返れば列はあります。まだ同じエラーなら Dashboard でプロジェクトを一度 Pause → Resume（または数分待つ）。
