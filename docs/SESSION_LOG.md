# SESSION_LOG

## 2026-08-05（追記: RLS移行フェーズ1完了・過去シフト改ざん防止）

- **過去シフト改ざん防止**（e144c70）: /api/schedule で本人保存時は過去日の行を保存対象から除外（日付単位マージ保存なのでDBの既存値は残る）。管理者の代理保存は従来どおり。
- **RLS移行フェーズ1をコード側完了**（docs/RLS_MIGRATION_PLAN.md 参照。f281614→e3f43b1→2febc1f→2909303）:
  - users を触る全サーバ経路を service_role 優先（getUsersDb）に統一
  - ログインを NextAuth signIn に一本化（client loginUser 廃止）。hydrate は「認証確認→API取得」の順に
  - メンバー取得は 管理者=/api/admin/members（全件・PWハッシュ除外・hasPasswordフラグ）／一般=/api/member/me（本人1件のみ）。**一般メンバーのブラウザに他人の口座・住所・電話・PWハッシュが配信されなくなった**
  - 書き込みもAPI集約: 無効化/有効化・新規作成(POST /api/admin/members)・バックアップ(GET/POST /api/admin/backup)・アーカイブ画面
  - 検証: 各コミットで tsc/build ✅。ローカルで未ログイン画面・誤PWエラー表示・未認証API 401 を確認
- **RLS締め実施済み（2026-08-05）**: ユーザーが本番で `drop policy "Allow all for users" on public.users;` を実行。curl検証で anonキーの users 読み取り=[]（遮断✅）・attendance は従来どおり読める（フェーズ2前の想定どおり）・本番トップ200・未認証API 401 を確認。切り戻しSQLは RLS_MIGRATION_PLAN.md に記載。
- **申し送り**: ①本番で管理者ログイン＋メンバー一覧表示、一般メンバーのログイン＋打刻を実地確認（翌朝の打刻が自然なテスト）②attendance/shifts/kpis 等の運用テーブルはフェーズ2（未着手）③初期セットアップ画面（メンバー0件時のみ）は anon 直書きのまま=RLS締め後は動かないが本番では通らない

## 2026-08-05（監査#2対応: 22エージェント点検→確定10件を1件ずつ全修正）

- **経緯**: ユーザー指示で2回目のWorkflow監査（バグ/セキュリティ/矛盾/改善提案、約22エージェント+反証検証）を実行。確定10件・却下0件・未検証(参考)43件・改善提案27件。確定10件を「1個ずつ」の指示どおり1件=1コミットで全修正。
- **修正内容（コミット順）**:
  1. `6080e2f` open_recordsの全置換保存を廃止→行単位操作（`setOpenRecordForUser`=自分の行のdelete+insert、`runAutoComplete`=id指定削除、予実調整3経路=user_id+date指定削除。同時打刻のlost update・読込エラー時の全消失を根絶。新関数 `deleteOpenRecordsByIds`/`deleteOpenRecordsForUserAndDate`）
  2. `4fb789c` /api/schedule のルール検証（営業時間・朝稼働制限）を今日以降の行に限定（朝稼働許可OFFに戻すと過去の朝シフトが検証に引っかかり本人のシフト保存が全ロックされるバグ）
  3. `a4c84e4` 外部連携API認証をフェイルクローズに（EXTERNAL_REGISTER_SECRET未設定なら拒否。本番Vercelは設定済み確認→GAS連携に影響なし）
  4. `c93a007` 外部口座変更APIで銀行/支店コードを全銀マスタから引き直し（旧コード残置→freeeが旧銀行コードで振込先を作る誤送金リスク。特定不可なら空にして不足警告に載せる）
  5. `30db28c` 消費税の税抜逆算を `Math.floor((total*10)/11)` の整数演算に（`total/1.1` の浮動小数点誤差で税込110円等が1円ズレ。invoice-intern 2箇所+invoice-html 1箇所）
  6. `4c6b0b5` Slack日報（前日実績）を会社休業日にスキップ（skipReason: "companyHoliday" 追加）
  7. `255fe02` 未打刻アラート: DB読取失敗時は誤アラートを送らず中断（throw する厳格版 `loadRecordsOrThrow`/`loadShiftsOrThrow`/`loadOpenRecordsOrThrow` を supabase-data に追加）
  8. `94dd6dd` チーム成果カードのアポ取得者一覧を全メンバー母集団に（合計と内訳の不一致解消。無効化後も過去日の成果は表示される）
  9. `716b3f1` freee同期ダイアログの文言を現仕様に（「同名は自動紐付け」→「同名はエラー停止」）
  10. `6c9d8d5` `saveRecordsForUser` の全件読み直し・全件upsertを廃止し本人の行だけ書き込み（打刻のたびのO(N)書き込み増幅を解消）
- **検証**: 各コミットで `npx tsc --noEmit` ✅ / `npm run build` ✅。SQL変更なし。
- **申し送り（未対応・要ユーザー判断）**: 未検証43件のうち重要どころ = ①インボイス経過措置 控80%→**控50%が2026年10月切替**（freee外注費CSVの税区分。期限あり法対応）②`select("*")` がパスワードハッシュ・口座情報をブラウザへ配信（RLS全開放と併せ要設計判断）③過去週シフトの改ざんが可能。改善提案27件（freee CSVプレビュー、同期履歴、月次チェックリスト等）も未着手・選択待ち。

## 2026-08-05（追記: 打刻ブロックバグ修正・データ整備・シフト催促削除）

- **打刻ブロックバグ**（173cc27）: 前日の打刻漏れを予実乖離で手動確定してもメンバー端末のローカルバックアップが未終了打刻を復活させ翌日打刻不可になる実障害（関口さん）を修正。バックアップ復元は当日分のみに限定、自動補完に確定済み残骸の削除保護を追加。残骸データも削除済み。
- **データ整備**: 関口さん（姓=関口/名=史郎/フリガナ セキグチ シロウ）、山中さん（口座番号を番号のみに）、七瀬さん（口座名義をカナ「ナナセ ハア」に。読みは本人確認済みで正しい）。村部さんはフィリピン在住で郵便番号4桁が正当→海外住所は7桁警告を免除（8746700）。口座名義の漢字警告を追加。全観点スキャン（名義/重複/時給/請求番号等）で他の不備ゼロ。
- **シフト催促機能を削除**（c5ed6b8・ユーザー指示）: cron/shift-reminder・remind-unsubmitted・関連lib/action/管理画面テストボタンを撤去。slackId関連も削除（本番DBにslack_id列が存在せず実質未機能だった）。

## 2026-08-05（監査対応: 30エージェント総点検→確定19件の修正）

- **経緯**: ユーザー指示でWorkflow（10領域調査+反証検証、計30エージェント）を実行。指摘20件中19件が確定（誤報1件は却下）+軽微12件。
- **🔴最優先5件**（ef69bcc）: ①同名freee取引先への自動紐付け廃止（要確認エラー化・同姓同名メンバー検知。既存83名はID紐付け済みで影響なし）②口座反映検証を送信値突合に強化 ③金額計算を請求書PDFと統一（round化+sumBillableMinutesForUserMonth。無効化メンバーの支払い漏れも修正）④JA照合を農協限定（JA横浜→横浜銀行等11件の誤マッチ解消・実データ検証済み）⑤ゆうちょ振込用変換を公式ルール準拠（2〜8桁対応。曖昧な7桁末尾1はモーダル赤字警告）。
- **🟠重要+中程度**（次コミット）: 「変更がある」で確認完了扱いになる穴を閉鎖（markConfirmedフラグ・エビデンスも実態通りに）・確認記録失敗時はモーダルを閉じない・無効化メンバーの確認を403に・姓プリフィル事故防止（未分割は空欄+ヒント表示）・休業日登録を「登録→削除」順に変更+過去日シフトは削除対象外・/api/scheduleにメンバー保存時の休業日矯正（管理者は例外維持=ADR-012）・バックアップ復元の新列欠落と一括upsertキー不揃い問題を修正（全列常時出力）・Cronの未捕捉例外もSlack通知に乗せる・トークン並行リフレッシュの自己回復・CSVのExcel数式インジェクション対策・profile_confirmationsのRLSをINSERTのみに（**要SQL実行**）。
- **未対応（low12件）**: freee側取引先削除時の自己修復なし、インターン請求書の1円合算差、確認ガードのfail-open（members未ロード時）等 — SESSION_LOG記録のみ。必要になったら対応。
- **検証**: 各バッチで `tsc`/`build` ✅、JA11件・ゆうちょ変換・金額丸めは実データ/数値検証済み。

## 2026-08-05（freee外注費CSV＝大槻さん依頼の月次取引データ生成）

