# LINE アカウント紐付け 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** メンバーのLINE userIdを個別コード方式で収集し、users に紐付ける（③LINE自動返信の前提）。

**Architecture:** LINE Messaging API の Webhook を1本追加（署名検証→コード突合→reply）。コード発行と連携状況は管理画面の新セクション「LINE連携」で管理。設計書 `docs/superpowers/specs/2026-08-07-line-account-linking-design.md` が正。

**Tech Stack:** 既存スタックのみ（fetch直・SDKなし・新規ライブラリ禁止）

**このリポジトリの掟:** tsc+build必須 / `Set`スプレッド禁止 / push はコントローラーが行う / コミットは日本語

---

### Task 1: マイグレーションSQL

**Files:** Create `supabase-migration-users-line-link.sql`

- [ ] 既存の users 系マイグレーション（例: `supabase-migration-users-bank.sql`）の流儀・冒頭のPostgRESTリロード注記に合わせて作成:

```sql
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS line_user_id TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS line_link_code TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS line_linked_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_line_user_id ON public.users (line_user_id) WHERE line_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_line_link_code ON public.users (line_link_code) WHERE line_link_code IS NOT NULL;
```

- [ ] tsc不要（SQLのみ）。コミット。

### Task 2: LINEクライアント `lib/line-bot.ts`

**Files:** Create `lib/line-bot.ts`

- [ ] 実装（lib/slack-bot.ts の流儀に合わせる）:
  - `isLineBotConfigured()`: `LINE_CHANNEL_ACCESS_TOKEN` 非空
  - `verifyLineSignature({channelSecret, rawBody, signature}): boolean` — HMAC-SHA256 **base64** digest を `timingSafeEqual`（長さ不一致はfalse。SlackのHexと違いbase64である点に注意）
  - `lineReplyText(replyToken, text): Promise<{ok, error?}>` — POST `https://api.line.me/v2/bot/message/reply`、`Authorization: Bearer <token>`、body `{replyToken, messages:[{type:"text", text}]}`。`withNetworkRetry` は**使わない**（replyTokenは1回限り・再送で二重返信のリスクの方が高い。コメントで明記）。失敗はwarnログ＋ok:false
- [ ] tsc → コミット

### Task 3: データ層 `lib/line-link-data.ts`

**Files:** Create `lib/line-link-data.ts`

- [ ] `getUsersDb()` 経由（サーバー専用。nakano-loop-data と同じ流儀）で:
  - `LineLinkRow` 型: id/name/lineUserId/lineLinkCode/lineLinkedAt/isActive/isIntern
  - `loadLineLinkRows()`: アクティブメンバー全員の上記カラム（`is_active=true`、name昇順）
  - `issueLineLinkCodes()`: `line_link_code IS NULL` かつ active の行に `RIM-` + 4桁乱数を採番。衝突は再抽選（最大10回/人。UNIQUE違反時のリトライ）。採番件数を返す
  - `findUserByLineLinkCode(code)`: code一致の1行（id/name/lineUserId）
  - `findUserByLineUserId(lineUserId)`: userId一致の1行
  - `linkLineUser(userId, lineUserId)`: `line_user_id`/`line_linked_at=now` を保存
  - `unlinkLineUser(userId)`: 両方NULLに
- [ ] tsc → コミット

### Task 4: Webhook `/api/webhooks/line-userid`

**Files:** Create `app/api/webhooks/line-userid/route.ts`

- [ ] 設計書§5どおり。骨子:
  - `export const dynamic = "force-dynamic";`（AI呼び出しなし・軽量なので maxDuration 不要）
  - rawBody = `await req.text()` → `LINE_CHANNEL_SECRET` 未設定500 / `verifyLineSignature` 失敗401
  - `events[]` を for で処理。`type==="message" && message.type==="text"` のみ
  - 正規化: `text.trim()` → 全角英数記号を半角化 → 大文字化 → `/^RIM-\d{4}$/` 判定。**不一致は完全無視**（人間宛てチャット）
  - 突合フロー（設計書§5-4の分岐と文言どおり。既連携の本人再送は「すでに連携済みです😊」）
  - reply失敗はwarn。route全体は常に200（署名/secret以外）
- [ ] tsc + build → コミット

### Task 5: 管理API

**Files:** Create `app/api/admin/line-links/route.ts`（GET一覧 / POST一括発行）、`app/api/admin/line-links/[id]/route.ts`（PATCH `{action:"unlink"}`）

- [ ] 認証・レスポンス形式は `app/api/admin/nakano/drafts/*` と同一流儀（isAdmin / 401 / 403 / 400 / 500）
- [ ] tsc + build → コミット

### Task 6: 管理画面「LINE連携」セクション

**Files:** Create `app/components/AdminLineLinkSection.tsx` / Modify `app/page.tsx`

- [ ] `AdminLineLinkSection`: 一覧（未連携を上・氏名/コード/状態/連携日時）・「コードを一括発行」(confirm)・行の「連携を取り消す」(confirm)・案内文テンプレのコピー欄（下記文面、コード差し込み）:
  「【お願い・10秒で終わります】アプリとLINEの連携のため、このトークに次のコードだけを送ってください → {code}　送信すると自動で「登録できました」と返信が届きます」
- [ ] `app/page.tsx` の4点セット: `AdminSection` 型に `"line"` 追加 → `navItems` に「LINE連携」→ `AdminNavIcon` にインラインSVG（既存アイコンの流儀）→ `{adminSection === "line" && <AdminLineLinkSection />}`。**page.tsxはJSX入れ子が深いので編集後necessarily build確認**
- [ ] tsc + build → コミット

### Task 7: env・docs・最終検証

- [ ] `.env.example` に `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN`（コメント付き）
- [ ] `docs/DEPLOY.md` に結線手順（設計書§10）
- [ ] `docs/SESSION_LOG.md` 先頭に追記
- [ ] `npx tsc --noEmit && npm run build` → コミット
