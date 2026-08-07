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
      // エスカレ通知以外への📚、または対応表に記録が無い投稿（Webhook時代・記録失敗）。
      // 黙っていると担当は「押したのに無反応」で困るので、必ず理由を返す。
      await slackBotPostMessage({
        channel,
        threadTs: ts,
        text: "この投稿は知識化の対象外です（エスカレーション通知にのみ📚が使えます。古い通知や記録に失敗した通知も対象外です）",
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
