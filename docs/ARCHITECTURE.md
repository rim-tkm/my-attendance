# ARCHITECTURE — MyAttendance 設計詳細

> このドキュメントは「システムがどう組み立てられているか」を、次に入るAIが構造から理解できるようにまとめたもの。
> ルールは `CLAUDE.md`、背景と判断理由は `PROJECT_HANDOVER.md`、意思決定ログは `docs/DECISIONS.md` を参照。

---

## 1. 全体像

```
[ブラウザ / React (app/page.tsx, "use client")]
   │  supabase-js（anon key で直接クエリ）           NextAuth セッション
   │  lib/supabase-data.ts 経由で読み書き            (Credentials)
   ▼
[Supabase Postgres]  users / attendance / shifts / kpis / open_records / 各種通知フラグ
   ▲
   │  Vercel Cron（vercel.json）→ /api/cron/*, /api/slack-daily, /api/slack-report
   │  Server（Route Handlers / Server Actions）
   ▼
[Slack Webhook]（通知）   [pdf-lib]（請求書PDF）   [GAS/Googleフォーム/Docs/Gmail]（登録・契約書）
```

- **描画も集計も基本ブラウザ側**。`app/page.tsx` が全データ（`allRecords/allShifts/allKpiRecords/members`）を state に持ち、`useMemo` で集計してセクションを描画する。
- サーバー側（API/Server Actions）は主に **Slack通知・Cron・PDF生成・外部webhook** を担当。
- **重要な帰結**: クライアントが全履歴をロードして計算する構造。データ増で重くなる（→ `PROJECT_HANDOVER.md §7` パフォーマンス）。

---

## 2. データモデル（Supabase / supabase-schema.sql）

### users（メンバー）— `Member`
| カラム | 型 | 備考 |
|---|---|---|
| id | UUID | PK |
| name / furigana | TEXT | |
| login_account / password | TEXT | password は bcrypt ハッシュ。初期値は `"12345"` |
| hourly_rate | INTEGER | 既定 1400。インターンは 0 |
| zip_code/address/bank_name/branch_name/account_type/account_number/account_holder | TEXT | 口座情報 |
| invoice_number | TEXT | **請求管理番号＝単純連番(max+1)**。登録日ではない |
| invoice_registration_number | TEXT | 適格請求書番号（T+13桁、なければ空） |
| phone_number | TEXT | |
| is_active | BOOLEAN | false = 論理削除（一覧非表示・ログイン不可）。**未設定は true 扱い** |
| first_work_date | DATE | 初回稼働日。未稼働は null |
| can_work_morning | BOOLEAN | false は 14:00 以降のみ選択可（新人制限） |
| is_intern | BOOLEAN | true = 成果報酬型（時給請求 0） |
| intern_rate_decision_maker_apps / intern_rate_non_decision_maker_apps | INTEGER | インターン単価 |
| member_category | TEXT | 既定 'general' |
| ※ **created_at は無い**（登録日を復元できない。§DECISIONS 参照） | | |

### attendance（打刻・完了した稼働）— `WorkRecord`
`id, user_id, start_raw, start_rounded, end_raw, end_rounded(TIMESTAMPTZ), duration_minutes(INT), date(DATE), is_auto_completed(BOOL)`
- ユニーク制約: user × date × JST開始分。

### open_records（開きっぱなしの稼働）— `OpenRecord`
`id, user_id, start_raw, start_rounded, date` — 稼働開始したが未終了の状態。翌日以降は `runAutoComplete` で自動締め。

### shifts（稼働予定）— `Shift`
`id, user_id, date, start_planned, end_planned(TEXT), start_planned2, end_planned2(TEXT nullable)` — 2部制対応。`ENTRY_NONE` で「なし」。

### kpis（KPI）— `KpiRecord`
`id, user_id, date, total_calls, valid_calls, kc_count, follow_up_created, decision_maker_apo, non_decision_maker_apo, start_time(TIME), confirmed_dm, confirmed_non_dm(INT), kpi_missing_slack_notified_at(TIMESTAMPTZ)`
- 一般メンバーは total_calls〜non_decision_maker_apo を入力。
- インターンは `confirmed_dm / confirmed_non_dm`（管理者確定の商談数）のみが評価・請求対象。

### その他
- `plan_actual_gap_approvals` / `deviation_approvals`: 予実乖離の確定記録。
- `punch_start_reminder_sent` / `punch_end_reminder_sent` / `kpi_productivity_alert_sent` / `kpi_missing_after_punch_alert_sent`: Slack通知の重複防止フラグ。
- `data_change_history`: 監査ログ。

> **DBカラム(snake_case) → 型(camelCase) の変換は `lib/supabase-data.ts` の `to*` 関数**（`toMember/toWorkRecord/toKpiRecord/toShift/toOpenRecord`）。列を増減したらここも直す。

---

## 3. データフロー

### ① メンバー登録（入口）
```
Googleフォーム → GAS(onFormSubmit) → POST /api/webhooks/google-form-register
  (Authorization: Bearer rim_secret_2026)
  → parseExternalRegisterPayload → registerMemberFromGoogleForm (lib/external-register-member.ts)
     → メール重複チェック → allocateNextInvoiceManagementNumber() → bcrypt.hash("12345")
     → users に INSERT → invoice_number を GAS に返却
  → GAS が Googleドキュメント(契約書テンプレ)をコピー→タグ置換→PDF→Gmail送付
```

