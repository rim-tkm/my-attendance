# CLAUDE.md — MyAttendance 運用ルール（全Claude必読）

このファイルは、このリポジトリで作業する**すべてのAI（Claude等）が最初に読む運用ルール**です。
背景・現状の詳細は **`PROJECT_HANDOVER.md`** に、コードの真実は**実装そのもの**にあります。矛盾したら「実装 > CLAUDE.md > 記憶・推測」の順で信頼すること。

### 📚 ドキュメント一覧（迷ったらここから）
- **`CLAUDE.md`（本ファイル）**: 運用ルール。最初に読む。
- **`PROJECT_HANDOVER.md`**: 引き継ぎ資料。目的・現状・主要ファイル・地雷・優先順位。
- **`docs/ARCHITECTURE.md`**: 設計詳細。データモデル（テーブル/カラム）・データフロー・モジュール境界・`app/page.tsx` 内部地図。
- **`docs/DECISIONS.md`**: 意思決定ログ（ADR-lite）。「なぜこうなっているか」。**新しい判断をしたら追記**。
- **`docs/TROUBLESHOOTING.md`**: 症状→原因→対処。詰まったらまずここ。**新しい解決策は追記**。
- **`docs/COMMANDS.md`**: コマンド早見表（開発・git・認証復旧・Supabase SQL）。
- **`docs/DEPLOY.md`**: デプロイ・Cron・本番環境変数・切り戻し手順。
- **`docs/SESSION_LOG.md`**: 作業ログ（チャット引き継ぎ用・新しいものが上）。**直近に何をしたか／申し送りはここ。チャットを変えた直後は必ず読む。作業が終わったら追記する。**

---

## 0. 絶対に守る3原則

1. **push する前に必ず `npx tsc --noEmit` と `npm run build` を両方通す。** どちらか落ちたら push しない。
2. **作業者は非エンジニア。** 操作場所を明示し、選択肢＋おすすめを示し、1問ずつ確認しながら一歩ずつ進める。勝手に大改修しない。
3. **破壊的・不可逆な操作（メンバー無効化・削除、本番DB変更、外部送信）は必ず事前確認**。実装にも確認ダイアログを入れる。

---

## 1. プロジェクト概要

**MyAttendance（業務委託管理アプリ）** — 株式会社RIMの業務委託・インターン生の**稼働実績（打刻）とKPI（営業実績）を蓄積し、生産性を可視化・管理するプラットフォーム**。請求書PDFは蓄積データから出す副産物であり、目的ではない。
本番: https://my-attendance-rho.vercel.app/ ／ デプロイ: `git push origin main` で Vercel 自動デプロイ。

- 一般メンバー（時給制）: 打刻＋日次KPI入力。時給×稼働時間で請求。
- インターン（成果報酬型）: 打刻対象外。管理者が商談確定数を入力、単価×件数で請求。

詳細は `PROJECT_HANDOVER.md` を参照。

---

## 2. 技術スタック

- **Next.js 14.2（App Router）** / **React 18** / **TypeScript 5** / **Tailwind CSS**
- **Supabase**（`@supabase/supabase-js` を直接使用。**ORM無し**。ブラウザは anon key で直クエリ）
- **NextAuth**（Credentials）＋独自 `loginUser`
- **pdf-lib**（請求書・実績レポートPDF、座標指定・フォント埋め込み）
- **Slack Incoming Webhook**（通知）
- **Vercel Cron**（`vercel.json`）
- 外部: Google Forms + GAS + Google Docs + Gmail API（登録・契約書）
- **テストフレームワークは無し**（jest/vitest/playwright 等なし）。品質担保は `tsc` + `build` + 手動確認。

---

## 3. ディレクトリ構成（要点）

