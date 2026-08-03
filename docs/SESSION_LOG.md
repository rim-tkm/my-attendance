# SESSION_LOG — 作業ログ（チャット引き継ぎ用）

> **チャット（AIセッション）をまたぐ時の引き継ぎメモ。新しいものを上に追記する。**
> 目的: 次に入るAIが「直近で何をしたか／今どういう状態か／次に何をすべきか」を1分で把握できるようにする。
> ルール: 1セッション＝1ブロック。フォーマットは「日付 / 依頼 / 変更 / 検証 / 反映 / 申し送り」。過去分は消さない。
> ※ 設計判断そのものは `docs/DECISIONS.md`（ADR）に、恒久的な地雷は `PROJECT_HANDOVER.md §8` に書く。ここは「時系列の作業記録」。

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