- **依頼**: 税理士・大槻さん指定の「取引インポートフォーマット」で月次外注費データをCSV出力できるように。
- **変更**: [lib/freee-deals-csv.ts](../lib/freee-deals-csv.ts)（発生日=月末・決済期日=翌月15日・勘定科目=外注費・金額=請求書と同一の税込計算（`calcMemberMonthlyPayYen`）・税額=請求書PDFと同一の端数処理・税区分=インボイス登録有無で課対仕入10%／課対仕入（控80）10%・品目=テレアポ業務（インターンは成果報酬表記））。管理設定のfreeeカードに対象月ピッカー＋「freee外注費CSVをダウンロード」ボタン（既定=前月・クライアント側で生成・BOM付きUTF-8）。
- **検証**: `tsc`/`build` ✅。7月実データのシミュレーションで49名・合計2,703,225円、**伊藤春香さんの行が大槻さんのサンプルExcelと完全一致**（46200/税額4200/控80）を確認。
- **申し送り**: freee側は［取引インポート］から取り込み。API直接登録（②）は未着手（要・freeeアプリ権限「[会計]取引 更新」追加＋再接続）。本人確認の進捗は 45/83名完了（8/5時点）・宇佐美さんの「あお支店」修正済み。
 — 作業ログ（チャット引き継ぎ用）

> **チャット（AIセッション）をまたぐ時の引き継ぎメモ。新しいものを上に追記する。**
> 目的: 次に入るAIが「直近で何をしたか／今どういう状態か／次に何をすべきか」を1分で把握できるようにする。
> ルール: 1セッション＝1ブロック。フォーマットは「日付 / 依頼 / 変更 / 検証 / 反映 / 申し送り」。過去分は消さない。
> ※ 設計判断そのものは `docs/DECISIONS.md`（ADR）に、恒久的な地雷は `PROJECT_HANDOVER.md §8` に書く。ここは「時系列の作業記録」。

---

## 2026-08-03（第13弾: 確認モーダルの全項目化・赤字警告・インボイスアンケート・エビデンス記録）

- **エビデンス記録**（5630637）: 確認・保存時に登録内容スナップショットを `profile_confirmations`（kind: no_change/updated）へ保存。「いつ・誰が・何を確認したか」を証明可能に。
- **確認項目の全項目化**（599057f, e3d4ff2）: モーダルに氏名（姓 名）・フリガナ（セイ・メイ分離入力→「セイ メイ」保存）・建物名の独立行・銀行/支店の**マスタ照合コード＆カナ表示**を追加。フリガナ未登録者は入力必須（freeeカナ名称に連動）。
- **赤字警告**: 銀行・支店のマスタ照合不可／郵便番号7桁でない／電話番号桁数異常／口座番号8桁超／インボイス形式不正を赤字＋⚠️注意書きで表示（/api/bank-master に validateBank/validateBranch 検証モード追加）。警告があっても確認は可能（新設支店等の正当例外を考慮）。
- **インボイスアンケート**: 未登録メンバーに「必須化された場合に対応できるか」を必須回答で収集（users.invoice_registration_intent: yes/no/unknown）。管理設定のメンバー編集で回答表示。
- **モック画像**: メンバー向けSlack説明用に確認モーダルのモック（正常＋赤字警告の2パターン）を生成しユーザーへ提供（scratchpad/kakunin-mock-v2.png）。
- **SQL実行済み**: profile_confirmations / users.invoice_registration_intent（ユーザー実行確認済み）。
- **検証**: 各コミットで `npx tsc --noEmit` ✅ / `npm run build` ✅

---

## 2026-08-03（第12弾: 照合強化の全員検証・月次確認を稼働条件に）

- **銀行・支店照合の実データ検証**（5f0ff05）: 同期と同一ロジックで全81名をシミュレーションし、照合不可12名の原因を全て特定・補正（ゆうちょ数字表記→漢数字、カタカナ書き癖ニ/ハ、括弧書き除去、英字小文字化、JAプレフィックス、au自分→auじぶん、ヶ/ケ/け/ゖ統一、先頭4文字一意のタイプミス救済）。**結果80/81名がコード・カナ解決**。残り1名=宇佐美亜梨果さん「おあ支店」（auじぶん銀行。おそらく「あお支店」の誤記・要本人確認）。
- **月次確認を稼働条件に**（f4a1f04）: ユーザー指示により、確認モーダル完了（姓名入力含む）まで**全メンバーの開始打刻・シフト提出をブロック**。未完了で打刻するとモーダル再表示。終了打刻・KPIは保全のため非ブロック。
- **申し送り**: 明日以降、各メンバーは初回ログインで確認必須になる。当月確認済みの人（本日テストした人など）は9月まで再表示されない。freee画面の直接確認は不可（ログイン共有なし）のため、検証はシミュレーション+ユーザーのスクショで実施する運用。

---

## 2026-08-03（第11弾: 税理士FB対応＝姓名分離・支店表記ゆれ補正）

- **依頼**: 税理士（大槻さん）から2点のFB。①取引先名は「姓 名」（半角スペース）にしてほしい・姓名を分けて入力させる形が良い ②野村有紀子さんの支店カナ・支店番号が空（振込不可）。
- **変更**:
  - **支店表記ゆれ補正**（4fdb91b）: 「高砂出張所」→正式名「高砂町出張所」のような1字違いを、種別語を除いた核同士の前方一致が**一意のときだけ**自動採用する緩和ルールを `matchBranchByName` に追加。コード確定時は銀行名・支店名ともマスタ正式名称でfreee/CSVに出力。
  - **姓名分離**（ADR-015）: `users.last_name/first_name` 追加（[supabase-migration-users-sei-mei.sql](../supabase-migration-users-sei-mei.sql)・要実行）。表示名の正=「姓 名」半角スペース。書き込み正規化を collapse型に変更（照合は従来のstrip型を維持し、freee同期の紐付けは不変）。収集は ①本人確認モーダルに姓・名入力（未分離の間は必須・確認/変更どちらのボタンも入力必須）②管理者編集フォームを姓・名2欄化 ③addMember/管理者追加はスペース入りなら自動分割。confirm-profile APIが姓名を受けて name を「姓 名」に更新。
- **検証**: `npx tsc --noEmit` ✅ / `npm run build` ✅
- **申し送り**:
  - **SQL実行が必要**: supabase-migration-users-sei-mei.sql
  - **サンプル検証 完了**: SQL実行後、関善広さんを姓=関/名=善広で保存→手動同期→freeeで「関 善広」表記を確認済み（2026-08-03 夜）。以降は本人確認モーダルで自然収集（姓名が確定した人から順次freee名が更新される）。
  - **残タスク（未着手・大槻さん依頼）**: 月次外注費データの生成 — freeeの取引インポート形式（収支区分/発生日=月末/決済期日=翌月15日/取引先/勘定科目=外注費/税区分=インボイス有無で課対仕入10%・控80/金額税込/備考/品目）で7月分の支払いを1人1行出力するCSVボタン、将来的には取引APIでの直接登録（要・freeeアプリ権限「[会計]取引 更新」追加+再接続）。既存の請求書一括記帳の計算ロジックを流用予定。
  - 未分割メンバーのfreee名は現状のまま（退行なし）。二重登録はID紐付けのため発生しない。

---

## 2026-08-03（第10弾: freee口座反映の検証リトライ・自動連動項目の追加＝最終確認完了）

- **経緯**: 既存取引先への更新(PUT)で口座情報がfreeeに入らないケースを実データで発見（関善広さん: アプリに口座ありなのにfreee空。エラーは返らず黙って無視される）。原因は「初回同期時に銀行コード空欄の不完全な口座を送った際、新規作成は受理・更新は無視」というfreee側挙動と推定。
- **変更**:
  - （ad2bf51）口座登録済みメンバーの更新後に GET で反映を検証し、未反映なら口座のみの最小ペイロードで自動リトライ。それでも入らなければ結果に⚠️表示。毎朝の自動同期でも毎回検証される。
  - （06eb7e8）カナ名称(name_kana=フリガナ)・取引先担当者(氏名+ログインIDがメール形式ならメール)・振込手数料負担(payer)を自動連動に追加。**本人への追加入力項目はゼロ**。支払元口座(GMOあおぞら)は会社側設定のため意図的に未対応（ユーザー了承済み。必要なら口座権限追加+再接続で対応可）。
- **最終確認**: 同期 新規0/更新81/エラー0。関善広さんの口座がフル項目（みずほ銀行/ﾐｽﾞﾎ/0001・柏支店/ｶｼﾜ/329・普通2225055・ｾｷ ﾖｼﾋﾛ）で反映されたことをfreee画面で確認。**freee連携はこれで完成・運用開始**。
- **メモ**: 古参メンバーはログインIDがメール形式でないため担当者メールは空になる（支払いに影響なし）。freee側にだけ存在する取引先（他事業の委託者・士業・法人等）は同期対象外で一切触らない設計。

---

## 2026-08-03（第9弾: 毎日自動同期・建物名分離・月次本人確認）

