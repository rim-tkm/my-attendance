# 中野くん知識ループ 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 担当のSlackスレッド返信を📚リアクション→AI整形→承認の二重ゲートで中野くんの正式知識に還流させる。

**Architecture:** エスカレ通知をWebhook送信からSlack Bot投稿（`chat.postMessage`）に切り替えて投稿ts↔質問の対応表を持ち、Events API（`reaction_added`）で📚を検知。スレッド返信をAI（Haiku系）で一般化した知識文案に整形し、`nakano_knowledge_drafts` に承認待ちとして保存。管理画面で承認したものだけ既存 `nakano_knowledge` にINSERTする。Botトークン未設定時は従来Webhookにフォールバック（段階移行）。

**Tech Stack:** Next.js 14 App Router / Supabase(service_role) / Slack Web API（fetch直叩き・SDK追加なし）/ @anthropic-ai/sdk（既存依存）

**前提知識（このリポジトリの掟）:**
- テストフレームワークなし。品質ゲートは `npx tsc --noEmit` と `npm run build`（両方必須）
- `Set` のスプレッド禁止（`Array.from` を使う）
- 新規npmライブラリ追加禁止
- nakano系テーブルはRLS有効・ポリシー無し＝service_role（サーバー）からのみ読み書き可
- コミットは日本語で「何を・なぜ」

**設計書:** `docs/superpowers/specs/2026-08-07-nakano-knowledge-loop-design.md`

---

### Task 1: マイグレーションSQL

**Files:**
- Create: `supabase-migration-nakano-knowledge-loop.sql`

- [ ] **Step 1: SQLファイルを作成**

```sql
-- 中野くん知識ループ: エスカレ投稿の対応表と、知識の承認待ちドラフト
-- 設計: docs/superpowers/specs/2026-08-07-nakano-knowledge-loop-design.md §5

-- Bot投稿（エスカレ通知）と質問の対応表。
-- 📚リアクションが付いた投稿の ts から「どの質問か」を逆引きするために使う。
create table if not exists public.nakano_escalations (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.nakano_conversations(id) on delete cascade,
  -- users への FK は張らない。メンバー削除後もログとして残したいため
  user_id uuid not null,
  question text not null,
  slack_channel_id text not null,
  slack_ts text not null,
  created_at timestamptz not null default now(),
  unique (slack_channel_id, slack_ts)
);
alter table public.nakano_escalations enable row level security;

-- 知識の承認待ちドラフト。承認されるまで本番知識（nakano_knowledge）には入らない。
create table if not exists public.nakano_knowledge_drafts (
  id uuid primary key default gen_random_uuid(),
  escalation_id uuid references public.nakano_escalations(id) on delete set null,
  question text not null,
  raw_answer text not null,
  draft_title text not null,
  draft_body text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  slack_permalink text,
  approved_knowledge_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.nakano_knowledge_drafts enable row level security;
create index if not exists idx_nakano_drafts_status
  on public.nakano_knowledge_drafts (status);
```

- [ ] **Step 2: コミット**

```bash
git add supabase-migration-nakano-knowledge-loop.sql
git commit -m "feat(中野くん): 知識ループ用テーブルのマイグレーションSQLを追加"
```

※このSQLは最後にユーザーへ「SupabaseのSQL Editorで実行」として全文をチャットに貼って案内する（Task 9）。

---

### Task 2: Slack Botクライアント `lib/slack-bot.ts`

**Files:**
- Create: `lib/slack-bot.ts`

依存追加なしで Slack Web API を fetch で叩く薄いラッパー。リトライは既存 `withNetworkRetry` を使う。

- [ ] **Step 1: 実装**

