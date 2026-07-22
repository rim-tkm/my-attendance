# PROJECT_HANDOVER.md — MyAttendance 引き継ぎ資料（AI向け）

> このファイルは「次に入るAI（Claude等）が5分で現状を把握して開発を続けられる」ことを目的にした引き継ぎ資料です。README ではありません。
> 対象アプリ: **MyAttendance（業務委託管理アプリ）** / 本番: https://my-attendance-rho.vercel.app/
> 最終更新の起点コミット: `b203efe`（土日Slackスキップ）。作業者は非エンジニア（株式会社RIM）。**壁打ち相手として、操作場所を明示し、選択肢＋おすすめを示しながら一歩ずつ進める**こと。

---

## 0. 最速で掴むための要点（まずここだけ読む）

- コアは巨大な1ファイル **`app/page.tsx`（約10,700行, "use client"）**。メンバー画面 `DashboardPage`（default export, ≈L8937〜）が親で、その中に管理者画面 `AdminDashboard`（≈L1420〜、`type AdminSection` は L700）を内包している。
- データは **Supabase**（`supabase-js` を直接呼ぶ。ORM無し）。ロジックと型は **`lib/attendance.ts`**、DBアクセスは **`lib/supabase-data.ts`** に集約。
- デプロイは **`git push origin main` → Vercel 自動デプロイ**。プレビューは `npm run dev`。
- 変更後は必ず **`npx tsc --noEmit` と `npm run build`** を通してから push する（このプロジェクトの品質ゲート）。
- **地雷が複数ある（§8必読）**。特に「全件ロードの重さ」「pdf-libのY座標」「Googleドキュメントのタブ機能」「`Set`のスプレッド不可」。

---

## 1. プロジェクトの目的

**単なる請求書発行ツールではない。** 業務委託メンバー・インターン生の
- **稼働実績（WorkRecord / attendance）＝ 打刻データ**
- **KPI（KpiRecord / kpis）＝ コール数・アポ数などの営業実績**

を日次で蓄積し、**生産性を可視化・管理するプラットフォーム**である。

- **コア価値** = WorkRecord / KpiRecord の蓄積 → ダッシュボード・ROI・休眠管理などの可視化。
- **請求書PDF** = 蓄積データから月末に出力する「副産物」の一つ（重要だが目的ではない）。

利用者は2種類:
- **一般メンバー（時給制）**: 打刻（稼働開始/終了）＋日次KPI入力。時給 × 稼働時間で請求。
- **インターン（成果報酬型）**: 打刻対象外。管理者が「商談確定数（confirmed_dm / confirmed_non_dm）」を入力し、単価 × 件数で請求。

---

## 2. 現在の実装状況

**本番稼働中で安定**。直近セッションでUI刷新・機能追加を多数実施済み（§5）。既知の技術的負債は「全件ロードによる重さ（§7フェーズ2）」と「app/page.tsx の肥大化」。破壊的な未解決バグは無い。

- git は `main` 一本運用。`origin/main` = 本番。作業ブランチは基本使っていない。
- 作業者は非エンジニアなので、**コミット・pushはこちら（AI）が代行**し、ターミナルコマンドを明示して渡す運用。

---

## 3. アーキテクチャ

| レイヤー | 技術 | 役割 |
|---|---|---|
| フロント | Next.js 14.2（App Router）, React 18, TypeScript 5, Tailwind CSS | 管理画面・メンバー画面（ほぼ全部 `app/page.tsx`） |
| DB | Supabase（`supabase-js` 直呼び。ブラウザは anon key で直接クエリ） | `users` / `attendance` / `shifts` / `kpis` / `open_records` ほか |
| 認証 | NextAuth（Credentials） + 独自の `loginUser`（users テーブル照合, bcrypt） | セッションはリロードで消える設計（毎回ログイン） |
| 外部連携 | Google Forms + GAS + Google Docs + Gmail API | メンバー登録フロー・契約書PDF自動送付 |
| 請求書PDF | **pdf-lib**（ブラウザ/サーバで座標指定・フォント埋め込み） | 請求書＋実績レポートを1PDFに結合 |
| 通知 | Slack Incoming Webhook | 日次レポート・KPIアラート・ランキング・シフト催促 |
| Cron | Vercel Cron（`vercel.json`） | Slack日次・打刻漏れ・シフトリマインダー等 |
| デプロイ | Vercel（`git push origin main` で自動） | 本番ホスティング |