```
app/
├── page.tsx          ★最重要・約10,700行。DashboardPage(親/メンバー画面) に AdminDashboard(管理画面) を内包
├── layout.tsx        メタデータ・body
├── icon.svg          ファビコン（水色の「業」・Next.jsが自動でfavicon化）
├── globals.css
├── login/            ログイン画面
├── admin/            /admin, /admin/members/archived
├── actions/          Server Actions（Slack通知系）
└── api/              records/ schedule/ users/ members/ external/ webhooks/
                      cron/ slack-daily/ slack-report/ slack-ranking/ admin/ ...

lib/                  ★ロジックとデータはここに集約
├── attendance.ts     ★型（WorkRecord/KpiRecord/Member/Shift）＋全コアロジック
├── supabase-data.ts  ★DB読み書き（loadRecords/saveRecords/updateMember/loadMembers 等）
├── admin-dashboard-metrics.ts  ダッシュボード集計
├── roi-analysis.ts   ROI/生産価値の単価定数と計算
├── invoice-*.ts / report-pdf-*.ts / member-combined-pdf.ts  請求書・実績PDF
├── slack-*.ts        Slack通知各種
├── supabase.ts       getSupabase()
├── auth.ts           NextAuth authOptions
└── store.ts          ⚠ローカルFS実装（本番未使用の可能性・棚卸し対象）

supabase-schema.sql / supabase-migration-*.sql   スキーマ定義と列追加履歴
vercel.json           Cron定義
PROJECT_HANDOVER.md   引き継ぎ資料（背景・判断理由・地雷の詳細）
```

---

## 4. コーディング規約

- **既存コードのスタイルに合わせる**（コメント密度・命名・イディオム）。周囲のコードと読み味が揃うように書く。
- インデントは既存に合わせる（2スペース）。**`app/page.tsx` はJSXの入れ子が深い**ので、open/close タグの対応を必ず確認。
- スタイルは **Tailwind ユーティリティクラス**。既存の色・角丸・余白トークンを踏襲（例: `rounded-lg border border-slate-200 bg-white p-5 shadow-sm`）。
- 数値表示は用途に応じて丸める（件数=整数、率=小数、金額=`toLocaleString("ja-JP")`）。
- **率(%)を小数第2位で出す時は `safeRatePercent`（1桁丸め）を使わず、丸めない `ratePercent2`（`Math.round(x*10000)/100`）を使う。** 表示だけ `.toFixed(2)` にしても末尾ゼロになるだけで無意味。
- 破壊的操作は `window.confirm` で対象を明示してから実行。トーストやalertで結果を返す。
- 折りたたみUIは可能なら状態を持たない `<details>/<summary>`（低リスク）。
- アイコンは**依存を増やさずインラインSVG**（既存 `AdminNavIcon` を参照）。

---

## 5. 命名規則

- 変数・関数: **camelCase**（`dormantMembers`, `handleBulkDeactivateDormant`）。
- 型・コンポーネント: **PascalCase**（`WorkRecord`, `AdminDashboard`, `AdminKpiProxyModal`）。
- 定数: **UPPER_SNAKE_CASE**（`ROI_YEN_PER_FOLLOWUP`, `ATTENDANCE_SELECT_COLUMNS`）。
- DBカラムは **snake_case**（`is_active`, `first_work_date`）。`to*` マッピング関数で camelCase の型へ変換する（`toMember`, `toWorkRecord`, `toKpiRecord`）。
- 管理画面のセクションは `AdminSection` 型のユニオン文字列（`"dashboard" | "attendance" | ...`）。新セクション追加時は「型 → `navItems` → `AdminNavIcon` → `{adminSection === "xxx" && (...)}` ブロック」の4点セットを揃える。
- 日付は `YYYY-MM-DD`（JST基準）。JST判定は `isWeekendYmd` / `getTodayJstDateString` 等の既存ヘルパーを使う。

---

## 6. 使用ライブラリ（追加時の方針）

- 既存の主要依存: `next`, `react`, `@supabase/supabase-js`, `next-auth`, `pdf-lib`, `bcryptjs`, `tailwindcss`。
- **新規ライブラリの追加は原則避ける**（バンドル増・保守負担）。特にアイコン/UIライブラリは入れない（インラインSVG・Tailwindで対応）。どうしても必要なら理由をユーザーに説明し合意を得てから。

---

## 7. 実装方針