- **依頼**: ①同期を自動化したい（口座変更が自動でfreeeに反映）②freeeでカナ・銀行番号が空のメンバーがいる③建物名を分けたい④毎月1回ログイン時に本人へ登録情報の確認を出したい。

- **変更**:
  - **毎日自動同期Cron**（590f644）: [/api/cron/freee-sync-partners](../app/api/cron/freee-sync-partners/route.ts)（毎朝5:30 JST・CRON_SECRET認証）。同期コアを `syncAllMembersToFreee` として [lib/freee-partner-sync.ts](../lib/freee-partner-sync.ts) に抽出し手動ボタンと共通化。失敗・エラーがある日のみ SLACK_WEBHOOK_URL へ通知。
  - **銀行コード自動判定**: 同期・CSV時に users のコードが未確定なら銀行名・支店名からマスタ照合（`resolveBankCodesForFreee`）。「一括補完」ボタン未実行でもカナ・番号が出る。
  - **建物名分離**: `users.address2` 追加。本人・管理者の両編集フォームに「建物名・部屋番号」欄。freee の street_name2 と CSVの建物名列に反映。address2 未入力の既存データは「番地の後の空白区切り」のみ自動分割（`splitBuildingFromStreet`・誤分割防止のため空白なしは分割しない）。
  - **月次本人確認**: `users.profile_confirmed_month`（YYYY-MM）追加。月が変わって最初のログインでメンバー画面に確認モーダル（住所・電話・口座・インボイスの要約）。[この内容で間違いない]→ [/api/member/confirm-profile](../app/api/member/confirm-profile/route.ts) で当月を記録、[変更がある]→ 振込先フォーム（#member-billing-profile）へスクロール。フォーム保存でも当月確認扱い。変更は翌朝のCronでfreeeへ自動反映。

- **検証**: `npx tsc --noEmit` ✅ / `npm run build` ✅

- **申し送り**: **Supabase SQL 実行が必要** — supabase-migration-users-address2-profile-confirmed.sql（`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS address2 TEXT; ADD COLUMN IF NOT EXISTS profile_confirmed_month TEXT;`）。未実行の間は確認モーダルの記録・建物名保存がエラーになる（他機能は無影響）。Cron の CRON_SECRET は既存設定を流用。

---

## 2026-08-03（第8弾: freee連携の本番疎通・実データ対応）

- **経緯**: ユーザーがfreeeアプリ登録（プライベートアプリ・取引先の参照/更新権限・コールバックURL設定）とVercel環境変数を設定し、OAuth接続に成功（事業所: 株式会社RIM）。初回同期で実データ起因の問題を2件修正。
- **修正1（d1bef61）**: freee側の既存取引先が「安江 聡美」のようにスペース入りだったため、同期時に全取引先を取得し**空白除去名で照合して自動紐付け**するよう変更（更新時にnameがアプリ表記に揃うので表記統一も同時に完了）。
- **修正2（14df723）**: ゆうちょ銀行の口座番号（通帳の「番号」8桁・末尾1）でfreeeの7桁制限に引っかかる3名のエラーを、`accountNumberForTransfer`（末尾1除去・記号+番号連結は番号側採用・全角半角化）で解消。同期とCSV出力の両方に適用。DBの登録値は変えない。
- **結果**: 同期完了 — 新規30名/更新49名（既存紐付け）/エラー3名→修正2で解消見込み。freee側一覧で重複ゼロ・非メンバーの取引先（他事業の委託者・法人等）は無変更を確認。
- **修正3**: 住所が「厚木市…」のように都道府県なしで登録されているメンバーは freee の都道府県が「設定しない」になる問題を、**郵便番号から都道府県を自動判定**して解消（[lib/postal-prefecture.json](../lib/postal-prefecture.json)＝日本郵便データ由来の3桁プレフィックス表951件＋県境の7桁例外259件・12KB。`prefectureFromPostalCode`/`resolveJpAddress` を同期とCSVの両方に適用。住所側に都道府県があればそちら優先）。
- **重複整理**: freee一覧185件を空白無視で機械チェックし重複ゼロを確認。ただしアプリ内に「ホンダタカコ」「本多孝子」の同一人物2アカウントを発見（電話・フリガナ・銀行一致、メール1字違いの二重登録）→ ユーザー依頼によりカタカナ側を無効化し、正しいメール w6p7yf@outlook.jp を漢字側に付け替え。freee側の取引先「ホンダタカコ」はユーザーがUI から削除。
- **申し送り**: 3名（三浦景・山中美の里・康翔一）は修正2・3のデプロイ後に再同期が必要。月次運用は「メンバー情報が変わったら管理設定の[取引先をfreeeへ同期]を押すだけ」。本多孝子さんがログインできない場合は管理設定からパスワード再設定。

---

## 2026-08-03（第7弾: freee API自動連携＝フェーズ2）

- **依頼**: freeeと自動連携したい（CSV手動インポートではなくボタン一発同期）。

- **変更**:
  - **OAuth基盤**: [lib/freee-api.ts](../lib/freee-api.ts)（認可URL・コード交換・自動リフレッシュ・APIラッパー。トークンは freee_oauth_tokens に保管）。[/api/freee/oauth/start](../app/api/freee/oauth/start/route.ts)（state をhttpOnly Cookieで照合）・[callback](../app/api/freee/oauth/callback/route.ts)（交換→事業所取得→保存→`/?freee=connected` へ）。
  - **同期**: [lib/freee-partner-sync.ts](../lib/freee-partner-sync.ts)（公式OpenAPIスキーマ準拠のpartnerペイロード。org_code=2個人・都道府県コード変換・振込口座・支払条件 末日/翌月/15日・インボイス）。[/api/admin/freee-sync-partners](../app/api/admin/freee-sync-partners/route.ts)（未同期=作成→`users.freee_partner_id` 保存、同期済み=更新、名前重複=freee側を検索して自動紐付け）。[/api/admin/freee-status](../app/api/admin/freee-status/route.ts)。
  - **UI**: 管理設定に「freee連携」カード（接続状態・[freeeと接続]・[取引先をfreeeへ同期]・結果内訳）。OAuth戻りのクエリで管理設定を自動オープンし結果表示。
  - **DB**: [supabase-migration-freee-integration.sql](../supabase-migration-freee-integration.sql) — freee_oauth_tokens（**RLSポリシーなし=service_roleのみ**・ADR-014）+ users.freee_partner_id。
  - `.env.example` に FREEE_CLIENT_ID / FREEE_CLIENT_SECRET を追記。

- **検証**: `npx tsc --noEmit` ✅ / `npm run build` ✅（実APIはfreeeアプリ登録後でないと疎通確認不可）

- **申し送り（ユーザー作業が3つ必要）**:
  1. Supabase SQL: supabase-migration-freee-integration.sql を実行
  2. freeeアプリストア開発者ページでアプリ登録 → コールバックURL `https://my-attendance-rho.vercel.app/api/freee/oauth/callback`、権限は取引先の読み書き → Client ID/Secret を取得
  3. Vercel 環境変数: FREEE_CLIENT_ID / FREEE_CLIENT_SECRET を追加（SUPABASE_SERVICE_ROLE_KEY が未設定ならそれも）→ 再デプロイ
  - その後 管理設定 → freee連携 → [freeeと接続] → [取引先をfreeeへ同期]。**実データでの疎通確認は未実施**（接続後の初回同期で要確認）。

---

## 2026-08-03（第6弾: freee取引先CSVエクスポート）

- **依頼**: freeeの「取引先マスタインポートフォーマット」CSV（ユーザー提供・Shift_JIS）を確認し、この形式でメンバーを出力できるようにする。

- **変更**:
  - [lib/freee-partners-csv.ts](../lib/freee-partners-csv.ts): freee形式のCSV生成。テンプレート実例に合わせた表記 — 銀行番号・支店番号は先頭ゼロなし（0036→36）、カナは半角（ﾗｸﾃﾝ）、支店名は「〇〇支店」（営業部・本店等はそのまま）、住所は都道府県を分割、支払条件は全員共通（末日締め・翌月1ヶ月後15日払い・当方負担・支払元GMOあおぞらネット銀行）、適格請求書は登録番号の有無で該当する/しない。
  - [lib/bank-master.ts](../lib/bank-master.ts) に `bankByCode/branchByCode`（コード→カナ取得）。
  - [/api/admin/freee-partners-csv](../app/api/admin/freee-partners-csv/route.ts)（管理者のみ・UTF-8 BOM付き）。管理設定に「freee取引先CSVをダウンロード」ボタン。
  - 変換ロジックはテンプレートの実データ行（楽天/ﾗｸﾃﾝ/36/チェロ支店/ﾁｴﾛ/214）と一致することを検証済み。

- **検証**: `npx tsc --noEmit` ✅ / `npm run build` ✅

