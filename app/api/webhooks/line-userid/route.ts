import { NextResponse } from "next/server";
import { lineReplyText, verifyLineSignature } from "@/lib/line-bot";
import { findUserByLineLinkCode, findUserByLineUserId, linkLineUser } from "@/lib/line-link-data";

export const dynamic = "force-dynamic";

/**
 * LINE Messaging API の Webhook 受け口。
 * 「RIM-1234」形式のコードを送ってきたユーザーの line_user_id を紐付ける。
 *
 * コード形式に一致しないメッセージ（＝人間宛ての通常チャット）は完全に無視する
 * （担当者による手動チャット対応に委ねる。誤反応させない）。
 * DBエラーはそのイベントだけスキップして続行し、route全体は常に200を返す
 * （LINEの再送での多重処理を避けるため。冪等性は「既に本人と連携済み」チェックで担保）。
 *
 * 設計: docs/superpowers/specs/2026-08-07-line-account-linking-design.md §5・§8
 */
export async function POST(req: Request) {
  const rawBody = await req.text();

  const channelSecret = (process.env.LINE_CHANNEL_SECRET ?? "").trim();
  if (channelSecret === "") {
    console.warn("[line-userid] LINE_CHANNEL_SECRET が未設定です");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  const valid = verifyLineSignature({
    channelSecret,
    rawBody,
    signature: req.headers.get("x-line-signature") ?? "",
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

  const events = Array.isArray(payload.events) ? payload.events : [];

  for (const event of events) {
    await handleEvent(event as Record<string, unknown>);
  }

  return NextResponse.json({ ok: true });
}

/**
 * 全角英数記号を半角化して大文字化する。
 * 対象は Ａ-Ｚ ａ-ｚ ０-９（0xFEE0オフセットで機械的に変換できる範囲）と全角ハイフン－。
 */
function normalizeCode(text: string): string {
  return text
    .trim()
    .replace(/[Ａ-Ｚａ-ｚ０-９－]/g, (c) =>
      c === "－" ? "-" : String.fromCharCode(c.charCodeAt(0) - 0xfee0)
    )
    .toUpperCase();
}

const CODE_PATTERN = /^RIM-\d{4}$/;

async function handleEvent(event: Record<string, unknown>): Promise<void> {
  if (event.type !== "message") return;
  const message = (event.message ?? {}) as Record<string, unknown>;
  if (message.type !== "text") return;

  const text = message.text;
  const replyToken = event.replyToken;
  const source = (event.source ?? {}) as Record<string, unknown>;
  const lineUserId = source.userId;
  if (typeof text !== "string" || typeof replyToken !== "string" || typeof lineUserId !== "string") {
    return;
  }

  const code = normalizeCode(text);
  if (!CODE_PATTERN.test(code)) return; // 人間宛ての通常チャット。誤反応させない

  try {
    const target = await findUserByLineLinkCode(code);
    if (!target) {
      await reply(replyToken, "コードが見つかりませんでした。お手数ですが担当にご確認ください🙇‍♂️");
      return;
    }

    if (target.lineUserId !== null) {
      if (target.lineUserId === lineUserId) {
        await reply(replyToken, "すでに連携済みです😊");
      } else {
        await reply(replyToken, "このコードは既に使用されています。担当にご確認ください");
      }
      return;
    }

    const existingByLineUserId = await findUserByLineUserId(lineUserId);
    if (existingByLineUserId && existingByLineUserId.id !== target.id) {
      await reply(replyToken, "このLINEは別のアカウントと連携済みです。担当にご確認ください");
      return;
    }

    await linkLineUser(target.id, lineUserId);
    await reply(replyToken, `登録できました😊 ${target.name}さんとして連携しました`);
  } catch (e) {
    // DB例外はこのイベントだけスキップしてroute全体は200を維持する（LINE再送での多重処理を避けるため）
    console.error("[line-userid] イベント処理に失敗:", e);
  }
}

async function reply(replyToken: string, text: string): Promise<void> {
  const result = await lineReplyText(replyToken, text);
  if (!result.ok) {
    console.warn("[line-userid] reply失敗（紐付け自体は成立している可能性あり）:", result.error);
  }
}
