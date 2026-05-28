-- 重複した稼働予定（同一 user_id・同一 date の複数行）を1件にまとめる。
-- 残す行: id が辞書順で最小のもの。他は削除。
-- Supabase SQL エディタで一度だけ実行してください（バックアップ推奨）。

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

-- 任意: 今後の二重 INSERT を DB レベルでも防ぐ（dedupe 実行後のみ成功しやすい）
-- ALTER TABLE public.shifts ADD CONSTRAINT shifts_user_id_date_unique UNIQUE (user_id, date);