- **申し送り**: 出力はUTF-8(BOM)。freeeのインポートが文字コードで弾いた場合はShift_JIS化を検討（要 iconv-lite 追加 or 手動変換案内）。カナ列は銀行コード・支店コード確定済みメンバーのみ埋まる（→先に「銀行コードを一括補完」を実行）。建物名列は住所から機械分割できないため空で出力（市区町村・番地に含む）。

---

## 2026-08-03（第5弾: 銀行コード・支店コードの自動入力＝freee連携フェーズ1）

- **依頼**: 銀行コード・支店番号を自動入力したい。目的は freee（会計・有料プラン加入済み）との連携。フェーズ1=コード保持＋入力補助、フェーズ2=freee API連携（未着手）と合意。

- **変更**:
  - **データ**: 全銀協マスタ（zengin-code/source-data 2026-06-30版・MIT）を [lib/zengin-data.json](../lib/zengin-data.json)（約2MB）に統合して内蔵。[lib/bank-master.ts](../lib/bank-master.ts) に検索・厳格照合（正規化: NFKC・かな統一・信用金庫→信金等の略称化）。**サーバー側のみで読む**（クライアントバンドル非搭載）。ADR-013。
  - **API**: [/api/bank-master](../app/api/bank-master/route.ts)（候補検索・認証不要の公開マスタ）、[/api/admin/backfill-bank-codes](../app/api/admin/backfill-bank-codes/route.ts)（管理者のみ・既存メンバーの一括照合補完）。
  - **DB**: `users.bank_code / branch_code` 追加。[supabase-migration-users-bank-codes.sql](../supabase-migration-users-bank-codes.sql)（未実行なら下記）。
  - **型・保存経路**: Member.bankCode/branchCode、toMember、updateMemberOrThrow、本人用 bank-profile API、管理者用 member-update API（列未作成環境でも他項目の保存が通るよう指定時のみ送る）。
  - **UI**: `BankMasterAutocompleteField`（銀行名→候補選択でコード確定・銀行変更で支店コード無効化・手入力はコード未確定）。メンバー本人の振込先編集と管理者のメンバー編集の両方に適用。管理設定に「銀行コードを一括補完」ボタン（更新/スキップ/要手動対応の内訳と未照合一覧を表示）。
  - 照合ロジックはメガバンク・ネット銀・ゆうちょ・信金・支店の実データでテスト済み（全ケース正解）。

- **検証**: `npx tsc --noEmit` ✅ / `npm run build` ✅（/u フラグは es5 ターゲット非対応のため除去）

- **申し送り**:
  - **Supabase SQL 実行が必要**: `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS bank_code TEXT; ALTER TABLE public.users ADD COLUMN IF NOT EXISTS branch_code TEXT;` → 実行後に管理設定の「銀行コードを一括補完」を1回実行。
  - マスタ更新手順: source-data を再取得して lib/zengin-data.json を再生成（bank-master.ts 冒頭コメント参照）。年1回程度でよい。
  - **フェーズ2（freee API連携）は未着手**。freeeアプリ登録（OAuth）→「freeeへ同期」ボタンで取引先＋振込口座を登録する構想。

---

## 2026-08-03（第4弾: 電話番号必須化・ダッシュボード警告カードの判定拡張）

- **依頼**: 電話番号もマストで入力させたい（7月稼働49名の読み取り専用チェックで、不足は伊藤瑛喜さんの電話番号のみと判明。最終稼働 7/14）。
- **調査結果**: メンバー本人の振込先編集画面は既に電話番号必須（`getMissingBillingProfileFields`）。穴は ①Googleフォーム登録時に必須でない ②ダッシュボード赤カードが文言に反して振込先4項目しか見ていない、の2つ。
- **変更**: 赤カード判定を文言どおり「振込先4項目＋請求管理番号＋電話番号」に拡張（管理者アカウント除外）。不足項目名も「名前（電話番号）」形式で表示。「今すぐ編集」の先頭メンバーオープンは維持。
- **検証**: `npx tsc --noEmit` ✅ / `npm run build` ✅
- **申し送り**: **Googleフォーム側で『携帯電話番号』を必須設定にするのはユーザー作業**（アプリ側では対応不可）。webhook で必須化する案はフォーム改修漏れ時に登録自体が失われるリスクがあるため見送り（ADR記載なし・必要になったら再検討）。

---

## 2026-08-03（第3弾: メンバー名のスペース統一＋KPI日別を稼働メンバーのみ表示）

- **依頼**: ①KPI日別テーブルの表示名の表記ゆれ（全角スペース入り・カタカナ等）を統一したい（仕様確認: スペースなしに統一・自動化）。②日別テーブルにその日稼働していないメンバーも並ぶので、稼働メンバーだけに絞りたい（仕様確認: シフト・打刻・KPIいずれかがある人＋「全員表示」チェックで解除）。

- **変更**:
  - **名前正規化**: [attendance.ts](../lib/attendance.ts) に `normalizeMemberName`（全空白除去）を追加し、全書き込み経路に適用 — `addMember` / `updateMemberOrThrow`（管理設定の編集・外部の詳細更新APIも経由）/ Googleフォーム登録 `buildGoogleFormUserInsertRow`。既存データはSQLで一括除去（下記申し送り）。
  - **KPI日別テーブル**: `kpiDailyRowsGeneral` を既定で「その日にシフト予定（なし行除く）・打刻実績・KPI入力のいずれかがあるメンバー」に絞り込み。表示日付の隣に「全員表示」チェックボックス、0人時の空メッセージ行を追加。インターンの確定数一覧は対象外（変更なし）。
  - ※カタカナ表記（例: ホンダタカコ）→漢字は正しい漢字がデータに無いため自動変換不可。管理設定から手動修正する運用。

- **検証**: `npx tsc --noEmit` ✅ / `npm run build` ✅

- **申し送り**: 既存データのスペース除去は Supabase SQL Editor で1回実行が必要:
  `UPDATE public.users SET name = REPLACE(REPLACE(name, '　', ''), ' ', '') WHERE name LIKE '%　%' OR name LIKE '% %';`

---

## 2026-08-03（第2弾: 休業日の自動提案カード）

- **依頼**: 年数回の長期休み（GW・お盆・年末年始）を管理者に自動提案してほしい。「来月は連休がありますがどうしますか？」→登録するか「今回は不要」で消えるかを選べる形（仕様確認: 祝日連休＋慣習休み／管理ダッシュボードにカード表示／却下はDB記録で全端末共通・翌年は再提案）。

- **変更**:
  - **lib**: 新規 [company-holiday-suggestions.ts](../lib/company-holiday-suggestions.ts)。日本の祝日をアプリ内計算（固定日・ハッピーマンデー・春分秋分近似式・振替休日・国民の休日）し、連続する平日祝日は連休にまとめて提案（GW期間は「ゴールデンウィーク」命名）。お盆=8/13〜8/16・年末年始=12/29〜1/3 は慣習期間として毎年提案。開始60日前から表示。2026/2027の祝日で計算結果を検証済み。
  - **DB**: 新テーブル `company_holiday_suggestion_dismissals`（suggestion_key UNIQUE）。マイグレーション [supabase-migration-company-holiday-suggestion-dismissals.sql](../supabase-migration-company-holiday-suggestion-dismissals.sql)。
  - **管理画面**: ダッシュボード上部に「🗓 休業日の提案」カード。[休業日として登録]は手動登録と共通化した `registerCompanyHolidayPeriod`（既存シフト件数確認→削除→登録）、[今回は不要]は却下キーをupsert。登録済み期間でカバーされた提案・却下済みは非表示。
  - ADR-012 を [DECISIONS.md](DECISIONS.md) に追記。

- **検証**: `npx tsc --noEmit` ✅ / `npm run build` ✅ / 祝日計算はscratchpadスクリプトで2026・2027年の官報祝日と全件一致を確認。

- **申し送り**: **Supabase SQL Editor で `supabase-migration-company-holiday-suggestion-dismissals.sql` の実行が必要**（未実行だと「今回は不要」がエラーになるだけで提案表示と登録は動く）。今日(8/3)時点の表示想定は「山の日 8/11」「連休（敬老の日〜秋分の日）9/21〜9/23」の2枚（お盆はカバー済みのため非表示）。

---

## 2026-08-03（会社休業日のシフト提出ブロック＋Slack0人スキップ＋KPIにKC数）

- **依頼**: ①お盆など会社休業日は管理者設定でシフト提出不可にしたい（Slackスレッドの「12〜15日の稼働希望を出せないように」が発端。仕様確認の結果: シフト提出のみブロック／期間で登録／登録時に既存シフトを確認のうえ削除）②稼働予定者がいない日はSlack朝通知を送らない ③業務委託KPIの期間集計に「KC数」を表示（中野さんのSlack依頼）。

