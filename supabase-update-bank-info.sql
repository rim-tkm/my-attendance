-- 振込先・住所・電話番号・請求管理番号の一括更新（Supabase SQL Editor で実行）
--
-- 【いつ使うか】
-- ・既にメンバーが登録済みのデータベースに、振込先等をまとめて反映したいとき
-- ・新規環境で初期データから入れる場合は supabase-seed-members.sql を実行（振込先付きでINSERTされます）
--
-- zip_code / invoice_number は ::text で明示的に文字列として保存し、型エラーを防ぎます。
-- カラムが存在しない場合は supabase-migration-users-bank.sql を先に実行してください。

-- 1. 早川 知世 (tomoyohayakawa)
UPDATE public.users SET
  zip_code = '470-2207'::text,
  address = '愛知県知多郡阿久比町陽なたの丘5-1-57',
  bank_name = '三菱UFJ銀行',
  branch_name = '半田支店',
  account_type = '普通',
  account_number = '0338872',
  account_holder = 'ハヤカワトモヨ',
  invoice_number = '025'::text,
  phone_number = '080-3070-0627'
WHERE login_account = 'tomoyohayakawa';

-- 2. 渡邉 奈美 (namiwatanabe)
UPDATE public.users SET
  zip_code = '467-0054'::text,
  address = '愛知県名古屋市瑞穂区丸根町2丁目10-7',
  bank_name = '三菱UFJ銀行',
  branch_name = '豊田支店',
  account_type = '普通',
  account_number = '1218454',
  account_holder = 'ワタナベナミ',
  invoice_number = '028'::text,
  phone_number = '090-4234-5472'
WHERE login_account = 'namiwatanabe';

-- 3. 清水 きくえ (kikuesimizu)
UPDATE public.users SET
  zip_code = '400-0106'::text,
  address = '山梨県甲斐市岩森1-1',
  bank_name = '楽天銀行',
  branch_name = 'JREはやぶさ支店',
  account_type = '普通',
  account_number = '4769615',
  account_holder = 'シミズキクエ',
  invoice_number = '024'::text,
  phone_number = '090-3103-0016'
WHERE login_account = 'kikuesimizu';

-- 4. 金 天宇 (tenukin) ※口座情報等は別途のため請求管理番号のみ
UPDATE public.users SET
  invoice_number = '034'::text
WHERE login_account = 'tenukin';

-- 5. 近藤 里紗 (risakondou)
UPDATE public.users SET
  zip_code = '592-0004'::text,
  address = '大阪府高石市高師浜3-13-9',
  bank_name = 'ゆうちょ銀行',
  branch_name = '六三八',
  account_type = '普通',
  account_number = '1788263',
  account_holder = 'コンドウリサ',
  invoice_number = '021'::text,
  phone_number = '090-7147-9577'
WHERE login_account = 'risakondou';

-- 6. 野呂 明花 (asukanoro) ※口座情報等は未登録のため請求管理番号のみ
UPDATE public.users SET
  invoice_number = '026'::text
WHERE login_account = 'asukanoro';

-- 7. 吉村 聡美 (satomiyoshimura)
UPDATE public.users SET
  zip_code = '330-0043'::text,
  address = '埼玉県さいたま市浦和区大東3-20-14-5',
  bank_name = 'ゆうちょ銀行',
  branch_name = '〇三八',
  account_type = '普通',
  account_number = '4094270',
  account_holder = 'ヨシムラサトミ',
  invoice_number = '020'::text,
  phone_number = '080-1155-3103'
WHERE login_account = 'satomiyoshimura';

-- 8. 鈴木 理沙 (risasuzuki)
UPDATE public.users SET
  zip_code = '314-0017'::text,
  address = '茨城県鹿嶋市旭ヶ丘2-9-5 オーシャンビュー旭ヶ丘 B102',
  bank_name = '筑波銀行',
  branch_name = '潮来支店',
  account_type = '普通',
  account_number = '1138073',
  account_holder = 'スズキリサ',
  invoice_number = '032'::text,
  phone_number = '080-1030-1013'
WHERE login_account = 'risasuzuki';

-- 9. 木内 恵子 (keikokiuchi)
UPDATE public.users SET
  zip_code = '192-0351'::text,
  address = '東京都八王子市東中野 8-2 モリスガーデン聖蹟桜ヶ丘西 104',
  bank_name = '三菱UFJ銀行',
  branch_name = '表参道支店',
  account_type = '普通',
  account_number = '0034871',
  account_holder = 'キウチケイコ',
  invoice_number = '031'::text,
  phone_number = '090-7840-7763'
WHERE login_account = 'keikokiuchi';
