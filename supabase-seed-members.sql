-- 初期メンバー登録（Supabase SQL Editor で実行）
-- テーブル public.users が作成済みであること。既存データがある場合は重複エラーになるので、必要なら先に TRUNCATE public.users CASCADE; を実行してください。

-- 管理者アカウント（ID: admin / Pass: admin123）
INSERT INTO public.users (id, name, login_account, password, hourly_rate)
VALUES (gen_random_uuid(), '管理者', 'admin', 'admin123', 1400);

-- 一般メンバー（全員 Pass: 12345）
INSERT INTO public.users (id, name, login_account, password, hourly_rate) VALUES
(gen_random_uuid(), '早川知世', 'tomoyohayakawa', '12345', 1400),
(gen_random_uuid(), '渡邉奈美', 'namiwatanabe', '12345', 1400),
(gen_random_uuid(), '清水きくえ', 'kikuesimizu', '12345', 1400),
(gen_random_uuid(), '金天宇', 'tenukin', '12345', 1400),
(gen_random_uuid(), '近藤里紗', 'risakondou', '12345', 1400),
(gen_random_uuid(), '野呂明花', 'asukanoro', '12345', 1400),
(gen_random_uuid(), '吉村聡美', 'satomiyoshimura', '12345', 1400),
(gen_random_uuid(), '鈴木理紗', 'risasuzuki', '12345', 1400),
(gen_random_uuid(), '木内恵子', 'keikokiuchi', '12345', 1400),
(gen_random_uuid(), '山本千秋', 'chiakiyamamoto', '12345', 1400),
(gen_random_uuid(), '尾崎恵', 'megumiozaki', '12345', 1400),
(gen_random_uuid(), '加藤良', 'ryokato', '12345', 1400),
(gen_random_uuid(), '伊藤瑛喜', 'akiyoshiito', '12345', 1400),
(gen_random_uuid(), '原和希', 'kazukihara', '12345', 1400),
(gen_random_uuid(), '山本知恵子', 'tiekoyamamoto', '12345', 1400),
(gen_random_uuid(), '栗林隆之', 'takayukikuribayasi', '12345', 1400);