### データフロー3段階
1. **入口**: Googleフォーム → GAS → `POST /api/webhooks/google-form-register`（`Bearer rim_secret_2026`）→ `registerMemberFromGoogleForm()` → `users` に INSERT → 管理番号を採番して GAS に返す → GAS が契約書PDFを Gmail 送付。初期パスワードは `"12345"`。
2. **蓄積**: `users` テーブル（メンバー）＋ `attendance`（打刻）＋ `kpis`（KPI）＋ `shifts`（稼働予定）＋ `open_records`（開きっぱなし打刻）。
3. **出口**: pdf-lib で請求書＋実績レポートPDF。Slack通知。CSV出力。

### 重要な認証情報の場所
- `.env.local` に `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`、`CRON_SECRET`、`SLACK_WEBHOOK_*` 等。
- **本番DBへの直接クエリはガードで止められることがある**（Claudeの実行環境）。件数確認などは基本 `.env.local` 経由の一時スクリプトか、ユーザー許可が要る。

---

## 4. 主要ファイルの役割

### アプリ本体
- **`app/page.tsx`（約10,700行・最重要）**
  - `DashboardPage`（default export, 親）: ログイン、`isAdminMode` トグル、メンバー画面（活動記録/稼働予定/KPI入力タブ）、右下フローティングの「管理者⇄メンバー切替＋ログアウト」、そして `AdminDashboard` を内包。
  - `AdminDashboard`（props受け取り）: 管理者画面の全セクション。**左サイドバーUI**（`adminSection` state でセクション切替）。各セクションは `{adminSection === "xxx" && (...)}` ブロック。
  - `AdminKpiProxyModal`: 管理者が任意メンバー・任意日のKPIを代理入力するモーダル。
  - `AdminNavIcon`: サイドバー用インラインSVGアイコン（依存無し）。
  - `buildGeneralKpiUpsert`: KPI保存の rec/next 組み立て共通関数。
- **`app/layout.tsx`**: メタデータ・body。ファビコンは **`app/icon.svg`**（水色の「業」。Next.jsが自動でfavicon化）。

### ロジック / データ（lib/）
- **`lib/attendance.ts`（最重要）**: `WorkRecord` / `KpiRecord` / `Member` / `Shift` の型定義と全コアロジック。`getKpiTotalsFromRecords`, `safeRatePercent`, `isWeekendYmd`, `getRecordsForUser` など。
- **`lib/supabase-data.ts`（最重要）**: DBの読み書き。`loadRecords` / `loadShifts` / `loadKpi`（**全件ページング取得**）, `loadMembers`, `saveRecords`, `updateMember`, `allocateNextInvoiceManagementNumber` 等。SELECT列は `ATTENDANCE_SELECT_COLUMNS` 等で必要列に限定済み。
- **`lib/admin-dashboard-metrics.ts`**: ダッシュボードの集計（`computeGeneralDashboardMetrics` 等）。率は **`ratePercent2`（小数第2位）** を使用。
- **`lib/roi-analysis.ts`**: ROI/生産価値の単価定数と計算。`ROI_YEN_PER_CALL=10` / `ROI_YEN_PER_FOLLOWUP=100` / `ROI_YEN_PER_NON_DECISION_APO=200` / `ROI_YEN_PER_DECISION_APO=10000`。`computeValueCreatedYenFromTotals()` が「生産価値（料金）合計」。
- **`lib/invoice-pdf-pdflib.ts` / `invoice-html.ts` / `member-combined-pdf.ts` / `report-pdf-*.ts`**: 請求書・実績レポートPDF生成（pdf-lib, 座標指定・フォント埋め込み）。**地雷（§8）**。
- **`lib/invoice-intern.ts`**: インターンの成果報酬計算（単価適用）。
- **`lib/slack-*.ts`**: Slack通知各種。`slack-daily.ts`（朝の稼働予定・土日スキップ済）, `slack-report.ts`（深夜0時の前日実績・**土日スキップ追加済**）, `slack-ranking.ts`, `slack-manual-report.ts` 等。
- **`lib/store.ts`（注意・実質未使用の可能性）**: ローカルファイルシステム保存の実装。**Vercelでは永続化されない**。本番のWorkRecord経路は `supabase-data.ts`。`store.ts` は要棚卸し（消してよいか未確認）。
- `lib/member-management-number.ts`: 管理番号は **単純な連番（max+1）**。YYYYMM形式ではない（＝登録日は復元不可、順序のみ復元可）。