- **変更**:
  - **DB**: 新テーブル `company_holidays`（id/name/start_date/end_date）。マイグレーション [supabase-migration-company-holidays.sql](../supabase-migration-company-holidays.sql)。
  - **lib**: [attendance.ts](../lib/attendance.ts) に `CompanyHoliday` 型＋`findCompanyHolidayForYmd`。[supabase-data.ts](../lib/supabase-data.ts) に `loadCompanyHolidays`/`addCompanyHoliday`/`deleteCompanyHoliday`/`deleteShiftsInDateRange`。
  - **メンバー画面**: `ShiftTab` が `companyHolidays` を受け取り、休業日は土日と同じ「稼働予定なし」固定（フォーム初期化・前週コピー・保存・描画の全経路）。行には「会社休業日（名称）のため登録できません」を表示。
  - **管理画面**: 管理設定に「会社休業日」カード（名称＋開始日＋終了日で登録／一覧＋削除）。登録時に期間内の登録済みシフトを DB から取り直して件数提示→confirm→`deleteShiftsInDateRange` で削除→登録。削除も confirm 付き。
  - **Slack**: [slack-daily.ts](../lib/slack-daily.ts) 稼働予定者0人の日は `skipReason:"noWorkers"` でスキップ（休業日かに関係なく）。手動テスト（`bypassWeekendSkip:true`）は従来どおり送信。
  - **KPI**: 業務委託KPIの期間指定カスタム集計に「KC数」タイル（`rangeTotals.kcCount`・総有効コール数の隣）。

- **検証**: `npx tsc --noEmit` ✅ / `npm run build` ✅。

- **申し送り**: **Supabase SQL Editor で `supabase-migration-company-holidays.sql` の実行が必要**（未実行だと休業日登録がエラーメッセージで失敗するだけで他機能には影響なし）。管理者による稼働予定管理（代理編集）は休業日をブロックしない仕様（管理者の裁量を残すため・依頼スコープA）。

- **依頼**: 「明日のFB面談用に、7月1ヶ月分の営業データをサブエージェント総動員で分析し、メンバー別評価・会社課題・外部ベンチマーク・8月受注100件超えの逆算まで入った資料を作って」。

- **作業**: 本番Supabaseを**読み取りのみ**（users/kpis/attendance、2026-05〜07）で抽出→scratchpadで集計JSON化→Workflowで11体（ファネル/メンバー個別×2/生産性ROI/逆算モデル/外部リサーチ×2/批評役/追加分析×2/統合）→主要数字をClaudeが独立再計算で検証。**リポジトリのコード・DBは一切変更していない**。成果物（実名入り・社内限り）はrepo外に納品（誤コミット防止のため意図的にrepoへ置かない）。

- **分析で判明した運用上の発見（アプリ改善のタネ）**:
  - **`kpis.confirmed_dm / confirmed_non_dm` が5〜7月すべて0＝管理者の商談確定入力が3ヶ月間停止**。受注ファネルが計測不能。入力再開の運用か、未入力リマインド機能の検討余地。
  - KC（担当者接続）の数え方がメンバー間でブレている強い証拠（アポ>KCの日が存在等）。KPI入力欄に定義ツールチップを付ける改善余地。
  - 打刻あり・コール0・KPI未入力が22.8h分ある等、`attendance`と`kpis`の突合アラートがあると監査が楽になる。

- **検証**: コード変更なしのため tsc/build 対象なし。抽出スクリプトはscratchpad（セッション限り）。

- **申し送り**: 7月チーム実績の要点＝決裁者アポ266件（6月152・5月73）・総コール64,806・稼働49名1,932.9h・決裁者アポ単価¥13,847。8月目標の逆算は「成約100件＝中央シナリオで決裁者アポ417件」。

---

## 2026-07-31（全体監査＋セキュリティCritical修正・第1弾）

- **依頼**: 「30体以上のサブエージェントで、セキュリティ・矛盾・問題点・追加機能・重要事項を調べて最強のサービスを目指して」。

- **監査**: Workflowで63体のサブエージェントを稼働（領域×観点マトリクス＋critical/high敵対的検証）。指摘103件・機能提案35件。フルレポートは **[docs/AUDIT_2026-07-31.md](AUDIT_2026-07-31.md)**（未コミット）。最重要Criticalは Claude が実ファイルReadで裏取り済み。
  - 判明した重大欠陥: ①RLS全開放（`supabase-schema.sql:179-192` 全テーブル `USING(true) WITH CHECK(true)`→anonキーだけで全データ読み書き）②無認証の口座更新API ③平文パスワード（照合フォールバック/管理画面表示/初期PW"12345"）④認証弱化（試行制限なし・無効化後30日セッション）。運用事故（管理者自己ロックアウト・保存失敗の誤成功・他人打刻消失・アラート重複）、性能（全件ロード）、整合性（一意制約欠落）等。

- **修正（この日デプロイ済み）**:
  1. **無認証の口座API（Critical②）** `7d20910`: [update-bank-info](../app/api/external/update-bank-info/route.ts)・[update-member-details](../app/api/external/update-member-details/route.ts) に登録系と同じ `verifyExternalRegisterSecret` を追加（失敗401）。`EXTERNAL_REGISTER_SECRET` は本番設定済み(5/27)のため即保護。**本番でcurl検証→無認証/誤トークンとも401を確認**。
  2. **平文パスワード表示削除（Critical③一部）** `ce313ac`: [app/page.tsx](../app/page.tsx) 管理メンバー表の `mem.password` 平文表示（title hover含む）を「設定済み/未設定」マスクに。PWリセットは既存の編集フォーム(editPass)で継続可能。
  3. **管理者の自己ロックアウト防止（High/監査5）** `cae6d4d`: UI(dormantMembers memoでlogin_account='admin'除外)＋保存層(updateMemberOrThrowで is_active=false×admin を throw)の二層。削除経路 deleteMember と同じ規則。
  4. **③完了：平文パスワード撲滅** `c1bb36d`+`0c53701`: 本番の平文PW48件を pgcrypto `crypt(password, gen_salt('bf',10))` でハッシュ化（ユーザーがSQL Editorで実行・remaining=0確認）。コードは `hashPasswordForStorage` を addMember/updateMemberOrThrow/saveMembers に適用→照合の平文フォールバック `s===plain` を撤去（bcryptのみ許可）。ログイン動作確認済。external-register は元々ハッシュ済。
  5. **監査6：一括無効化の誤成功表示を修正** `d6eb869`: 休眠/未稼働の一括無効化を `updateMember`(握り潰し)→`updateMemberOrThrow` に切替え、1件ずつ成功/失敗を集計し失敗は氏名＋理由を表示。管理者ガードのエラーも画面表示されるように。
  6. **監査11：実名入り試作データ＋デッドコード削除** `b10f7c6`: `data/users.json`・`data/records/user-1.json`(実名＋bcryptハッシュ)を削除＋`data/`を.gitignore。`lib/store.ts`・`lib/users.ts`＋無効API3本(records/records-open/users・揮発FS・無認証)を削除。相互参照のみで他未参照を確認。open-record-client-backup.ts は現用で残置。※git履歴にはまだ残る(パージ未実施・低緊急)。
  7. **監査7：Slack Webhook自動リトライ** `af4ce4f`: `postSlackIncomingWebhook` を `attemptSlackIncomingWebhook`＋`withNetworkRetry`(最大3回)に。ネットワーク例外/429/5xxのみ再試行、4xx/本文not-okは即失敗。全Slack通知に効く。
  8. **監査7：未打刻アラート重複送信を防止** `b52d05d`: 開始/終了アラートを「送信→記録」順から「予約(先INSERT)→送信→失敗時DELETE」順へ。一意制約違反はスキップ。重複送信→最悪1回スキップに。
  9. **監査10：シフト『来月』の日付1日ズレ修正** `fa50494`: `applyShiftShortcutNextMonth` が `new Date(年,月,1)`(ローカル)を `toDateString`(=toISOString・UTC)で整形しJSTで1日前にずれていた→暦の数値から直接 YYYY-MM-DD 組み立てに。8822の prevDate は UTC解析→UTC整形で相殺され正しいため不変。

- **検証**: 各修正で `npx tsc --noEmit` ✅ / `npm run build` ✅。②は本番実機(curl)で401確認。③はログイン再確認済。

- **本番Supabase実体確認済（pg_policies）**: 全7テーブル `USING(true) WITH CHECK(true)`＝全開放。FREEプラン・quota超過警告あり（2026-08-14以降制限の可能性）。