1. **要件確認 → 設計（選択肢＋おすすめ） → 実装 → 検証（tsc+build） → commit&push** の順。
2. 既存の仕組みを**最大限再利用**する（例: メンバー無効化は `updateMember(id,{isActive:false})`、KPI保存は `buildGeneralKpiUpsert`）。二重実装でロジックがズレるのを避ける。
3. 管理画面の追加は「ガワ（レイアウト）」で完結させ、中身のデータ経路は既存に乗せる。
4. パフォーマンスに関わる取得範囲は安易に変えない（§10地雷①）。
5. 大きめ機能では `app/page.tsx` の肥大化に注意。可能ならコンポーネント抽出も検討。

---

## 8. 禁止事項

- ❌ `tsc`/`build` を通さずに push する。
- ❌ ユーザーの明示的許可なく**本番Supabaseを直接変更/直接クエリ**する（ガードで止まることもある）。件数確認等も勝手に本番を叩かない。
- ❌ 新規ライブラリを無断で追加する。
- ❌ `Set` をスプレッド展開する（`[...set]`）→ **ビルドエラー**。必ず `Array.from(set)`。
- ❌ 請求書PDF（pdf-lib）のY座標計算を、前後の影響を確認せずに変更する。
- ❌ Googleドキュメント契約書テンプレでタブ機能を使う（バグ再発）。
- ❌ `safeRatePercent` の戻りを `.toFixed(2)` して「2桁精度が出た」と勘違いする。
- ❌ 破壊的操作を確認なしで実行する / 「完了した」と証拠（コマンド出力）なしに断言する。
- ❌ 巨大ファイルを一括再生成する。必要箇所を Edit で最小変更する。

---

## 9. バグ修正時のルール

1. **再現条件と原因を先に特定**してから直す（憶測で当てない）。該当のデータフロー（`app/page.tsx` の該当セクション → `lib/*` のロジック）を追う。
2. 修正は最小差分。関係ない箇所を巻き込まない。
3. 既存の同種処理と**同じ経路・同じ規則**で直す（独自実装を増やさない）。
4. 直したら `tsc` + `build` で検証し、可能なら実挙動（画面 or Slack出力）も確認。
5. 「なぜ壊れていたか／なぜこの直し方か」をコミットメッセージに残す。

---

## 10. このプロジェクト特有の注意点（地雷・要約）

`PROJECT_HANDOVER.md §8` に詳細。要点:
- **① 全件ロードの重さ**: `loadRecords/loadShifts/loadKpi` は全履歴を取得。データ増で重い。取得範囲を狭めると請求・履歴系画面が壊れる。
- **② pdf-libのY座標**: 座標直書き＋条件付き行push。レイアウト変更は慎重に。
- **③ Googleドキュメントのタブ機能**: 使うと致命バグ再発。
- **④ `Set` スプレッド不可** → `Array.from`。
- **⑤ `safeRatePercent` は1桁丸め** → 2桁は `ratePercent2`。
- **⑥ セッションはリロードで消える**（`currentUserId` はメモリstate）。
- **⑦ 土日稼働は拒否＆Slackも土日スキップ方針**。
- **⑧ `app/page.tsx` は巨大**。編集後は必ずビルドで整合確認。
- **⑨ 本番DB直クエリはガードされる**ことがある。

---

## 11. テストの実行方法

- **自動テストは存在しない。** 品質ゲートは以下：
  ```bash
  npx tsc --noEmit    # 型チェック（必須）
  npm run build       # 本番ビルド。JSX不整合もここで落ちる（必須）
  npm run lint        # 任意（next lint）
  ```
- 加えて **手動確認**（`npm run dev` → 該当画面を操作、またはSlack出力を確認）。破壊的機能は少数データで挙動確認してから本番運用を案内する。

---

## 12. デプロイ方法

- **`main` への push = 本番デプロイ**（Vercel 自動）。作業ブランチは基本使わない運用。
- 手順（作業者は非エンジニアなので、コマンドはこちらが提示・実行する）:
  ```bash
  git add -A && git commit -m "変更内容の説明" && git push origin main
  ```
- 反映確認は数分後。タブ/画面に出ない時はブラウザキャッシュ → `Shift+再読み込み`。
- **Supabaseスキーマ変更が要る場合**は、Supabase管理画面の「SQL Editor」で `ALTER TABLE ...` を実行してもらう手順もセットで提示する。
- **git認証の注意**: `gh` のアクティブアカウントが権限の無いアカウントに切り替わり push が403になる事例あり。`gh auth status` で `rim-tkm` がアクティブか確認。違えば `gh auth login`（rim-tkmで）→ `gh auth setup-git` → `git push`。gh のパスは `/Users/takuma/.local/bin/gh`。