### API（app/api/）
- `records/`, `schedule/`, `users/`, `members/[id]/`: CRUD。
- `webhooks/google-form-register/`: メンバー登録webhook。
- `external/`: 外部（GAS）からの登録・口座情報更新。
- `cron/`（missed-punch-start, shift-reminder, remind-unsubmitted, kpi-missing-after-punch, weekly-schedule-report）+ `slack-daily/` + `slack-report/`: 定期実行。
- `admin/member-update/`, `admin/schedule-grid/`。

### スキーマ
- `supabase-schema.sql`（users/attendance/shifts/kpis/open_records の定義）＋ `supabase-migration-*.sql`（列追加の履歴）。**usersに `created_at` は無い**。

---

## 5. 実装済み機能（直近セッションで追加したもの中心）

- **ファビコン**: `app/icon.svg`（水色の「業」）。
- **サイドバーUI刷新（管理者画面のみ）**: 横タブ→左サイドバー。紺ヘッダー廃止・全幅化。スマホはハンバーガーでドロワー開閉。メンバー画面は従来のまま。
- **管理者は最初から管理者画面でログイン**（`handleLogin` で `isAdminMode=true`）。
- **KPI率の小数第2位表示**: 業務委託KPIカスタム集計の有効率/KC率/アポ率、契約形態別パフォーマンスのKC率/アポ率。※`safeRatePercent`は1桁丸めなので **`ratePercent2`（丸めず2桁）** を使う。
- **予実乖離アーカイブの行内KPI入力**: 一番右に6項目のインライン入力＋保存（`buildGeneralKpiUpsert`）。
- **ダッシュボードの折りたたみ**: 「本日の稼働予定」「インターン成果確定」を `<details>` で既定クローズ。
- **生産価値（合計）カード**: カスタム集計に追加（`computeValueCreatedYenFromTotals`）。
- **「時間あたりアポ率」カード削除**（カスタム集計）。
- **休眠メンバー機能（サイドバー新項目 `dormant`）**:
  - メンバー数サマリー4カード（総登録[退会含む]／稼働[直近30日打刻]／休眠[3ヶ月]／未稼働[打刻ゼロ]）。
  - **休眠（過去に稼働歴あり・3ヶ月止まり）** と **未稼働（一度も打刻なし・新人含む）** を分離。新人の誤検出を防ぐため。
  - 両テーブルに**チェックボックス＋一括無効化**（`updateMember(id,{isActive:false})` を選択分ループ、確認ダイアログで氏名明示、アーカイブから復元可）。未稼働は「登録が新しい順＝管理番号降順」で表示＋新人混在の注意書き。
  - サイドバーから「日別実績（予定・実績）」メニューは削除済み（コードは残置・到達不能）。
- **パフォーマンス改善フェーズ1**:
  - 初回 `hydrate` の全件二重ロード解消（`runAutoComplete` を「読み込み済みデータ受け取り＋変更有無を返す」形にし、変更時のみ再ロード）。
  - 全件取得を `select("*")` → 必要列のみ（`ATTENDANCE_SELECT_COLUMNS` 等）。
- **土日のSlack日次結果レポートをスキップ**（`slack-report.ts` の対象日が土日ならスキップ。cronはスキップ、手動POST `test:true` は送信可）。

（これ以前からの既存機能: 登録webhook、請求書PDF、インターン/通常の請求分岐、土日稼働拒否、Slack各種通知、cron群、予実乖離アーカイブ、生産性CSV/ROI 等）

