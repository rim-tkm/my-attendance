-- 重複削除とユニーク制約（活動記録は JST・分単位の開始、KPI は user_id+date+start_time）
-- バックアップ推奨。実行後 PostgREST: NOTIFY pgrst, 'reload schema'; または Reload schema
--
-- ポイント:
-- - attendance: 同一日内の「10:00開始」と「13:00開始」は別セッションとして許容。同一開始（JST・分）の二重だけ排除。
-- - kpis: start_time 列を追加し、(user_id, date, start_time) で一意。日次 KPI は既定 00:00:00。

ALTER TABLE public.kpis ADD COLUMN IF NOT EXISTS start_time TIME NOT NULL DEFAULT '00:00:00';

DROP INDEX IF EXISTS kpis_user_id_date_uidx;
DROP INDEX IF EXISTS attendance_user_date_start_rounded_uidx;

-- 1) 稼働予定（同一 user_id・同一 date）
DELETE FROM public.shifts s
WHERE s.id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (PARTITION BY user_id, date ORDER BY id) AS rn
    FROM public.shifts
  ) t
  WHERE t.rn > 1
);

-- 2) KPI（同一 user_id・同一 date・同一 start_time）
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

-- 3) 活動記録（同一 user_id・同一 date・同一 JST 開始・分）
DELETE FROM public.attendance a
WHERE a.id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY
          user_id,
          date,
          (
            (EXTRACT(HOUR FROM (start_rounded AT TIME ZONE 'Asia/Tokyo'))::integer * 60)
            + EXTRACT(MINUTE FROM (start_rounded AT TIME ZONE 'Asia/Tokyo'))::integer
          )
        ORDER BY id
      ) AS rn
    FROM public.attendance
  ) t
  WHERE t.rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS shifts_user_id_date_uidx ON public.shifts (user_id, date);

CREATE UNIQUE INDEX IF NOT EXISTS kpis_user_date_start_time_uidx ON public.kpis (user_id, date, start_time);

CREATE UNIQUE INDEX IF NOT EXISTS attendance_user_date_jst_start_minute_uidx
ON public.attendance (
  user_id,
  date,
  (
    (EXTRACT(HOUR FROM (start_rounded AT TIME ZONE 'Asia/Tokyo'))::integer * 60)
    + EXTRACT(MINUTE FROM (start_rounded AT TIME ZONE 'Asia/Tokyo'))::integer
  )
);