- **申し送り（残Critical・未着手）**:
  - **①RLS全開放（最大の穴・フェーズ0完了/フェーズ1未着手）**: パスワードはハッシュ化したが、口座/住所/氏名等は今も平文＆anonで読み書き可能。
    - **フェーズ0（完了・`1bb1729`）**: 段階移行プラン [docs/RLS_MIGRATION_PLAN.md](RLS_MIGRATION_PLAN.md) 策定。`lib/supabase-admin.ts`（service_role・クライアント誤importで例外）追加。**Vercelに `SUPABASE_SERVICE_ROLE_KEY` 投入済（Production/Preview・Sensitive・非NEXT_PUBLIC）**。`.env.local` は未設定（ローカルで service_role は扱わない方針）。
    - **フェーズ1 進捗（2026-07-31 追加実装・デプロイ済）**:
      - service_roleキー疎通検証OK（`/api/admin/members` で168名取得・`59f6fa0`）。
      - `getUsersDb()`（サーバ=service_role/クライアント=anon）を `loadMembers` に適用（`eccbb28`）。サーバNextAuthログインも service_role で users を読む。**本番でログイン＋リロード確認済**。
      - 読み取りAPI足場: `GET /api/admin/members`(管理者=全件)＋`GET /api/member/me`(本人1件)、いずれもPW除外・service_role（`7fffcc4`）。**まだクライアント未使用**。
    - **フェーズ1 残り（次回・リスク高・要集中）**: ①書き込み系のサーバ集約（addMember/updateMemberOrThrow/deleteMember/saveMembers を getUsersDb化・member-update/bank-profileのanon→admin）②クライアント読み取り差し替え（page.tsxのloadMembers直呼び→API。**要確認: 一般メンバー画面が他メンバー情報を要するか**）③ログインsignIn化（page.tsx:9939のclient loginUser撤去・**リロード復元に影響**）④`drop policy "Allow all for users"`。詳細は RLS_MIGRATION_PLAN.md「進捗(2026-07-31)」。**繊細＝小分けに実装し都度本番確認**。
  - **④認証堅牢化（残）**: 初期PW"12345"のランダム化＋初回変更必須（users.must_change_password列追加・登録/ログインUI）、ログイン試行回数制限、AUTH_SECRET未設定で起動停止。※無効化メンバーのセッション失効は既に対応済（loginUser 1537・hydrate 9225 とも isActive!==false 判定あり。残る窓は「無効化された本人が同一タブでリロードしない間」のみ・低リスク）。
  - `external-register-auth.ts` のフェイルオープンは本番でsecret設定済みのため実害無し（フェイルクローズ化は任意）。
  - メモリ: [[security-audit-2026-07-31]] に要点記録済み。

---

## 2026-07-30（2部制メンバーの2回目「業務開始」が押せないバグ修正）

- **依頼**: 「10-12時/13-16時の2部制の人が、10-12で打刻終了した後、13時に業務開始を押すと押せなかった。原因を突き止めて→デプロイまでして」

- **診断**: 開始打刻の予定ベース許可ウィンドウが**その日の最速枠の開始だけ**を基準に「開始−60分〜開始＋60分」で計算されていた（旧 `getMemberStartPunchEarliest/LatestJstMinutesSinceMidnight`・[lib/punch-time-guard.ts](../lib/punch-time-guard.ts)）。10-12/13-16 の人は許可窓が 9:45〜11:00 のみになり、13:00 の2回目開始は「遅すぎ」で拒否（トースト「稼働開始は予定時刻の1時間後まで可能です。管理者に連絡してください」）。
  - さらに過去の `61c40f7`（2026-06-01「休憩後の業務開始ボタン無効化バグを修正」）が**ボタンの見た目だけ** `hasWorkedTodayAlready` で有効化していたため、「押せるのに押すとエラー」というチグハグが発生していた（handleStart と DB保存側 `assertMemberOpenRecordPunchAllowed` には免除なし）。

- **変更**（[lib/punch-time-guard.ts](../lib/punch-time-guard.ts) +43/-47・[app/page.tsx](../app/page.tsx) +12/-16）:
  - 新設 `getMemberStartPunchWindowsJstMinutes`: **枠1・枠2それぞれの開始±60分**の許可ウィンドウ一覧を返す（`getShiftPlannedSegmentsChronological` ベース・9:45/21:15クランプ）。予定なしは null。
  - `isMemberStartPunchAllowedByPlannedWorkJst` / `assertMemberStartPunchAllowedByPlannedWork` をウィンドウ一覧判定に書き換え（全窓より後=遅すぎ、それ以外の窓外=早すぎ）。旧 Earliest/Latest ヘルパーは削除。
  - page.tsx の `punchStartPlanBlockReason`・handleStart 内の tooLate 判定を新ヘルパーに置換。
  - `hasWorkedTodayAlready` の抜け道を撤去し、ボタン無効化条件と実判定を一致させた（UI・handleStart・DB保存の3層が同一規則に）。

- **検証**: `npx tsc --noEmit` ✅ / `npm run build` ✅ / 一時スクリプト（tsx・削除済み）で10ケース検証 ALL PASS（10-12/13-16 で 10:00・11:00・12:00・13:00・14:00 許可、11:30 は早すぎ、14:01 は遅すぎ、1枠のみの13:00は従来どおり拒否、予定なしは日次窓のみ）。

- **反映**: コミット `f99a8a6`（`main`）。

- **申し送り**: 枠間ギャップは「早すぎ」メッセージになる（次の枠基準）。

- **追記（同日・ユーザー依頼）**: 開始打刻の許可幅を **±60分 → ±30分** に変更（`PUNCH_START_LEAD/LAG_MINUTES` = 30）。エラーメッセージは定数からテンプレート生成に変えて数値と文言のズレを防止。page.tsx の案内文も「30分前〜30分後」に更新。tsc/build 緑＋一時スクリプト9ケース ALL PASS（10-12/13-16 で 9:45〜10:30 と 12:30〜13:30 が許可窓）。

---

## 2026-07-30（続き：リロード直後にログイン画面が見える問題の修正）

- **依頼**: 前回修正(1a43081)後も「リロードしてもログイン画面に行く」との報告。

- **診断（ブラウザ実機で特定）**: セッション復元自体は**正しく動いていた**。本番でログイン→Cookie作成→リロード→十数秒後に管理画面へ自動復帰することをブラウザパネルで確認。真の問題は、復元処理が**全データ読み込み（重い・十数秒）の後**に走るため、その間 `currentUserId === null` でログイン画面が表示され「ログアウトされた」ように見えていたこと。ユーザーはそこで再ログインしていた。

- **変更**（[app/page.tsx](../app/page.tsx)・+47/-16）:
  - `getSession()` による復元を `hydrate()` 内の**重いデータ読み込みの前**に移動（loadMembers 直後）。判定はほぼ一瞬で完了。
  - `sessionChecked` state 追加：判定完了までログイン画面の代わりにローディング（スピナー＋「読み込み中…」）を表示。
  - `initialDataLoaded` state 追加：ログイン済みでも初回データ読み込み完了までローディング表示（空ダッシュボードで「データが消えた」と誤解されるのを防ぐ）。
  - `hydrate` の `finally` で両フラグを必ず立てる（エラー・早期return時もローディングが固まらない）。

- **検証**: `npx tsc --noEmit` ✅ / `npm run build` ✅ / **本番実機確認** ✅（デプロイ後、セッションありでリロード→ログイン画面が出ずローディング→管理者画面に自動復帰、をブラウザパネルのスクリーンショットで確認）。

- **反映**: コミット `1426558`（`main`）。Vercel デプロイ success 確認済み。

- **申し送り**:
  - リロード後、画面が出るまで「読み込み中…」が十数秒続くのは全件ロードの重さ（地雷①・ADR-006 フェーズ2未着手）由来。速くしたければフェーズ2（直近3ヶ月ロード）を実施する。
  - デバッグ手法メモ: 本番の挙動確認は Claude のブラウザパネルでユーザーにログインしてもらい、network/console を観察して特定した。パスワードは預からない運用。

---

## 2026-07-29（リロードでログアウトされる問題の修正: NextAuthセッションから復元）

- **依頼**: 「毎回リロードするだけでログインはじかれるんですけどどうにかできないですか？」

- **診断**: 地雷⑥そのもの。ログイン時に NextAuth セッション（JWT Cookie・30日有効・[lib/auth.ts](../lib/auth.ts)）は作成しているのに、ログイン判定はメモリ上の `currentUserId`（useState・[app/page.tsx:8998](../app/page.tsx)）のみ。リロード→state消滅→`hydrate()` が `currentUserId` を null のまま→必ずログイン画面に戻る構造だった。

- **変更**（[app/page.tsx](../app/page.tsx) のみ・+14/-1）:
  - `hydrate()` 末尾で `getSession()`（next-auth/react）を呼び、セッションの `user.id` が有効メンバー（`isActive !== false`）に一致すれば `currentUserId` を復元。admin アカウントは復元時も `isAdminMode: true` で開く（ログイン時と同じ挙動）。
  - **独自のlocalStorage実装は追加せず**、ログイン時に既に作っていた NextAuth セッションを読むだけ。ログアウト（`signOut`）で消えるのも従来通り。