---

## 6. 未実装機能 / 積み残し

- **パフォーマンス フェーズ2（未着手・要設計）**:
  - **A**: 通常画面のロードを直近N日（例90日）に限定し、請求・全履歴が要る処理だけ全件ロード。`allRecords` が全画面共有なので切り分け注意。
  - **D**: ダッシュボード集計をサーバー側 RPC/API に寄せる（生データをブラウザに流さない）。
  - **E**: `app/page.tsx` の分割（First Load JS が約370kB）。
- **`users.created_at`（登録日）カラム**: 現状無し。未稼働の「本当の新人 vs 昔登録して未稼働」を自動判別できない。追加しても既存メンバーは全員「今登録」扱いになり、有効なのは追加後の新規のみ（要ユーザー判断）。
- **`lib/store.ts` の棚卸し**（消してよいか未確認）。
- 「日別実績」セクションのデッドコード削除（メニューは削除済だがJSX/useMemoは残置）。

---

## 7. 今後の優先順位

1. **（要望ベース）ユーザーの次の依頼に対応**。非エンジニアなので、まず要件を1問ずつ確認→おすすめ提示→実装、の順。
2. **パフォーマンス フェーズ2-A**（表示ロードの期間制限）: 体感の重さが再発したら最優先。実装前に「どの画面が過去どこまで必要か」を必ず設計（請求/生産性CSV/予実乖離アーカイブ/カスタム集計は過去参照が要る）。
3. **`app/page.tsx` の分割**（保守性）: 大きくなりすぎ。セクション単位でコンポーネント抽出。
4. デッドコード/`store.ts` の掃除。

> 詳細メモ: Claudeのメモリに `perf-full-table-loading.md`（重さの根本原因と段階プラン）あり。

---

## 8. 注意点（地雷）— 触る前に必読

- **地雷① 全件ロードの重さ**: `loadRecords/loadShifts/loadKpi` は attendance/shifts/kpis を**全履歴**取得する。データ増で重くなる構造。WorkRecord/KPI周りを触る前にこれを意識。安易に取得範囲を狭めると請求・履歴系画面が壊れる。
- **地雷② pdf-libのY座標**: 請求書PDFは座標直書き＋条件付きの行push（例: 登録番号行）。レイアウト変更時は前後のY座標計算に細心の注意。
- **地雷③ Googleドキュメントのタブ機能**: 契約書テンプレ（GAS側）でタブ機能を使うと「タブ1」文字混入＋余白ページの致命バグが再発。テンプレIDは固定（一般用/インターン用/保存フォルダ）。
- **地雷④ `Set` のスプレッド不可**: `[...someSet]` は tsconfig の設定で **ビルドエラー**になる。**`Array.from(someSet)`** を使う（実際にこのセッションで踏んだ）。
- **地雷⑤ `safeRatePercent` は小数第1位で丸める**: 2桁精度で出したい所は `ratePercent2`（丸めず `Math.round(x*10000)/100`）を使う。既存に `ratePercent2` がローカル定義で複数ある。
- **地雷⑥ セッションはリロードで消える**: `currentUserId` はメモリ state。リロードすると再ログイン。認証系を変える時は前提にする。
- **地雷⑦ 土日稼働は拒否**: `isWeekendYmdJst` によるJST判定で土日の稼働記録保存は403。Slack通知も土日スキップ方針。
- **地雷⑧ 巨大ファイル編集**: `app/page.tsx` はJSXの入れ子が深い。open/closeタグの対応を必ず確認し、編集後は `npx tsc --noEmit` + `npm run build` で検証（不整合はビルドで落ちる）。
- **地雷⑨ 本番DB直クエリはガードされることがある**: 件数確認等は勝手に本番を叩かない。必要ならユーザーに許可を取る。

---

## 9. 設計上の判断理由（なぜそうしたか）