```typescript
/**
 * Slack Bot（Web API）クライアント。サーバー専用。
 *
 * Incoming Webhook（lib/slack-webhook.ts）は「送るだけ」で投稿tsが取れず、
 * スレッドもリアクションも辿れない。知識ループでは「どの投稿にリアクションが
 * 付いたか」を逆引きする必要があるため、Bot トークンでの投稿に切り替える。
 * SDKは追加しない（新規ライブラリ禁止の方針）。fetch で直接叩く。
 *
 * 設計: docs/superpowers/specs/2026-08-07-nakano-knowledge-loop-design.md §4
 */

import { createHmac, timingSafeEqual } from "crypto";
import { withNetworkRetry } from "@/lib/network-retry";

export function isSlackBotConfigured(): boolean {
  return (process.env.SLACK_BOT_TOKEN ?? "").trim() !== "";
}

/** エスカレ通知の投稿先チャンネルID（例: C0123456789）。未設定なら undefined */
export function getNakanoSlackChannelId(): string | undefined {
  const v = (process.env.SLACK_NAKANO_CHANNEL_ID ?? "").trim();
  return v !== "" ? v : undefined;
}

function botToken(): string {
  return (process.env.SLACK_BOT_TOKEN ?? "").trim();
}

/**
 * Slack Events API の署名検証（v0方式）。
 * base = `v0:${timestamp}:${rawBody}` の HMAC-SHA256 を signing secret で取り、
 * ヘッダ `x-slack-signature`（v0=hex）と比較する。5分より古いリクエストは拒否。
 */
export function verifySlackSignature(params: {
  signingSecret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
}): boolean {
  const ts = Number(params.timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const base = `v0:${params.timestamp}:${params.rawBody}`;
  const digest = `v0=${createHmac("sha256", params.signingSecret).update(base).digest("hex")}`;
  const a = Buffer.from(digest);
  const b = Buffer.from(params.signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type SlackApiResult = { ok: boolean; error?: string } & Record<string, unknown>;

/** POST系（chat.postMessage 等）。429/5xx/ネットワーク例外は最大3回リトライ */
async function callSlackApiPost(method: string, payload: Record<string, unknown>): Promise<SlackApiResult> {
  return withNetworkRetry(
    async () => {
      const res = await fetch(`https://slack.com/api/${method}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: `Bearer ${botToken()}`,
        },
        body: JSON.stringify(payload),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as SlackApiResult;
    },
    { maxAttempts: 3, baseDelayMs: 500, perAttemptTimeoutMs: 10_000 }
  );
}