- **検証**: `npx tsc --noEmit` ✅ / `npm run build` ✅。admin パスワード不明のため実ログイン→リロードの手動確認はユーザーに依頼。

- **反映**: コミット `1a43081`（`main`）。

- **申し送り**:
  - 復元は「ログイン時に NextAuth セッション作成が成功していた場合」のみ有効。本番で `AUTH_SECRET`/`NEXTAUTH_URL` 未設定だと signIn が失敗し（console.warn は既存実装で出る）、従来通りリロードでログアウトされる。
  - 管理者の Slack テスト送信用パスワード（`slackAdminAuthMemory`）はメモリ保持のためリロードで消えるが、既存のフォールバック（`window.prompt` で再入力・[app/page.tsx:2400付近](../app/page.tsx)）があるので機能は壊れない。
  - CLAUDE.md §10 地雷⑥「セッションはリロードで消える」は本修正で解消。次回ドキュメント整備時に文言更新を検討。

---

## 2026-07-27（ログインの体感改善: 二重送信防止＋処理中表示）

- **依頼**: 「ログインする時が遅い」「ボタンが押せてるか不安でダブルタップしてしまう。対処法は？」

- **診断**: ログインは重い認証を2段階で実行（`loginUser` の `bcrypt.compare`（[lib/users.ts:44](../lib/users.ts)）→ `signIn`（NextAuth・[app/page.tsx:9908/9915付近](../app/page.tsx)））で数秒かかるのが本質。にもかかわらずログインボタン（旧 [app/page.tsx:10147](../app/page.tsx)）に**処理中表示も二重押し防止も無かった**。→ 無反応に見えてダブルタップ→重い認証が2回走りさらに遅延、の悪循環。bcrypt は意図的に遅い処理なので「速くする」より「待ちを可視化＋多重実行防止」が正解。

- **変更**（[app/page.tsx](../app/page.tsx) のみ・+39/-22）:
  - `isLoggingIn` state 追加。`handleLogin` を再入ガード（先頭で `if (isLoggingIn) return;`）＋ `try/finally` で busy 管理＋ catch でエラーメッセージ。
  - ログインボタンを `disabled`＋スピナー＋「ログイン中…」表示に。入力欄も処理中は `disabled`。
  - **認証ロジックは不変**。既存の他ボタン（`endModalSubmitting`/`invoiceBatchExportBusy` 等）と同じ方式。

- **検証**: `npx tsc --noEmit` ✅ / `npm run build` ✅。
- **反映**: コミット `ca9fd1d`（`main`）。

- **申し送り**: 「押した実感が無いボタン」は他にもあり得る（保存/送信系）。今回はユーザー合意でログインのみ対応。要望あれば主要ボタンを一括点検して同方式（busy＋disabled＋再入ガード）を横展開する。多くの主要ボタンは既に busy 状態を持つ（打刻=`punchSubmitPhase`、一括記帳=`invoiceBatchExportBusy` 等）。

---

## 2026-07-27（管理画面の重さ改善・フェーズ1: 再計算の抑制）

- **依頼**: 「アプリが異常に重く、クリックしてから数秒たたないと進まない」。原因調査→対策。対象は**管理画面（AdminDashboard）**、保持期間は**直近3ヶ月**方針で合意。

- **診断（重要）**: 「クリック→数秒」の直接主因は**データ量ではなく毎レンダー再計算**だった。
  - `AdminDashboard`（`isAdminMode` 時のみ描画・[app/page.tsx:1420](../app/page.tsx)〜）内で `activeMembers`（旧 [1653](../app/page.tsx)）が**毎レンダー新配列**として作られ、これを依存に持つ多数の重い `useMemo`（`dashboardMemberSplit`→`dashboardGeneralMetrics`、`adminMemberTable`、`plannedShiftList`、`dailyActual` 等）が**毎クリック再計算**されていた。
  - さらに生産性/選択日集計（`rangeKpisForProductivity`/`rangeMinutesForProductivity`/`dateKpis`/`userIdsFromAttendance`/`workingCountForDate`/`dateTeamMinutes`/`apoListForDate`）が**未メモ化**で毎レンダー全配列走査。

- **変更**（[app/page.tsx](../app/page.tsx) のみ・+51/-20）:
  - `activeMembers` を `useMemo(() => members.filter(...), [members])` 化。
  - 上記スキャン群を `useMemo` 化（変数名は不変・下流参照はそのまま。deps は期間文字列/`dashboardDate`/元配列）。
  - **読み込むデータ・表示内容は一切不変**。ムダな再計算を止めるのみ＝低リスク。

- **検証**: `npx tsc --noEmit` ✅ / `npm run build` ✅（両緑）。

- **反映**: コミット `64e2747`（`main`）。

- **申し送り（次にやること）**:
  - **フェーズ2（未着手・合意済み）**: 起動時ロードを**直近3ヶ月**に絞る（`allRecords/allShifts/allKpiRecords`）。ただし `allRecords/allShifts/allKpiRecords` は全画面共有のため、**古い期間を開く画面**（月選択 `getSelectableMonths` [app/page.tsx:3452付近](../app/page.tsx)／過去月の請求書・実績PDF／メンバー全履歴 [4322付近](../app/page.tsx)／ROI・生産性・KPI・予実乖離アーカイブ・スケジュールCSVの任意期間）には**オンデマンド追加取得の受け皿**が必須。既存 `loadShiftsInDateRange`/`loadKpiInDateRange`（[lib/supabase-data.ts:925/941](../lib/supabase-data.ts)）があるので、`loadRecordsInDateRange` を足して同じ仕組みに乗せる。→ 中リスクなので着手前に設計確認。
  - まずはユーザーに**今回の効果（クリックの体感）を確認してもらう**のが先。効果不足ならフェーズ2へ。

---

## 2026-07-23（打刻モーダルの既定時刻変更）

- **依頼元**: Slack / RIM 中野晃之介さん
  「業務開始を押さずに業務終了を押すと出る画面の、デフォルト時間を9時から10時に変更できる？」

- **変更**: 「開始時間の確認」モーダル（開始打刻なしで終了した時に出る）の開始時刻の**初期表示**を `09:00` → `10:00`。
  - [`app/page.tsx:8975`](../app/page.tsx) `useState("10:00")`（state初期値）
  - [`app/page.tsx:9572`](../app/page.tsx) `handleEndClick` 内でモーダルを開く直前のリセット値（**実際に画面に出るのはこちら**）
  - 差分は2行のみ。ロジック（15分丸め・土日拒否・締切ガード・「現在の時刻を開始とする」）は一切変更なし。

- **触っていない `"09:00"`（同名だが別物・混同注意）**:
  - `app/page.tsx:460` `getTimeFromIso` の空文字フォールバック
  - `app/page.tsx:2046` `normalizeTimeInputValue` の不正値フォールバック
  - `app/page.tsx:1575 / 3039 / 4310` 管理画面の実績編集フォーム初期値
  - `app/page.tsx:9625` / `lib/punch-client.ts:48` エラーメッセージ内の「例 09:00」という文言
  - → 「デフォルト9時を10時に」系の依頼が再度来たら、**どの画面の話か**を必ず特定してから直すこと。

- **検証**: `npx tsc --noEmit` OK ／ `npm run build` OK（両方緑）。

- **反映**: commit `c35c4bb` → `git push origin main` 済み。
  本番配信中のチャンク `app/page-*.js` 内に `eL("end_modal_open"),e$("10:00")` を確認し、デプロイ反映まで検証済み。

- **申し送り / 次にやるなら**:
  - 今回は固定値。「人によって始業時間が違うので毎回直すのが面倒」という声が出たら、
    **その日のシフト予定の開始時刻を初期値にする案**（`canonicalShiftForUserDate(allShifts, uid, workDate)?.startPlanned`、予定なしは `10:00`）が既存の仕組みに乗せられる。
    ただし「予定＝実績」になりやすく予実乖離チェックの意味が薄れる副作用があるため、採用は要相談。
  - 未着手の大きめ課題は `docs/DECISIONS.md` ADR-006（パフォーマンス フェーズ2）が最優先候補のまま。

---

## 2026-07-27（自動転記の請求書を結合版に戻す＋インボイス番号の確認）

- **依頼**: 自動転記（一括記帳）で上がる請求書を「以前みたいに内容（業務委託実績報告書）まで入ってる版」に変更したい。あわせてインボイス番号（適格請求書登録番号）があれば入れてほしい。

