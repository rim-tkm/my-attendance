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

/**
 * POST系（chat.postMessage 等）。429/5xx/ネットワーク例外は最大3回リトライ。
 *
 * 注意: chat.postMessage は冪等ではないため、リトライで稀に二重投稿になりうる。
 * ここでは「エスカレ通知が届かない」方が「同じ通知が2回届く」より実害が大きいので、
 * リトライを優先する（重複はSlack上で無害）。
 */
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
        cache: "no-store",
      });
      if (res.status === 429 || res.status >= 500) {
        console.error("[slack-bot]", method, "HTTP", res.status);
        throw new Error(`HTTP ${res.status}`);
      }
      return (await res.json()) as SlackApiResult;
    },
    { maxAttempts: 3, baseDelayMs: 500, perAttemptTimeoutMs: 10_000 }
  );
}

/**
 * GET系（conversations.replies 等）。
 * Next.js App Router は GET fetch を既定でキャッシュするため、`cache: "no-store"` で
 * 明示的に無効化する（conversations.replies が古い返信一覧を返すのを防ぐ）。
 */
async function callSlackApiGet(method: string, params: Record<string, string>): Promise<SlackApiResult> {
  const qs = new URLSearchParams(params).toString();
  return withNetworkRetry(
    async () => {
      const res = await fetch(`https://slack.com/api/${method}?${qs}`, {
        headers: { Authorization: `Bearer ${botToken()}` },
        cache: "no-store",
      });
      if (res.status === 429 || res.status >= 500) {
        console.error("[slack-bot]", method, "HTTP", res.status);
        throw new Error(`HTTP ${res.status}`);
      }
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
    if (r.ok !== true) {
      console.error("[slack-bot] chat.postMessage failed:", String(r.error ?? "unknown"));
      return { ok: false, error: String(r.error ?? "unknown") };
    }
    return { ok: true, ts: String(r.ts ?? "") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 投稿へのパーマリンク。失敗しても致命ではないので null を返す */
export async function slackBotGetPermalink(channel: string, messageTs: string): Promise<string | null> {
  try {
    const r = await callSlackApiGet("chat.getPermalink", { channel, message_ts: messageTs });
    if (r.ok !== true) {
      console.warn("[slack-bot] chat.getPermalink failed:", String(r.error ?? "unknown"));
      return null;
    }
    const link = r.permalink;
    return typeof link === "string" && link !== "" ? link : null;
  } catch {
    return null;
  }
}

/**
 * スレッドの返信本文を時刻順で返す。
 * 親投稿（エスカレ通知）と Bot 自身の投稿（案内文）は除く。人間の回答だけが欲しい。
 *
 * 他の関数（slackBotPostMessage / slackBotGetPermalink）と違い、失敗時は throw する設計。
 * 呼び出し側が「API呼び出し自体の失敗」と「スレッドに返信が0件だった」を区別する必要があるため。
 *
 * limit: "50" — エスカレスレッドの返信が50件を超える運用は想定しない。
 * conversations.replies は古い順に返すため、超えた場合は新しい方（直近の返信、
 * 最終結論である可能性が高い）が欠落する。その規模になったらページネーション対応が必要。
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
