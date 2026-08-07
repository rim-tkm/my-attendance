import { NextResponse } from "next/server";
import { lineReplyText, verifyLineSignature } from "@/lib/line-bot";
import { findUserByLineLinkCode, findUserByLineUserId, linkLineUser } from "@/lib/line-link-data";
import { postSlackIncomingWebhook, resolveSlackWebhookUrl } from "@/lib/slack-webhook";

export const dynamic = "force-dynamic";

/** 失敗系の返信は理由を問わずこの1文に統一する（見つからない/使用済み/別アカウント連携済みを区別させない。理由はconsole.warnにのみ残す） */
const LINK_FAILURE_TEXT = "このコードでは連携できませんでした。お手数ですが担当にご確認ください🙇‍♂️";

/**
 * LINE Messaging API の Webhook 受け口。
 * 「RIM-XXXXXXXX」形式のコードを送ってきたユーザーの line_user_id を紐付ける。
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
 * 全角英数記号を半角化し、ハイフン類の表記ゆれを吸収してから大文字化する。
 * - Ａ-Ｚ ａ-ｚ ０-９ ／ 全角ハイフン－ … 0xFEE0オフセットで機械的に変換できる範囲
 * - ー（長音記号）／－(U+2212 MINUS SIGN)／‐(U+2010 HYPHEN)／—(EM DASH)／–(EN DASH)
 *   … スマホ入力・コピペで紛れ込みやすいハイフン類を "-" に正規化する
 * I→1 / O→0 / L→1 / U→V のような紛らわしい文字の読み替えは行わない
 * （コード生成側 lib/line-link-data.ts で 0/1/I/O/L/U を最初から除外しているため不要）。
 */
function normalizeCode(text: string): string {
  return text
    .trim()
    .replace(/[Ａ-Ｚａ-ｚ０-９－]/g, (c) =>
      c === "－" ? "-" : String.fromCharCode(c.charCodeAt(0) - 0xfee0)
    )
    .replace(/[ー−‐—–]/g, "-")
    .toUpperCase();
}

// 正規化後は大文字のみで判定すればよい（コード生成の文字集合と一致させる）
const CODE_PATTERN = /^RIM-[0-9A-Z]{8}$/;

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
  // 1:1トーク限定。グループ/ルームで晒されたコードを他人が拾って紐付けてしまうのを防ぐ
  if (source.type !== "user") return;

  const code = normalizeCode(text);
  if (!CODE_PATTERN.test(code)) return; // 人間宛ての通常チャット。誤反応させない

  try {
    // 冪等チェックを先行: 送信者のLINEが既に誰かと紐付いていれば、コード照合前に「すでに連携済み」を返す
    // （LINE再送・コード再送を吸収する。この時点では失敗/成功どちらの情報も外部に漏れない）
    const alreadyLinked = await findUserByLineUserId(lineUserId);
    if (alreadyLinked) {
      await reply(replyToken, "すでに連携済みです😊");
      return;
    }

    const target = await findUserByLineLinkCode(code);
    if (!target) {
      console.warn(`[line-userid] コード未一致（未発行/退職者/入力ミス）: code=${code}`);
      await reply(replyToken, LINK_FAILURE_TEXT);
      return;
    }

    const linked = await linkLineUser(target.id, lineUserId);
    if (!linked) {
      // target.lineUserId が既に埋まっていた（使用済み）か、同時送信で他イベントに先を越された
      console.warn(
        `[line-userid] 紐付け失敗（使用済みコード or 競合）: userId=${target.id}, lineUserIdAlready=${target.lineUserId}`
      );
      await reply(replyToken, LINK_FAILURE_TEXT);
      return;
    }

    await reply(replyToken, `登録できました😊 ${target.name}さんとして連携しました`);
    await notifyLinkSuccess(target.name);
  } catch (e) {
    // DB例外はこのイベントだけスキップしてroute全体は200を維持する（LINE再送での多重処理を避けるため）
    console.error("[line-userid] イベント処理に失敗:", e);
  }
}

/** 連携成功を管理者へbest-effortで通知する。誤紐付けに人間が気付ける最後の砦（失敗はwarnのみ、紐付け自体はロールバックしない） */
async function notifyLinkSuccess(memberName: string): Promise<void> {
  try {
    const url = resolveSlackWebhookUrl("nakano");
    if (!url) return;
    const result = await postSlackIncomingWebhook(url, { text: `🔗 LINE連携: ${memberName}さんが連携しました` });
    if (!result.ok) {
      console.warn("[line-userid] 連携成功のSlack通知に失敗:", result.error);
    }
  } catch (e) {
    console.warn("[line-userid] 連携成功のSlack通知で例外:", e);
  }
}

async function reply(replyToken: string, text: string): Promise<void> {
  const result = await lineReplyText(replyToken, text);
  if (!result.ok) {
    console.warn("[line-userid] reply失敗（紐付け自体は成立している可能性あり）:", result.error);
  }
}
