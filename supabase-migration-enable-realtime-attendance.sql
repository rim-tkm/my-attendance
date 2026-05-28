-- 活動記録テーブルを Realtime（postgres_changes）の対象にする
-- Supabase SQL Editor で実行するか、Dashboard → Database → Replication で public.attendance をオンにしてください。
-- 有効化後、他端末での attendance の INSERT/UPDATE/DELETE がクライアントの subscribe に届きます。

ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance;