- **休眠を「休眠」と「未稼働」に分離した理由**: `users` に登録日が無く、新人かどうかを日付判定できない。唯一確実な軸が「過去に打刻歴があるか」。稼働歴があれば新人ではない＝休眠、無ければ新人 or 放置＝未稼働、と切り分けた。未稼働の一括無効化は新人混在リスクがあるため注意書き＋管理番号降順表示で緩和。
- **未稼働を管理番号降順にした理由**: 管理番号は登録時の連番（max+1）＝大きいほど最近登録＝新人の可能性が高い。日付が無い中での最良の代理指標。
- **一括無効化を `updateMember(isActive:false)` の単純ループにした理由**: 既存の単体無効化と完全に同じ経路で安全・可逆（アーカイブ復元可）。破壊的なので確認ダイアログ必須。
- **パフォーマンスをフェーズ分けした理由**: フェーズ1（二重ロード解消・列限定）は「クライアントが受け取るデータの中身を変えない」低リスク改善。フェーズ2（期間制限・サーバー集計）は履歴系画面の動作確認が要るため別途設計にした。
- **KPI率を2桁にする時、表示だけ `.toFixed(2)` にしなかった理由**: 元計算が1桁丸めのため末尾ゼロになるだけ。丸めずに再計算する必要があった。
- **サイドバー化が低リスクだった理由**: セクション切替は既に `adminSection` state で管理されており、横タブ→サイドバーは「ガワ（レイアウト）」の差し替えで済んだ。中身のロジックは不変。
- **Slack土日スキップを「対象日ベース」にした理由**: 既存 `slack-daily` と同じ方式で統一。金曜実績（土曜0時着）は実データなので送る、土日実績（＝空）は送らない、が自然。

---

## 10. よく使うコマンド

```bash
# ローカル開発サーバー
npm run dev            # http://localhost:3000

# 品質ゲート（変更後は必ず両方通す）
npx tsc --noEmit       # 型チェック
npm run build          # 本番ビルド（JSXの不整合もここで落ちる）

# 本番反映（= Vercel 自動デプロイ）
git add -A && git commit -m "変更内容" && git push origin main
```

- **Supabaseスキーマ変更が要るとき**: 左メニュー「SQL Editor」で `ALTER TABLE ...` を実行してもらう。手順もセットで提示する。
- **確認のコツ**: デプロイ後タブに反映されない時はブラウザキャッシュ。`Shift+再読み込み`。
- **git認証の注意**: 過去に `gh` のアクティブアカウントが権限の無いアカウントに切り替わり push が403になった事例あり。`gh auth status` で `rim-tkm` がアクティブか確認。違えば `gh auth login`（rim-tkmで）→`gh auth setup-git`→`git push`。gh は `/Users/takuma/.local/bin/gh`。

---

## 11. 次にClaudeがやるべきこと

1. **まずこのファイルと `app/page.tsx` の `AdminDashboard` 冒頭〜`navItems`（サイドバー定義）を読む**。`adminSection` の値一覧（`type AdminSection`）を見れば管理画面の全機能が分かる。
2. `lib/attendance.ts`（型・コアロジック）と `lib/supabase-data.ts`（データ経路）に目を通す。
3. ユーザー（非エンジニア）から依頼が来たら、**1問ずつ要件確認 → 選択肢＋おすすめ提示 → 実装 → `tsc`&`build` → commit&push** の順で進める。破壊的操作は確認ダイアログ／ユーザー確認を挟む。
4. パフォーマンスの重さが再燃したら、フェーズ2-A（表示ロードの期間制限）を**設計してから**着手（履歴系画面の切り分け必須）。
5. 大きめの機能追加時は `app/page.tsx` の肥大化に注意。可能ならセクションを別コンポーネントへ抽出しつつ進める。

---

### 付録: 管理画面のセクション（`AdminSection`）
`dashboard`（ダッシュボード） / `attendance`（稼働状況） / `shift`（稼働予定管理） / `kpi`（業務委託KPI） / `planActualGap`（予実乖離アーカイブ） / `dormant`（休眠メンバー） / `roi`（生産性分析ROI） / `productivityExport`（生産性CSV） / `invoiceBatchExport`（請求書一括記帳） / `settings`（管理設定） / `dailyActual`（※メニュー削除済・到達不能）