---

## 13. 開発時によく使うコマンド

```bash
npm run dev                 # ローカル開発（http://localhost:3000）
npx tsc --noEmit            # 型チェック
npm run build               # 本番ビルド
npm run lint                # Lint（任意）
git add -A && git commit -m "..." && git push origin main   # 本番反映
git log --oneline -10       # 直近履歴の確認
git status --short          # 変更確認
```

---

## 14. 環境変数について

- `.env.local` に設定（テンプレは `.env.example`）。**シークレットはコミットしない**。
- 主な変数:
  - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`（必須。未設定だとデータ取得不可）
  - `AUTH_SECRET`（または `NEXTAUTH_SECRET`）、本番は `NEXTAUTH_URL` も必須
  - `CRON_SECRET`（Vercel Cron の Bearer 認証）
  - `SLACK_WEBHOOK_URL`（全通知のデフォルト送信先）＋用途別 `SLACK_WEBHOOK_*_URL`（省略時はデフォルトを使用）
  - 各種しきい値: `MISSED_PUNCH_START_GRACE_MINUTES`, `KPI_MISSING_AFTER_PUNCH_MINUTES` 等
- 登録webhookの共有シークレットはコード側の定数（`rim_secret_2026`）。初期パスワードは `"12345"`。
- 詳細は `.env.example` のコメントが最も正確。参照すること。

---

## 15. PR作成時のルール

- 通常はこのプロジェクトは **`main` 直push運用**。PRは必須ではない。
- **PRを作る場合**（ユーザーが希望した時など）:
  - 事前に `main` にいるなら**作業ブランチを切ってから**作業する。
  - `gh` CLI を使う。PR本文の末尾に必ず次を付ける:
    ```
    🤖 Generated with [Claude Code](https://claude.com/claude-code)
    ```
  - コミットメッセージ末尾には必ず:
    ```
    Co-Authored-By: Claude <noreply@anthropic.com>
    ```
  - PR説明には「目的・変更点・検証内容（tsc/build結果）・影響範囲」を書く。

---

## 16. Claudeが作業開始時に最初に確認すべきこと

1. **`CLAUDE.md`（本ファイル）と `PROJECT_HANDOVER.md`、`docs/SESSION_LOG.md`（直近の作業と申し送り）を読む。**
2. `git status --short` と `git log --oneline -5` で現状（未コミット/最新）を確認。
3. `app/page.tsx` の `type AdminSection`（≈L700）と `navItems`（`AdminDashboard` 内）を見て、管理画面の全機能を把握。
4. 触る領域に応じて `lib/attendance.ts`（型・ロジック）と `lib/supabase-data.ts`（データ経路）の該当箇所を読む。
5. ユーザーの依頼を **1問ずつ**明確化（対象・基準・表示場所・破壊的か等）。曖昧なまま実装しない。

---

## 17. Claudeが作業終了時に必ず行うこと

1. **`npx tsc --noEmit` と `npm run build` を通す**（両方緑を確認）。落ちたら直すまで完了扱いにしない。
2. **commit & push**（`git add -A && git commit -m "..." && git push origin main`）。コミットメッセージは「何を・なぜ」を日本語で簡潔に。
3. ユーザーに **変更点・確認方法（どの画面をどう見るか）・注意点** を伝える。破壊的機能は「まず少数で試す」ことを案内。
4. スキーマ変更をしたなら **Supabase SQL の実行手順**もセットで渡す。
5. 大きな設計判断や新たな地雷を見つけたら **`PROJECT_HANDOVER.md` を更新**する。設計判断は **`docs/DECISIONS.md` に ADR を追記**する。
6. **`docs/SESSION_LOG.md` の先頭に今回の作業を追記**する（依頼 / 変更箇所 / 検証 / 反映コミット / 申し送り）。チャットを変えても次のAIが続きから入れるようにするため。
7. 「完了した」と言うときは、**検証コマンドの結果（tsc/buildの成功）を根拠**にする。証拠なしに成功を断言しない。
