/**
 * LINE Messaging API クライアント。サーバー専用。
 *
 * LINEアカウント紐付け（設計書 docs/superpowers/specs/2026-08-07-line-account-linking-design.md）で使う。
 * SDKは追加しない（新規ライブラリ禁止の方針）。fetch で直接叩く。
 * 流儀は lib/slack-bot.ts に合わせる。
 */

import { createHmac, timingSafeEqual } from "crypto";

export function isLineBotConfigured(): boolean {
  return (process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "").trim() !== "";
}

function channelAccessToken(): string {
  return (process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "").trim();
}

/**
 * LINE Webhook の署名検証。
 * Slack（v0方式・hexダイジェスト）と違い、LINEは channel secret での
 * rawBody の HMAC-SHA256 を **base64** で表したものをヘッダ `x-line-signature` に載せる。
 * `v0=` のようなプレフィックスは無く、タイムスタンプ検証もLINEの仕様には存在しないため行わない
 * （リプレイ対策はLINE側の責務）。
 */
export function verifyLineSignature(params: {
  channelSecret: string;
  rawBody: string;
  signature: string;
}): boolean {
  const digest = createHmac("sha256", params.channelSecret).update(params.rawBody).digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(params.signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * replyToken を使った返信。
 *
 * リトライはしない: replyToken は1回限り有効。リトライすると「タイムアウト判定だが
 * 実は成功」のケースで invalid token エラーになるだけで意味がなく、逆に二重返信の
 * リスクは無いが無駄。reply失敗は呼び出し側が warn ログで許容する（紐付け自体は成立している）。
 */
export async function lineReplyText(
  replyToken: string,
  text: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${channelAccessToken()}`,
      },
      body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[line-bot] reply failed:", res.status, body);
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.warn("[line-bot] reply failed:", error);
    return { ok: false, error };
  }
}