### ② 日々の蓄積（コア）
```
一般メンバー: 稼働開始(open_records) → 稼働終了(attendance へ確定) → 日次KPI入力(kpis)
インターン:   管理者が AdminKpiProxyModal で confirmed_dm/non_dm を入力
管理者:       予実乖離アーカイブで予定/実績のズレを確定、休眠メンバー管理 など
```
- ブラウザ起動時 `hydrate()` が全件ロード → state へ。操作後は `refresh()` で再取得。
- 過去日の未終了打刻は `runAutoComplete(records, openRecs, shifts)` が自動締め（変更時のみ true を返し再ロード）。

### ③ 出力（出口）
- **請求書＋実績レポートPDF**: `lib/member-combined-pdf.ts` → `invoice-pdf-pdflib.ts` / `report-pdf-pdflib.ts`（pdf-lib, 座標指定）。一般=時給×時間、インターン=単価×確定数。
- **Slack**: 日次（slack-daily 朝／slack-report 深夜前日実績）、ランキング、KPIアラート、シフト催促。
- **CSV**: 生産性CSV（`export-productivity-csv.ts`）、稼働予定CSV（`export-schedule.ts`）。

---

## 4. モジュール境界（どこに何を書くか）

| 種類 | 置き場所 | 例 |
|---|---|---|
| 型・純ロジック（DB非依存） | `lib/attendance.ts` ほか `lib/*.ts` | `getKpiTotalsFromRecords`, `safeRatePercent`, `isWeekendYmd` |
| DB読み書き | `lib/supabase-data.ts` | `loadRecords`, `saveRecords`, `updateMember` |
| 集計 | `lib/admin-dashboard-metrics.ts`, `lib/roi-analysis.ts` | `computeGeneralDashboardMetrics`, `computeValueCreatedYenFromTotals` |
| PDF | `lib/invoice-*.ts`, `lib/report-pdf-*.ts`, `lib/member-combined-pdf.ts` | |
| Slack | `lib/slack-*.ts` | `sendSlackReportForDate` |
| 画面（UI＋state） | `app/page.tsx` | `AdminDashboard`, `DashboardPage` |
| HTTP境界 | `app/api/**/route.ts`, `app/actions/*.ts` | webhook, cron, 代理保存 |

**原則**: 集計・判定ロジックは `lib/` に置き、`app/page.tsx` からは呼ぶだけにする（テスト容易・再利用可）。ただし現状は `app/page.tsx` 内に `useMemo` 集計が多い（負債）。新規は可能な限り `lib/` へ。

---

## 5. app/page.tsx の内部地図（約10,700行）

- `type AdminSection`（≈L700）: 管理画面の全セクションの列挙。ここを見れば機能一覧が分かる。
- `AdminKpiProxyModal`（≈L1120）: 管理者KPI代理入力モーダル。
- `buildGeneralKpiUpsert`（モジュール関数）: KPI保存の rec/next 組み立て（モーダルとインライン入力で共用）。
- `AdminNavIcon`（≈L1330）: サイドバー用インラインSVGアイコン。
- `AdminDashboard`（≈L1420〜）: 管理画面本体。上部に state・useMemo 群、`navItems`、各 `{adminSection === "xxx" && (...)}` セクション。左サイドバー＋メイン(main)構成。
- `DashboardPage`（default export, ≈L8937〜）: 親。ログイン・`isAdminMode`・メンバー画面（活動記録/稼働予定/KPIタブ）・右下フローティング（管理者⇄メンバー切替＋ログアウト）・`AdminDashboard` の描画。`hydrate/refresh/runAutoComplete` もここ。

**新しい管理画面セクションを足す手順（4点セット）**:
1. `type AdminSection` に追加
2. `AdminDashboard` 内 `navItems` に `{ id, label }` 追加
3. `AdminNavIcon` にアイコン追加
4. `{adminSection === "xxx" && (...)}` セクションブロックを追加

---

## 6. 認証

- ログイン: `loginUser(account, password)`（users 照合 + bcrypt）→ `setCurrentUserId` ＋ NextAuth `signIn("credentials")`。
- `isAdminUser` = ログインメンバーの `loginAccount === "admin"`。`isAdminMode`（トグル）と両方 true のとき管理画面。
- **セッションはリロードで消える**（`currentUserId` はメモリ state）。毎回ログインし直す前提。
- API/cron は `CRON_SECRET`（Bearer）や webhook 共有シークレット（`rim_secret_2026`）で保護。

---

## 7. 既知のアーキ上の負債（改善余地）

1. 全件ロード（attendance/shifts/kpis の全履歴）→ データ増で重い。表示は直近N日に絞り、履歴が要る処理だけ全件、が理想（`PROJECT_HANDOVER.md §7`）。
2. `app/page.tsx` の肥大化（約10,700行）→ セクション単位でコンポーネント抽出したい。
3. 集計が UI 層（useMemo）に散在 → `lib/` へ寄せると保守性↑・サーバー集計化(D案)への布石。
4. `lib/store.ts`（ローカルFS実装）が残置。本番未使用の可能性、棚卸し対象。
