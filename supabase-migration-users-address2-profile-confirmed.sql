-- users に建物名・部屋番号（address2）と、月次の本人情報確認月（profile_confirmed_month）を追加。冪等マイグレーション。
-- address2: freee 取引先の「建物名・部屋番号など」に対応する分離欄。既存の address はそのまま。
-- profile_confirmed_month: メンバー本人が「登録情報に変更なし」を確認した月（YYYY-MM）。月が変わると再確認を促す。
--
-- 実行後の PostgREST スキーマキャッシュ:
--   Supabase ダッシュボード → Project Settings → API →「Reload schema」
--   または SQL エディタで次を 1 回実行:
--     NOTIFY pgrst, 'reload schema';

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS address2 TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS profile_confirmed_month TEXT;
