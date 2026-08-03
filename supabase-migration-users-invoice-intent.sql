-- users にインボイス対応可否アンケート（invoice_registration_intent）を追加。冪等マイグレーション。
-- インボイス未登録のメンバーへ本人確認モーダルで「必須化された場合に対応（登録）できるか」を質問し、回答を保存する。
-- 値: 'yes'（対応できる） / 'no'（対応できない） / 'unknown'（わからない）
--
-- 実行後の PostgREST スキーマキャッシュ:
--   NOTIFY pgrst, 'reload schema';

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS invoice_registration_intent TEXT;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_invoice_registration_intent_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_invoice_registration_intent_check
  CHECK (invoice_registration_intent IS NULL OR invoice_registration_intent IN ('yes', 'no', 'unknown'));
