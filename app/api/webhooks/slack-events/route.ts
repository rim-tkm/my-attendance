import { NextResponse } from "next/server";
import { runNakanoKnowledgeCapture } from "@/lib/nakano-loop-run";
import { getNakanoSlackChannelId, verifySlackSignature } from "@/lib/slack-bot";

export const dynamic = "force-dynamic";
// AI整形とSlack API数回で既定の関数上限を超えうる
export const maxDuration = 60;

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

  // 本体処理は lib/nakano-loop-run.ts に集約（ボタン起動 route と共通）。
  // どんな失敗でも throw しない実装なので、ここでは待って200を返すだけでよい。
  await runNakanoKnowledgeCapture({ channel, ts });
  return NextResponse.json({ ok: true });
}