- **調査でわかった構造（重要）**:
  - 自動転記 = [`app/api/admin/invoice-batch-export/route.ts`](../app/api/admin/invoice-batch-export/route.ts)。**導入当初(コミット `0b41e3f`)からずっと「請求書のみ1ページ」**（`renderInvoicePdfBlobFromModel`）だった。
  - 「請求書＋実績報告書」の3ページ版は**別経路** `renderMemberCombinedPdfBlob`（[`lib/member-combined-pdf.ts`](../lib/member-combined-pdf.ts)）。今もメンバー自身のDL／管理者一括ZIPで使用。過去の3ページPDFはこちら経由で作られたもの。
  - **インボイス番号は既に実装済み**: メンバーの `invoice_registration_number`(T+13桁)がDBにあれば、請求書PDFの**「お振込先」ボックス内に「登録番号：T…」**として自動表示（[`lib/invoice-pdf-pdflib.ts:637`](../lib/invoice-pdf-pdflib.ts)）。無ければ非表示（＝なし）。表示位置は今回「現状のまま（お振込先の欄）」でユーザー確認済み。

- **変更**: batch-export の PDF 生成を `renderInvoicePdfBlobFromModel(model)` → `renderMemberCombinedPdfBlob(member, yearMonth, allRecords, allKpiRecords)` に差し替え（import含め2箇所・計5行）。
  - 記帳CSVの数値（`invoiceNo`/`amount` 等）は従来どおり `model` から取得 → **記帳データには影響なし**。PDFの中身だけ3ページ化。
  - インボイス番号は結合版1ページ目=同じ請求書なので挙動不変（登録があれば出る）。

- **検証**: `npx tsc --noEmit` OK ／ `npm run build` OK（両方緑）。

- **反映**: commit `e0fe385` → `git push origin main` 済み。
  - この自動転記は**管理画面から手動実行するAPI**（cronではない）。**次に自動転記を回した時から**3ページ版で出る。

- **申し送り**:
  - もし「番号をヘッダー（会社名・住所付近）に出したい」等になったら pdf-lib のY座標調整が要る（`invoice-pdf-pdflib.ts`、地雷②）。今回は見送り。
  - 結合版は1ページ版より生成が重い。CHUNK_SIZE=1・maxDuration=300s なので1人ずつなら問題ないが、人数が多い月に途中タイムアウトが出たら範囲指定(startIndex/endIndex)で分割実行する運用は従来どおり有効。

## 2026-07-27（続き：結合版PDFの文字化けテスト → 「※」欠字を修正）

- **依頼**: 「一回誰でもいいのでテストしたものがちゃんと文字化けしてないか／内容を確認させて」。自動転記の結合版PDFを実際に生成して目視確認したい。

- **やり方（本番を汚さない検証）**: 本番の自動転記を回すと freee/Drive に記帳されるため実行せず、`renderMemberCombinedPdfBlob` を**サンプルの日本語メンバー（山田花子・住所/振込先/インボイス番号T…あり）＋サンプル打刻/KPI**で単体実行し、PDFを生成 → pypdfium2(=PDFium。Driveプレビューと同エンジン)でPNG化して目視。
  - 一時スクリプト `_test_combined_pdf.mts` を使用（**検証後に削除済み**）。フォントは本番と同じ `fs:lib/pdf-fonts` 経路でフル埋め込みされることも確認。

- **結果**: 請求書ページ・実績報告ページとも日本語はほぼ全て正常。**「お振込先」欄にインボイス番号「登録番号：T…」も正しく表示**。ただし実績報告の注記の先頭「※」だけ**豆腐（□）**になっていた。

- **原因**: 同梱フォント `lib/pdf-fonts/NotoSansJP-Regular/Bold.ttf` は縮小版で **U+203B「※」の字形が無い**（`★●◆■→～` 等も無し。漢字仮名〒円全角アスタ「＊」注はある）。→ `docs/TROUBLESHOOTING.md`「一部の記号だけ豆腐」に切り分け手順を追記。
  - これは経路変更で生じた新規バグではなく、`report-pdf-pdflib.ts` を使う**全ての実績報告PDF（メンバーDL・一括ZIP含む）に元からあった欠字**。

- **修正**: `lib/report-pdf-pdflib.ts:185-189` の注記2行（一般/インターン）の先頭「※」→「＊」(全角アスタ U+FF0A・フォントに字形あり)。意味・幅とも同等でレイアウト不変。再生成PDFで「＊本金額は…」が正常描画されることを目視確認。

- **検証**: `npx tsc --noEmit` OK ／ `npm run build` OK。
- **反映**: commit `15aa1b9` → push 済み。

- **申し送り**:
  - **PDF描画文字列に記号を足すときは、まず同梱フォントに字形があるか確認**（上記TROUBLESHOOTINGのワンライナー）。無い記号（※★●◆■→～等）は豆腐になる。将来ちゃんと「※」を出したいなら、記号を含むフルの NotoSansJP へ差し替えが必要（バンドル増・Lambda tracing 要確認のため要相談）。
  - 検証手法（サンプルデータ→`renderMemberCombinedPdfBlob`→pypdfium2でPNG目視）は再利用可。本番DBに触れずPDF体裁を確認できる。

## 2026-07-27（続き2：打刻ブロック実装＋freee取引先マスタとの突合）

- **依頼**: ①請求書右上の情報（住所・電話等）が未入力の人がいる → 「入力しないと打刻できない」ようにしたい。②freee連動でスムーズに登録するため、freeeの「取引先マスタ」インポートCSVとアプリの契約情報を突合して不足項目を洗い出したい。

- **①打刻ブロック（実装済み・反映済み commit `cb3a467`）**:
  - メンバーの「業務開始」= [`app/page.tsx` `handleStart`](../app/page.tsx) の先頭で、請求書必須項目の未入力を判定し、あれば打刻を止めて `alert` ＋ 入力欄へスクロール誘導（`id="member-billing-profile"` を付与）。
  - 必須項目＝**郵便番号・住所・銀行名・支店名・口座番号・口座名義・電話番号の7つ**（＝本人保存 `handleSaveMemberSelfBankProfile` の既存チェックと同一）。**インボイス登録番号は任意で対象外**。
  - 判定は新設ヘルパー **`getMissingBillingProfileFields`**（module-level）に集約。保存時チェックも同ヘルパーへ置換し、2経路で基準がズレないようにした。
  - スコープは「A＝アプリに今ある項目だけで先にブロック」。freee用の追加項目（下記）は入力欄が無いので今回は必須化していない。
  - 影響: ブロックされるのは打刻する時給制メンバーのみ。インターンは打刻対象外なので無関係。終了(`handleEnd`)は塞いでいない（開始を塞げば実害なし・途中で詰まらせない）。

- **②freee取引先マスタ突合（分析のみ・未実装）**: `~/Downloads/取引先マスタインポートフォーマット.csv`（Shift-JIS・25列）を突合。
  - **既にアプリで取れている**: 名前(通称)/郵便番号/銀行名/支店名/口座種別/口座番号/受取人名(=口座名義)/適格の該当有無(登録番号から導出)/登録番号。
  - **定数でCSV側に埋めれば足りる**（各人から集めなくてよい）: 事業所種別=個人事業主 / 地域=国内 / 締め日=末日 / 支払月=1 / 支払日=15 / 振込手数料負担=当方 / 支払元口座=GMOあおぞらネット銀行 / 使用停止再開=使用する(isActiveから導出)。
  - **アプリに項目自体が無い＝不足**: 銀行番号・支店番号・銀行名カナ・支店名カナ・受取人名カナ・住所の3分割(都道府県/市区町村番地/建物名。今は`address`1項目)。
  - 自動化の見立て: 受取人名カナ→`furigana`から可(要カタカナ整形)。銀行番号・銀行名カナ→銀行マスタ(約1,400)を持てば可。**支店番号・支店名カナ→全支店マスタが巨大で難所**（`zengin-code`等の外部データ導入 or 本人手入力 or freeeが名前補完するなら不要）。
  - **未確認の分かれ目**: freeeが銀行番号/支店番号“そのもの”を必須にしているか、名前(＋カナ)で取り込めるか。ここで作る量が大きく変わる。次にやるならまずこれを確認。

- **テスト検証（本セッション）**: 自動転記の結合版を本番で1人分（伊藤瑛喜・2026-06）実行→2ページ・文字化けなし・金額OKを確認。テスト分は削除（スプレッドシート行はユーザーが削除。Drive PDF(2ページ版)も削除依頼済み）。※2026-06は既処理月のため重複が出る前提で、削除対象＝「新しく作られた2ページ版」で見分けた。

- **検証**: `npx tsc --noEmit` OK ／ `npm run build` OK。

- **申し送り / 次にやるなら**:
  - freee連動の残タスク（スコープB）: 不足項目の入力欄追加（銀行番号・支店番号・カナ・住所分割）→ 取引先マスタCSVエクスポート機能。まず「freeeが番号必須か」を確認してから最小構成を設計する。
  - 打刻ブロックの必須項目を将来Bの項目まで広げる場合は、`getMissingBillingProfileFields` に足すだけで両経路に効く。

---

<!-- 新しいセッションはこの上に追記してください（新しいものが上） -->