/** GET系（conversations.replies 等） */
async function callSlackApiGet(method: string, params: Record<string, string>): Promise<SlackApiResult> {
  const qs = new URLSearchParams(params).toString();
  return withNetworkRetry(
    async () => {
      const res = await fetch(`https://slack.com/api/${method}?${qs}`, {
        headers: { Authorization: `Bearer ${botToken()}` },
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as SlackApiResult;
    },
    { maxAttempts: 3, baseDelayMs: 500, perAttemptTimeoutMs: 10_000 }
  );
}

/** チャンネル（またはスレッド）へ投稿。成功時は投稿の ts を返す */
export async function slackBotPostMessage(params: {
  channel: string;
  text: string;
  threadTs?: string;
}): Promise<{ ok: true; ts: string } | { ok: false; error: string }> {
  try {
    const body: Record<string, unknown> = { channel: params.channel, text: params.text };
    if (params.threadTs) body.thread_ts = params.threadTs;
    const r = await callSlackApiPost("chat.postMessage", body);
    if (r.ok !== true) return { ok: false, error: String(r.error ?? "unknown") };
    return { ok: true, ts: String(r.ts ?? "") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 投稿へのパーマリンク。失敗しても致命ではないので null を返す */
export async function slackBotGetPermalink(channel: string, messageTs: string): Promise<string | null> {
  try {
    const r = await callSlackApiGet("chat.getPermalink", { channel, message_ts: messageTs });
    if (r.ok !== true) return null;
    const link = r.permalink;
    return typeof link === "string" && link !== "" ? link : null;
  } catch {
    return null;
  }
}

/**
 * スレッドの返信本文を時刻順で返す。
 * 親投稿（エスカレ通知）と Bot 自身の投稿（案内文）は除く。人間の回答だけが欲しい。
 */
export async function slackBotFetchThreadReplies(channel: string, threadTs: string): Promise<string[]> {
  const r = await callSlackApiGet("conversations.replies", { channel, ts: threadTs, limit: "50" });
  if (r.ok !== true) throw new Error(`conversations.replies failed: ${String(r.error ?? "unknown")}`);
  const messages = Array.isArray(r.messages) ? (r.messages as Record<string, unknown>[]) : [];
  return messages
    .filter((m) => String(m.ts ?? "") !== threadTs)
    .filter((m) => m.bot_id === undefined)
    .map((m) => (typeof m.text === "string" ? m.text.trim() : ""))
    .filter((t) => t !== "");
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: 署名検証を手元で確認**

Run:
```bash
node -e '
const { createHmac } = require("crypto");
const secret = "testsecret";
const ts = String(Math.floor(Date.now()/1000));
const body = "payload";
const sig = "v0=" + createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex");
console.log("sig:", sig);
console.log("期待: 検証ロジックと同じ式なので、実装側と一致するはず");
'
```
Expected: `v0=`で始まるhexが出る（実装と同式であることを目視確認）

- [ ] **Step 4: コミット**

```bash
git add lib/slack-bot.ts
git commit -m "feat(中野くん): Slack Botクライアントを追加（投稿ts取得・署名検証・スレッド取得）"
```

---

### Task 3: データ層 `lib/nakano-loop-data.ts`

**Files:**
- Create: `lib/nakano-loop-data.ts`

- [ ] **Step 1: 実装**

```typescript
/**
 * 知識ループのデータ読み書き（Supabase）。サーバー専用。
 *
 * nakano_escalations / nakano_knowledge_drafts は RLS 有効・ポリシー無しなので
 * service_role（サーバー）からのみ読み書きできる。lib/nakano-data.ts と同じ流儀。
 *
 * 設計: docs/superpowers/specs/2026-08-07-nakano-knowledge-loop-design.md §5
 */

import { getUsersDb } from "@/lib/supabase-data";
import { insertNakanoKnowledge } from "@/lib/nakano-data";
import { normalizeNakanoCategory, type NakanoKnowledge } from "@/lib/nakano";

function db() {
  return getUsersDb();
}

/* ------------------------------------------------------------------ *
 * エスカレ投稿の対応表
 * ------------------------------------------------------------------ */

export type NakanoEscalation = {
  id: string;
  conversationId: string;
  userId: string;
  question: string;
  slackChannelId: string;
  slackTs: string;
  createdAt: string;
};

type DbNakanoEscalation = {
  id: string;
  conversation_id: string;
  user_id: string;
  question: string;
  slack_channel_id: string;
  slack_ts: string;
  created_at: string | null;
};

const ESCALATION_COLUMNS = "id, conversation_id, user_id, question, slack_channel_id, slack_ts, created_at";

function toNakanoEscalation(r: DbNakanoEscalation): NakanoEscalation {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    userId: r.user_id,
    question: r.question,
    slackChannelId: r.slack_channel_id,
    slackTs: r.slack_ts,
    createdAt: r.created_at ?? "",
  };
}

export async function insertNakanoEscalation(input: {
  conversationId: string;
  userId: string;
  question: string;
  slackChannelId: string;
  slackTs: string;
}): Promise<void> {
  const supabase = db();
  const { error } = await supabase.from("nakano_escalations").insert({
    conversation_id: input.conversationId,
    user_id: input.userId,
    question: input.question,
    slack_channel_id: input.slackChannelId,
    slack_ts: input.slackTs,
  });
  if (error) throw new Error(error.message);
}

/** 📚が付いた投稿の (channel, ts) から元の質問を逆引きする */
export async function findNakanoEscalationBySlackTs(
  channelId: string,
  ts: string
): Promise<NakanoEscalation | null> {
  const supabase = db();
  const { data, error } = await supabase
    .from("nakano_escalations")
    .select(ESCALATION_COLUMNS)
    .eq("slack_channel_id", channelId)
    .eq("slack_ts", ts)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toNakanoEscalation(data as DbNakanoEscalation) : null;
}

/* ------------------------------------------------------------------ *
 * 承認待ちドラフト
 * ------------------------------------------------------------------ */

export type NakanoDraftStatus = "pending" | "approved" | "rejected";

export type NakanoKnowledgeDraft = {
  id: string;
  escalationId: string | null;
  question: string;
  rawAnswer: string;
  draftTitle: string;
  draftBody: string;
  status: NakanoDraftStatus;
  slackPermalink: string | null;
  approvedKnowledgeId: string | null;
  createdAt: string;
  updatedAt: string;
};

type DbNakanoKnowledgeDraft = {
  id: string;
  escalation_id: string | null;
  question: string;
  raw_answer: string;
  draft_title: string;
  draft_body: string;
  status: string;
  slack_permalink: string | null;
  approved_knowledge_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const DRAFT_COLUMNS =
  "id, escalation_id, question, raw_answer, draft_title, draft_body, status, slack_permalink, approved_knowledge_id, created_at, updated_at";

function toNakanoKnowledgeDraft(r: DbNakanoKnowledgeDraft): NakanoKnowledgeDraft {
  const status: NakanoDraftStatus =
    r.status === "approved" || r.status === "rejected" ? r.status : "pending";
  return {
    id: r.id,
    escalationId: r.escalation_id,
    question: r.question,
    rawAnswer: r.raw_answer,
    draftTitle: r.draft_title,
    draftBody: r.draft_body,
    status,
    slackPermalink: r.slack_permalink,
    approvedKnowledgeId: r.approved_knowledge_id,
    createdAt: r.created_at ?? "",
    updatedAt: r.updated_at ?? "",
  };
}

/** 📚の重複押下で二重作成しないためのチェック */
export async function findPendingDraftByEscalationId(
  escalationId: string
): Promise<NakanoKnowledgeDraft | null> {
  const supabase = db();
  const { data, error } = await supabase
    .from("nakano_knowledge_drafts")
    .select(DRAFT_COLUMNS)
    .eq("escalation_id", escalationId)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toNakanoKnowledgeDraft(data as DbNakanoKnowledgeDraft) : null;
}

export async function insertNakanoKnowledgeDraft(input: {
  escalationId: string | null;
  question: string;
  rawAnswer: string;
  draftTitle: string;
  draftBody: string;
  slackPermalink: string | null;
}): Promise<NakanoKnowledgeDraft> {
  const supabase = db();
  const { data, error } = await supabase
    .from("nakano_knowledge_drafts")
    .insert({
      escalation_id: input.escalationId,
      question: input.question,
      raw_answer: input.rawAnswer,
      draft_title: input.draftTitle,
      draft_body: input.draftBody,
      slack_permalink: input.slackPermalink,
    })
    .select(DRAFT_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return toNakanoKnowledgeDraft(data as DbNakanoKnowledgeDraft);
}

export async function loadPendingNakanoDrafts(): Promise<NakanoKnowledgeDraft[]> {
  const supabase = db();
  const { data, error } = await supabase
    .from("nakano_knowledge_drafts")
    .select(DRAFT_COLUMNS)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as DbNakanoKnowledgeDraft[]).map(toNakanoKnowledgeDraft);
}

/**
 * 承認: 編集後のタイトル・本文で nakano_knowledge に正式登録し、ドラフトを approved にする。
 * FAQボタンには出さない（show_as_step=false）。出すかどうかは既存の知識管理UIで後から変えられる。
 */
export async function approveNakanoDraft(
  id: string,
  input: { title: string; body: string }
): Promise<NakanoKnowledge> {
  const knowledge = await insertNakanoKnowledge({
    title: input.title,
    body: input.body,
    category: normalizeNakanoCategory("operation"),
    parentId: null,
    showAsStep: false,
    isActive: true,
    sortOrder: 0,
  });
  const supabase = db();
  const { error } = await supabase
    .from("nakano_knowledge_drafts")
    .update({
      status: "approved",
      draft_title: input.title,
      draft_body: input.body,
      approved_knowledge_id: knowledge.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
  return knowledge;
}

export async function rejectNakanoDraft(id: string): Promise<void> {
  const supabase = db();
  const { error } = await supabase
    .from("nakano_knowledge_drafts")
    .update({ status: "rejected", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし。`normalizeNakanoCategory` / `insertNakanoKnowledge` のimportが合わない場合は `lib/nakano.ts` / `lib/nakano-data.ts` のexport名を確認して合わせる（勝手に新設しない）

- [ ] **Step 3: コミット**

```bash
git add lib/nakano-loop-data.ts
git commit -m "feat(中野くん): 知識ループのデータ層を追加（エスカレ対応表・承認待ちドラフト）"
```

---

### Task 4: エスカレ通知のBot化（フォールバック付き）

**Files:**
- Modify: `lib/nakano-server.ts`（`notifyNakanoEscalation`）
- Modify: `app/api/nakano/chat/route.ts`（呼び出し2箇所に conversationId を渡す）

- [ ] **Step 1: `notifyNakanoEscalation` を差し替え**

`lib/nakano-server.ts` の import に追加:

```typescript
import { getNakanoSlackChannelId, isSlackBotConfigured, slackBotPostMessage } from "@/lib/slack-bot";
import { insertNakanoEscalation } from "@/lib/nakano-loop-data";
```

`notifyNakanoEscalation` を次の内容に置き換える（既存の文面組み立てはそのまま生かす）:

```typescript
/**
 * 担当に回す（Slack通知）。
 * 通知の失敗で会話自体を落とさない。ここで throw すると、
 * メンバーには「エラー」としか見えず、質問した事実まで失われてしまう。
 *
 * SLACK_BOT_TOKEN と SLACK_NAKANO_CHANNEL_ID が設定されていれば Bot 投稿にする。
 * Bot投稿は投稿tsが取れるため、📚リアクション→知識化の逆引き（nakano_escalations）が可能になる。
 * 未設定なら従来どおり Incoming Webhook（知識化は不可・通知のみ）。段階移行のため。
 */
export async function notifyNakanoEscalation(params: {
  memberName: string;
  memberAccount: string;
  question: string;
  reason: string;
  summary: string;
  /** 知識ループ用。Bot投稿できたとき nakano_escalations に対応を残す */
  conversationId?: string;
  userId?: string;
}): Promise<void> {
  try {
    const text =
      buildNakanoMentionPrefix() +
      `🙋 中野くんが答えられない質問を受けました\n` +
      `・氏名: ${params.memberName || "（氏名不明）"}\n` +
      `・アカウント: ${params.memberAccount || "（不明）"}\n` +
      `・質問: ${params.question}\n` +
      (params.summary ? `・要約: ${params.summary}\n` : "") +
      (params.reason ? `・理由: ${params.reason}\n` : "") +
      `本人に回答をお願いします。前後のやりとりは管理画面の「中野くん」→「届いた質問」で確認できます。\n` +
      `このスレッドに回答を書いて 📚 を付けると、中野くんの知識の文案になります。`;

    const channelId = getNakanoSlackChannelId();
    if (isSlackBotConfigured() && channelId) {
      const r = await slackBotPostMessage({ channel: channelId, text });
      if (!r.ok) {
        console.warn("[nakano] escalation bot post failed:", r.error);
        return;
      }
      if (params.conversationId && params.userId) {
        try {
          await insertNakanoEscalation({
            conversationId: params.conversationId,
            userId: params.userId,
            question: params.question,
            slackChannelId: channelId,
            slackTs: r.ts,
          });
        } catch (e) {
          // 対応表に残せなくても通知自体は成功している。📚は効かないが実害は知識化だけ
          console.warn("[nakano] escalation record failed:", e instanceof Error ? e.message : String(e));
        }
      }
      return;
    }

    const url = resolveSlackWebhookUrl("nakano");
    if (!url) {
      console.warn("[nakano] escalation slack url not configured");
      return;
    }
    const r = await postSlackIncomingWebhook(url, { text });
    if (!r.ok) console.warn("[nakano] escalation slack failed:", r.error, r.detail);
  } catch (e) {
    console.warn("[nakano] escalation slack threw:", e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 2: 呼び出し側に conversationId / userId を渡す**

`app/api/nakano/chat/route.ts` の `notifyNakanoEscalation` 呼び出しは2箇所ある（ツール発火時／安全網）。両方に追加:

```typescript
              await notifyNakanoEscalation({
                memberName,
                memberAccount,
                question,
                reason: ev.reason,
                summary: ev.summary,
                conversationId,
                userId,
              });
```

```typescript
          await notifyNakanoEscalation({
            memberName,
            memberAccount,
            question,
            reason: "AIが本文で担当対応を案内したがツール未使用のため、安全網で自動エスカレーション",
            summary: "",
            conversationId,
            userId,
          });
```

- [ ] **Step 3: 型チェックとビルド**

Run: `npx tsc --noEmit && npm run build`
Expected: 両方成功

- [ ] **Step 4: コミット**

```bash
git add lib/nakano-server.ts app/api/nakano/chat/route.ts
git commit -m "feat(中野くん): エスカレ通知をBot投稿に切替（未設定時はWebhookへフォールバック）

Bot投稿はtsが取れるため📚リアクション→知識化の逆引きが可能になる。
nakano_escalationsに投稿と質問の対応を残す。"
```

---

### Task 5: AI整形 `lib/nakano-draft.ts`

**Files:**
- Create: `lib/nakano-draft.ts`

- [ ] **Step 1: 実装**

```typescript
/**
 * スレッド返信を「中野くんの知識」の文案に整形する。サーバー専用。
 *
 * スレッド返信の生文は「その人・その場面向け」（例:「はい、その場合は大丈夫です！」）で、
 * そのまま知識に入れても中野くんは使えない。質問＋回答から一般化した知識文に整える。
 * 整形は安価なモデルで十分（1件1円未満）。失敗時は呼び出し側が生文のまま保存する。
 *
 * 設計: docs/superpowers/specs/2026-08-07-nakano-knowledge-loop-design.md §6
 */

import Anthropic from "@anthropic-ai/sdk";

const DRAFT_DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export async function generateKnowledgeDraft(params: {
  question: string;
  rawAnswer: string;
}): Promise<{ title: string; body: string }> {
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (apiKey === "") throw new Error("ANTHROPIC_API_KEY が設定されていません。");
  const client = new Anthropic();
  const model = (process.env.NAKANO_DRAFT_MODEL ?? "").trim() || DRAFT_DEFAULT_MODEL;

  const res = await client.messages.create({
    model,
    max_tokens: 1000,
    system:
      "あなたは社内FAQの編集者です。メンバーからの質問と、担当者がSlackに書いた回答を渡します。" +
      "これを、AIアシスタントが今後同じ質問に答えるための知識項目に整形してください。\n" +
      "ルール:\n" +
      "- 特定の個人・日付・その場限りの文脈を除き、誰にでも当てはまる一般的な記述にする\n" +
      "- 回答に書かれていないことを推測で足さない。書かれていることだけを整理する\n" +
      "- タイトルは質問の要点を15文字前後で\n" +
      "- 本文は敬体で簡潔に。手順があれば番号付きにする\n" +
      '- 出力は次のJSONだけ: {"title": "...", "body": "..."}',
    messages: [
      {
        role: "user",
        content: `【質問】\n${params.question}\n\n【担当者の回答（Slackスレッド）】\n${params.rawAnswer}`,
      },
    ],
  });

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  // 前後に説明文が付いても最初のJSONオブジェクトだけ拾う
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("整形結果からJSONを取り出せませんでした");
  const parsed = JSON.parse(match[0]) as { title?: unknown; body?: unknown };
  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
  if (title === "" || body === "") throw new Error("整形結果のtitle/bodyが空です");
  return { title, body };
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし（`Anthropic.TextBlock` の型名が合わない場合は `lib/nakano-client.ts` のSDK利用箇所を参照して合わせる）

- [ ] **Step 3: コミット**

```bash
git add lib/nakano-draft.ts
git commit -m "feat(中野くん): スレッド返信を知識文案に整形するAI呼び出しを追加"
```

---

### Task 6: Slackイベント受信 `/api/webhooks/slack-events`

**Files:**
- Create: `app/api/webhooks/slack-events/route.ts`

- [ ] **Step 1: 実装**

```typescript
import { NextResponse } from "next/server";
import { generateKnowledgeDraft } from "@/lib/nakano-draft";
import {
  findNakanoEscalationBySlackTs,
  findPendingDraftByEscalationId,
  insertNakanoKnowledgeDraft,
} from "@/lib/nakano-loop-data";
import {
  getNakanoSlackChannelId,
  slackBotFetchThreadReplies,
  slackBotGetPermalink,
  slackBotPostMessage,
  verifySlackSignature,
} from "@/lib/slack-bot";

export const dynamic = "force-dynamic";

/**
 * Slack Events API の受け口。📚（:books:）リアクションで知識化を起動する。
 *
 * Slackは3秒以内に応答がないと同じイベントを再送してくる。
 * 再送（x-slack-retry-num ヘッダ付き）は即200で無視し、初回リクエスト内で同期処理する。
 * 二重作成は pending 重複チェックでも防いでいる（waitUntil の新規依存を増やさないため）。
 *
 * 設計: docs/superpowers/specs/2026-08-07-nakano-knowledge-loop-design.md §6
 */
export async function POST(req: Request) {
  const rawBody = await req.text();

  // 署名検証。secret未設定のうちは誰でも叩けてしまうので、未設定なら全拒否
  const signingSecret = (process.env.SLACK_SIGNING_SECRET ?? "").trim();
  if (signingSecret === "") {
    console.warn("[nakano-loop] SLACK_SIGNING_SECRET が未設定です");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  const valid = verifySlackSignature({
    signingSecret,
    timestamp: req.headers.get("x-slack-request-timestamp") ?? "",
    rawBody,
    signature: req.headers.get("x-slack-signature") ?? "",
  });
  if (!valid) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // 初回のURL検証（Slackアプリ設定画面でRequest URLを登録するときに来る）
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  // 再送は無視（初回リクエストが処理を続けている）
  if (req.headers.get("x-slack-retry-num")) {
    return NextResponse.json({ ok: true });
  }

  const event = (payload.event ?? {}) as Record<string, unknown>;
  const item = (event.item ?? {}) as Record<string, unknown>;
  const channelId = getNakanoSlackChannelId();
  const isTargetReaction =
    payload.type === "event_callback" &&
    event.type === "reaction_added" &&
    event.reaction === "books" &&
    item.type === "message" &&
    typeof item.channel === "string" &&
    typeof item.ts === "string" &&
    channelId !== undefined &&
    item.channel === channelId;
  if (!isTargetReaction) {
    return NextResponse.json({ ok: true });
  }

  const channel = item.channel as string;
  const ts = item.ts as string;

  // 処理中に何が起きても Slack には 200 を返す（エラーを返すと再送で多重処理になる）
  try {
    const escalation = await findNakanoEscalationBySlackTs(channel, ts);
    if (!escalation) {
      await slackBotPostMessage({
        channel,
        threadTs: ts,
        text: "この投稿は知識化の対象外です（エスカレーション通知にのみ📚が使えます）",
      });
      return NextResponse.json({ ok: true });
    }

    const existing = await findPendingDraftByEscalationId(escalation.id);
    if (existing) {
      await slackBotPostMessage({
        channel,
        threadTs: ts,
        text: "この質問の文案は既に承認待ちにあります。管理画面の「中野くん」→「承認待ち」を確認してください",
      });
      return NextResponse.json({ ok: true });
    }

    const replies = await slackBotFetchThreadReplies(channel, ts);
    if (replies.length === 0) {
      await slackBotPostMessage({
        channel,
        threadTs: ts,
        text: "先にこのスレッドに回答を書いてから📚を付けてください",
      });
      return NextResponse.json({ ok: true });
    }
    const rawAnswer = replies.join("\n");

    // 整形に失敗しても素材（担当の回答）を失わないことを最優先にする
    let draftTitle: string;
    let draftBody: string;
    try {
      const draft = await generateKnowledgeDraft({ question: escalation.question, rawAnswer });
      draftTitle = draft.title;
      draftBody = draft.body;
    } catch (e) {
      console.warn("[nakano-loop] AI整形に失敗。生文のまま保存:", e instanceof Error ? e.message : String(e));
      draftTitle = escalation.question.slice(0, 30);
      draftBody = rawAnswer;
    }

    const permalink = await slackBotGetPermalink(channel, ts);
    await insertNakanoKnowledgeDraft({
      escalationId: escalation.id,
      question: escalation.question,
      rawAnswer,
      draftTitle,
      draftBody,
      slackPermalink: permalink,
    });

    await slackBotPostMessage({
      channel,
      threadTs: ts,
      text: "📚 知識の文案を作りました。管理画面の「中野くん」→「承認待ち」から確認・承認してください",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[nakano-loop] event handling failed:", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: true });
  }
}
```

- [ ] **Step 2: 型チェックとビルド**

Run: `npx tsc --noEmit && npm run build`
Expected: 両方成功

- [ ] **Step 3: コミット**

```bash
git add app/api/webhooks/slack-events/route.ts
git commit -m "feat(中野くん): 📚リアクションで知識文案を作るSlackイベント受信を追加"
```

---

### Task 7: 管理API（承認待ち一覧・承認・却下）

**Files:**
- Create: `app/api/admin/nakano/drafts/route.ts`
- Create: `app/api/admin/nakano/drafts/[id]/route.ts`

- [ ] **Step 1: 一覧API**

`app/api/admin/nakano/drafts/route.ts`:

```typescript
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { loadPendingNakanoDrafts } from "@/lib/nakano-loop-data";

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

/** 承認待ちの知識ドラフト一覧（管理者のみ） */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ ok: false, error: "管理者のみ利用できます" }, { status: 403 });
  }
  try {
    const drafts = await loadPendingNakanoDrafts();
    return NextResponse.json({ ok: true, drafts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: 承認・却下API**

`app/api/admin/nakano/drafts/[id]/route.ts`:

```typescript
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { approveNakanoDraft, rejectNakanoDraft } from "@/lib/nakano-loop-data";

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

/** ドラフトの承認（編集込み）・却下（管理者のみ） */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ ok: false, error: "管理者のみ利用できます" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "不正な JSON です" }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;
  const action = o.action;

  try {
    if (action === "approve") {
      const title = typeof o.title === "string" ? o.title.trim() : "";
      const text = typeof o.body === "string" ? o.body.trim() : "";
      if (!title) {
        return NextResponse.json({ ok: false, error: "タイトルを入力してください" }, { status: 400 });
      }
      if (!text) {
        return NextResponse.json({ ok: false, error: "本文を入力してください" }, { status: 400 });
      }
      const knowledge = await approveNakanoDraft(params.id, { title, body: text });
      return NextResponse.json({ ok: true, knowledge });
    }
    if (action === "reject") {
      await rejectNakanoDraft(params.id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "action は approve か reject です" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 4: コミット**

```bash
git add app/api/admin/nakano/drafts
git commit -m "feat(中野くん): 承認待ちドラフトの一覧・承認・却下APIを追加"
```

---

### Task 8: 管理画面に【承認待ち】セクション

**Files:**
- Modify: `app/components/AdminNakanoSection.tsx`

- [ ] **Step 1: 型とカードコンポーネントを追加**

ファイル冒頭の型定義群の近くに追加（既存の `NakanoKnowledge` 型定義の下）:

```typescript
type NakanoDraftRow = {
  id: string;
  question: string;
  rawAnswer: string;
  draftTitle: string;
  draftBody: string;
  slackPermalink: string | null;
  createdAt: string;
};
```

既存のカード群（「届いた質問」カードなど）と同じ階層に、承認待ちカードを追加:

```typescript
/**
 * 知識の承認待ちドラフト。
 * Slackで📚が付いた担当回答のAI整形案を、ここで人が確認してから正式知識にする。
 * 0件のときはセクションごと出さない（画面を汚さない）。
 */
function DraftsCard() {
  const [rows, setRows] = useState<NakanoDraftRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { title: string; body: string }>>({});

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/nakano/drafts", { credentials: "include" });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; drafts?: NakanoDraftRow[]; error?: string } | null;
      if (!res.ok || !data?.ok || !Array.isArray(data.drafts)) {
        throw new Error(data?.error || "読み込みに失敗しました");
      }
      setRows(data.drafts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const getEdit = (r: NakanoDraftRow) => edits[r.id] ?? { title: r.draftTitle, body: r.draftBody };

  const approve = useCallback(
    async (r: NakanoDraftRow) => {
      const edit = edits[r.id] ?? { title: r.draftTitle, body: r.draftBody };
      if (!window.confirm(`「${edit.title}」を正式な知識として登録します。よろしいですか？`)) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/admin/nakano/drafts/${encodeURIComponent(r.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ action: "approve", title: edit.title, body: edit.body }),
        });
        const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (!res.ok || !data?.ok) throw new Error(data?.error || "承認に失敗しました");
        setRows((prev) => prev.filter((x) => x.id !== r.id));
        window.alert("知識に登録しました。中野くんは次の質問から使います");
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [edits]
  );

  const reject = useCallback(async (r: NakanoDraftRow) => {
    if (!window.confirm(`「${r.draftTitle}」の文案を破棄します。よろしいですか？`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/nakano/drafts/${encodeURIComponent(r.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "reject" }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error || "却下に失敗しました");
      setRows((prev) => prev.filter((x) => x.id !== r.id));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  if (rows.length === 0 && !error) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">知識の承認待ち（{rows.length}件）</h3>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          更新
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-600">
        Slackで📚を付けた回答の文案です。内容を確認・編集して承認すると、中野くんが次の質問から使います。
      </p>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-3 space-y-4">
        {rows.map((r) => {
          const edit = getEdit(r);
          return (
            <div key={r.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">元の質問</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">{r.question}</p>
              <p className="mt-2 text-xs text-slate-500">担当の返信（原文）</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-600">{r.rawAnswer}</p>
              <div className="mt-3 space-y-2">
                <input
                  type="text"
                  value={edit.title}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [r.id]: { ...edit, title: e.target.value } }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="知識のタイトル"
                />
                <textarea
                  value={edit.body}
                  rows={4}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [r.id]: { ...edit, body: e.target.value } }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="知識の本文"
                />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void approve(r)}
                  disabled={busy}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  承認して知識にする
                </button>
                <button
                  type="button"
                  onClick={() => void reject(r)}
                  disabled={busy}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  却下
                </button>
                {r.slackPermalink && (
                  <a
                    href={r.slackPermalink}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto text-xs text-slate-500 underline hover:text-slate-700"
                  >
                    Slackのスレッドを見る
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `AdminNakanoSection` 本体に組み込む**

`AdminNakanoSection`（L591付近）のJSXで、「知識の管理」カードの**直前**に `<DraftsCard />` を1行追加する。既存のカードの並び順・ラッパーdivはそのまま。

- [ ] **Step 3: 型チェックとビルド**

Run: `npx tsc --noEmit && npm run build`
Expected: 両方成功（AdminNakanoSection.tsxはJSXの入れ子が深いのでopen/closeタグ対応に注意）

- [ ] **Step 4: コミット**

```bash
git add app/components/AdminNakanoSection.tsx
git commit -m "feat(中野くん): 管理画面に知識の承認待ちセクションを追加"
```

---

### Task 9: 環境変数ドキュメント・作業ログ・最終検証

**Files:**
- Modify: `.env.example`
- Modify: `docs/SESSION_LOG.md`

- [ ] **Step 1: `.env.example` に追記**

既存のSlack系変数の近くに:

```bash
# 中野くん知識ループ（Slack Bot）。3つ揃うとエスカレ通知がBot投稿になり📚→知識化が有効になる。
# 未設定のときは従来どおり SLACK_WEBHOOK_NAKANO_URL への通知のみ（知識化は無効）。
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_NAKANO_CHANNEL_ID=
# 知識文案の整形に使うモデル（省略時 claude-haiku-4-5-20251001）
NAKANO_DRAFT_MODEL=
```

- [ ] **Step 2: 最終検証**

Run: `npx tsc --noEmit && npm run build`
Expected: 両方成功

- [ ] **Step 3: SESSION_LOG の先頭に追記**（依頼/変更箇所/検証/申し送り。Slackアプリ設定とSQL実行が未了である旨を必ず書く）

- [ ] **Step 4: コミット＆push**

```bash
git add -A
git commit -m "docs(中野くん): 知識ループの環境変数と作業ログを追記"
git push origin main
```

- [ ] **Step 5: ユーザー向け案内（チャットで行う）**
  1. `supabase-migration-nakano-knowledge-loop.sql` の全文をチャットにコードブロックで貼り、SQL Editorでの実行を依頼
  2. Slackアプリ作成を1ステップずつ案内（アプリ作成→スコープ`chat:write` `reactions:read` `channels:history`（プライベートなら`groups:history`）→インストール→Botをチャンネルに招待→Event Subscriptionsで`https://my-attendance-rho.vercel.app/api/webhooks/slack-events`を登録＋`reaction_added`購読→Vercelに`SLACK_BOT_TOKEN` `SLACK_SIGNING_SECRET` `SLACK_NAKANO_CHANNEL_ID`を設定→Redeploy）
  3. 実機確認: テスト質問でエスカレ→Bot投稿→スレッド回答→📚→承認待ちに出る→承認→中野くんに同じ質問して即答を確認

---

## セルフレビュー結果

- 設計書§4〜§8の要件はTask 1〜8で網羅（Bot化=T4、イベント受信=T6、整形=T5、承認UI=T7-8、フォールバック=T4）
- 型名の整合: `NakanoKnowledgeDraft` / `NakanoEscalation` / `findPendingDraftByEscalationId` はT3で定義しT6/T7で同名使用
- Slack再送対策は`x-slack-retry-num`即200＋pending重複チェックの二重（設計書§6を同期方式に更新済み）
- 新規npm依存なし（Slack APIはfetch直、整形は既存@anthropic-ai/sdk）
