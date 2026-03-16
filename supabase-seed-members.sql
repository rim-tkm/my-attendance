-- 初期メンバー登録（Supabase SQL Editor で実行）
-- テーブル public.users が作成済みであること。既存データがある場合は重複エラーになるので、必要なら先に TRUNCATE public.users CASCADE; を実行してください。
--
-- 管理者（admin）: パスワード admin123
-- 一般メンバー: パスワード 12345
-- 振込先・住所・電話・請求管理番号は該当メンバー分を初期値でセットしています。

-- 管理者アカウント（ID: admin / Pass: admin123）
INSERT INTO public.users (id, name, login_account, password, hourly_rate, zip_code, address, bank_name, branch_name, account_type, account_number, account_holder, invoice_number, phone_number)
VALUES (gen_random_uuid(), '管理者', 'admin', 'admin123', 1400, '', '', '', '', '普通', '', '', NULL, '');

-- 一般メンバー（振込先等を登録済みの9名 + 未登録の7名）
INSERT INTO public.users (id, name, login_account, password, hourly_rate, zip_code, address, bank_name, branch_name, account_type, account_number, account_holder, invoice_number, phone_number) VALUES
(gen_random_uuid(), '早川知世', 'tomoyohayakawa', '12345', 1400, '470-2207', '愛知県知多郡阿久比町陽なたの丘5-1-57', '三菱UFJ銀行', '半田支店', '普通', '0338872', 'ハヤカワトモヨ', '025', '080-3070-0627'),
(gen_random_uuid(), '渡邉奈美', 'namiwatanabe', '12345', 1400, '467-0054', '愛知県名古屋市瑞穂区丸根町2丁目10-7', '三菱UFJ銀行', '豊田支店', '普通', '1218454', 'ワタナベナミ', '028', '090-4234-5472'),
(gen_random_uuid(), '清水きくえ', 'kikuesimizu', '12345', 1400, '400-0106', '山梨県甲斐市岩森1-1', '楽天銀行', 'JREはやぶさ支店', '普通', '4769615', 'シミズキクエ', '024', '090-3103-0016'),
(gen_random_uuid(), '金天宇', 'tenukin', '12345', 1400, '', '', '', '', '普通', '', '', '034', ''),
(gen_random_uuid(), '近藤里紗', 'risakondou', '12345', 1400, '592-0004', '大阪府高石市高師浜3-13-9', 'ゆうちょ銀行', '六三八', '普通', '1788263', 'コンドウリサ', '021', '090-7147-9577'),
(gen_random_uuid(), '野呂明花', 'asukanoro', '12345', 1400, '', '', '', '', '普通', '', '', '026', ''),
(gen_random_uuid(), '吉村聡美', 'satomiyoshimura', '12345', 1400, '330-0043', '埼玉県さいたま市浦和区大東3-20-14-5', 'ゆうちょ銀行', '〇三八', '普通', '4094270', 'ヨシムラサトミ', '020', '080-1155-3103'),
(gen_random_uuid(), '鈴木理紗', 'risasuzuki', '12345', 1400, '314-0017', '茨城県鹿嶋市旭ヶ丘2-9-5 オーシャンビュー旭ヶ丘 B102', '筑波銀行', '潮来支店', '普通', '1138073', 'スズキリサ', '032', '080-1030-1013'),
(gen_random_uuid(), '木内恵子', 'keikokiuchi', '12345', 1400, '192-0351', '東京都八王子市東中野 8-2 モリスガーデン聖蹟桜ヶ丘西 104', '三菱UFJ銀行', '表参道支店', '普通', '0034871', 'キウチケイコ', '031', '090-7840-7763'),
(gen_random_uuid(), '山本千秋', 'chiakiyamamoto', '12345', 1400, '', '', '', '', '普通', '', '', NULL, ''),
(gen_random_uuid(), '尾崎恵', 'megumiozaki', '12345', 1400, '', '', '', '', '普通', '', '', NULL, ''),
(gen_random_uuid(), '加藤良', 'ryokato', '12345', 1400, '', '', '', '', '普通', '', '', NULL, ''),
(gen_random_uuid(), '伊藤瑛喜', 'akiyoshiito', '12345', 1400, '', '', '', '', '普通', '', '', NULL, ''),
(gen_random_uuid(), '原和希', 'kazukihara', '12345', 1400, '', '', '', '', '普通', '', '', NULL, ''),
(gen_random_uuid(), '山本知恵子', 'tiekoyamamoto', '12345', 1400, '', '', '', '', '普通', '', '', NULL, ''),
(gen_random_uuid(), '栗林隆之', 'takayukikuribayasi', '12345', 1400, '', '', '', '', '普通', '', '', NULL, '');
