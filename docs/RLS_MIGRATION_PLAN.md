# RLS段階移行プラン（① 全開放の解消） — 2026-07-31

> 目的: 公開anonキーだけで全データを読み書きできる状態（RLS `USING(true)`）を解消する。
> 制約: アプリはブラウザから anonキーで Supabase を直クエリ。いきなりRLSを締めると全機能停止。
> 方針: **データアクセスをサーバ側(service_role)に寄せてからRLSを締める**。最重要の `users`（口座・PII・PW）を最優先で守り、運用テーブルは後段。小さく刻んで各段でデプロイ・検証。

## 現状（確認済み）
- 本番RLS: 全7テーブル `FOR ALL USING(true) WITH CHECK(true)`（`pg_policies` で確認）。
- クライアント`app/page.tsx`("use client")は `lib/supabase-data.ts` 経由で users を読み書き（23呼び出し）。ログインも `page.tsx:9939` でクライアント`loginUser`。
- `getSupabase()`（`lib/supabase.ts`）は anonキーのみ。**service_role未導入**。
- パスワードはハッシュ化済（③完了）。ただし口座・住所・氏名は平文でanon可読。

## 対象テーブルの機微度
| テーブル | 中身 | 優先度 |
|---|---|---|
| **users** | 氏名/住所/電話/**口座**/PW(ハッシュ)/時給 | ★最優先 |
| attendance/shifts/kpis/open_records | 打刻・シフト・KPI（労務データ） | 後段 |
| *_approvals, *_sent | 承認・通知記録 | 後段 |

---

## フェーズ0：土台（安全・先に実施）
**0-1. service_roleキー導入（ユーザー作業）**
- Vercel → Settings → Environment Variables に **`SUPABASE_SERVICE_ROLE_KEY`**（Supabase → Project Settings → API → service_role secret）を追加。**Production/Preview**。⚠ **絶対に `NEXT_PUBLIC_` にしない**（付けるとブラウザに漏れRLS無意味化）。
- `.env.local` にも同キーを追加（ローカル動作用）。

**0-2. サーバ専用Supabaseクライアント（コード・実装済み）**
- `lib/supabase-admin.ts`：service_roleで接続。**"use client"から絶対にimport禁止**（ブラウザ実行なら例外を投げるガード付き）。この時点では未使用＝無害。

## フェーズ1：`users` を守る（最重要・小分けにデプロイ）
1-1. **ログインをサーバ専用に**
   - サーバ側 NextAuth `authorize`（`loginUser`）は既にあり、`loginUser` は `is_active` 判定済。
   - クライアント`page.tsx:9939` の `loginUser` 直呼びを **`signIn()`（NextAuth）** に置換。ログイン後は `getSession()` で `currentUserId` を確定。
   - ⚠ 直近で直したリロード復元(`hydrate`/`sessionChecked`)に触れるので慎重に。各段で実機ログイン確認。

1-2. **メンバー取得/更新をサーバAPI化**（認証必須・service_role）
   - `GET /api/admin/members`：セッション検証 → **PWを除いた**メンバー一覧。口座/PIIは管理者セッションのみ返す。
   - `POST /api/admin/members`：作成/更新/無効化/復元（管理者のみ）。既存の保存ロジック（`addMember`/`updateMemberOrThrow`/`deleteMember`）をサーバ側で呼ぶ。
   - `loginUser`/`loadMembers`/`allocateNextInvoiceManagementNumber` 等 users 系 lib は service_role クライアントを使うようにする（サーバ実行前提へ）。

1-3. **クライアントを差し替え**
   - `page.tsx` の `loadMembers`/`addMember`/`updateMember`/`saveMembers`/`deleteMember` 呼び出し(23箇所)を、上記APIの `fetch` に置換。

1-4. **`users` のRLSを締める**（アプリがAPI経由に移った後）
   - `drop policy "Allow all for users" on public.users;`（RLS有効・anonポリシー無し＝anonは全拒否。service_roleはRLSをバイパスして動作）。
   - 検証: アプリ正常動作 ＋ `curl`(anonキー)で `users` が読めない(空/403)ことを確認。

## フェーズ2：運用テーブル（attendance/shifts/kpis/open_records）
- 方式候補A: 同様にサーバAPI化（打刻・KPI保存をAPI経由へ）。影響大。
- 方式候補B: Supabase Auth を導入し `auth.uid()` ベースの本人限定RLS（NextAuthと二重管理の整理が必要）。
- どちらも中〜大。usersを守った後に別途設計。

## 進捗（2026-07-31）
- ✅ フェーズ0：プラン・`lib/supabase-admin.ts`・`SUPABASE_SERVICE_ROLE_KEY`(Vercel投入)。
- ✅ service_roleキー疎通検証：`GET /api/admin/members` で168名取得(本番・管理者セッション)。
- ✅ 1-1途中：`getUsersDb()`（サーバ=service_role/クライアント=anon）を `loadMembers` に適用。サーバNextAuthログインも service_role で users を読む（本番ログイン/リロード確認済 `eccbb28`）。
- ✅ 読み取りAPI足場：`GET /api/admin/members`(管理者=全件・PW除外)＋`GET /api/member/me`(本人1件・PW除外)。**まだクライアント未使用**。
- ⬜ **残り（リスク高・要集中）**:
  1. **書き込み系のサーバ集約**: `addMember`/`updateMemberOrThrow`/`deleteMember`/`saveMembers`/`allocateNextInvoiceManagementNumber` を `getUsersDb` 化 or サーバAPIに寄せる。`member-update`/`bank-profile` 等の既存サーバ経路も getSupabase(anon)→admin へ。
  2. **クライアント読み取り差し替え**: `page.tsx` の `loadMembers` 直呼び(hydrate等)を、管理者=`/api/admin/members`・一般=`/api/member/me` に。**要確認: 一般メンバー画面が他メンバー情報を必要としないか**（必要なら「名前だけの公開ビュー」等を別途設計）。
  3. **ログイン signIn 化**: `page.tsx:9939` の client `loginUser` を撤去し `signIn()` に一本化（anon での users 読みを無くす）。**リロード復元(hydrate/sessionChecked)に影響・要本番確認**。
  4. **RLS締め**: `drop policy "Allow all for users" on public.users;`。締めた後 `curl`(anon)で users が読めないこと＋アプリ正常動作を確認。

## フェーズ3：④認証堅牢化（初期PWランダム化＋初回変更必須・試行回数制限）

---

## リスクと原則
- 各段で `tsc`+`build`+**本番実機（ログイン/メンバー編集）**を確認してから次へ。
- service_roleキーは**サーバのみ**。クライアントバンドルに出ないことを毎回確認。
- 途中でアプリが壊れたら即前段に戻せるよう、RLS締め(1-4)は最後。
- FREEプラン・quota超過警告あり（2026-08-14以降制限リスク）。作業と別に要対応。
