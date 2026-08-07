import { NextResponse } from "next/server";
import { runNakanoKnowledgeCaptureFromModal } from "@/lib/nakano-loop-run";
import { findNakanoEscalationBySlackTs } from "@/lib/nakano-loop-data";
import {
  getNakanoSlackChannelId,
  slackBotOpenView,
  slackBotPostMessage,
  verifySlackSignature,
} from "@/lib/slack-bot";

export const dynamic = "force-dynamic";
// Slack API呼び出し（views.open / chat.postMessage 等）を数回叩くため、slack-events と同じ上限にしておく
export const maxDuration = 60;

const KNOWLEDGE_MODAL_CALLBACK_ID = "nakano_knowledge_modal";

/** 対象外(escalationが見つからない)時の案内文。runNakanoKnowledgeCaptureFromModal と同一文言 */
const NOT_FOUND_TEXT =
  "この投稿からは元の質問を特定できませんでした(エスカレーション通知とそのスレッドでのみ知識化が使えます。Bot導入前の古い通知も対象外です)";

/**
 * Slack Interactivity（block_actions / view_submission）の受け口。
 *
 * - block_actions: エスカレ通知の「📚 知識の文案を作る」ボタン押下。質問文を取得し、
 *   回答入力用のモーダルを開く（views.open）。
 * - view_submission: モーダルの「承認待ちに送る」送信。回答を承認待ちドラフトとして保存する。
 *
 * trigger_id は発行から3秒で失効するため、block_actions では「質問文取得（1クエリ）→
 * モーダルを開く」だけに絞り、重複チェック等は view_submission 側（lib/nakano-loop-run.ts の
 * runNakanoKnowledgeCaptureFromModal）に寄せている。
 *
 * 📚リアクション（app/api/webhooks/slack-events/route.ts）と「スレッド返信→📚/ボタン」の
 * 旧2ステップ経路（runNakanoKnowledgeCapture、AI整形あり）は変更せずそのまま残す。
 * このモーダル経路はAI整形を挟まない（view_submissionの3秒応答制限に収めるため）。
 *
 * 設計: docs/superpowers/specs/2026-08-07-nakano-knowledge-loop-design.md §6
 */
export async function POST(req: Request) {
  const rawBody = await req.text();

  // 署名検証は slack-events と同一方式。form-encoded の rawBody に対してそのまま検証する
  // （payload= の中身だけを取り出して検証してはいけない。Slackは生ボディ全体に署名している）。
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

  const payloadRaw = new URLSearchParams(rawBody).get("payload");
  if (!payloadRaw) {
    return NextResponse.json({ ok: true });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(payloadRaw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: true });
  }

  if (payload.type === "view_submission") {
    return handleViewSubmission(payload);
  }

  const actions = Array.isArray(payload.actions) ? (payload.actions as Record<string, unknown>[]) : [];
  const isTargetAction =
    payload.type === "block_actions" && actions[0]?.action_id === "nakano_make_knowledge";
  if (!isTargetAction) {
    return NextResponse.json({ ok: true });
  }

  const channelObj = (payload.channel ?? {}) as Record<string, unknown>;
  const messageObj = (payload.message ?? {}) as Record<string, unknown>;
  const channel = channelObj.id;
  const ts = messageObj.ts;
  const triggerId = payload.trigger_id;
  if (typeof channel !== "string" || typeof ts !== "string" || typeof triggerId !== "string") {
    return NextResponse.json({ ok: true });
  }

  // ボタンを設置しているのは中野くん専用チャンネルのみのはずだが、念のため一致チェックする
  const channelId = getNakanoSlackChannelId();
  if (channelId === undefined || channel !== channelId) {
    return NextResponse.json({ ok: true });
  }

  // trigger_id は発行から3秒で失効するため、モーダルを開く前に行うのは質問文取得の1クエリだけにする。
  // 重複チェック（承認待ち/承認済み）は view_submission 側で行う。
  let escalation;
  try {
    escalation = await findNakanoEscalationBySlackTs(channel, ts);
  } catch (e) {
    console.error("[nakano-loop] escalation lookup failed:", e instanceof Error ? e.message : String(e));
    escalation = null;
  }
  if (!escalation) {
    await slackBotPostMessage({ channel, threadTs: ts, text: NOT_FOUND_TEXT }).catch(() => undefined);
    return NextResponse.json({ ok: true });
  }

  const view = {
    type: "modal",
    callback_id: KNOWLEDGE_MODAL_CALLBACK_ID,
    private_metadata: JSON.stringify({ channel, ts }),
    title: { type: "plain_text", text: "知識の文案を作る" },
    submit: { type: "plain_text", text: "承認待ちに送る" },
    close: { type: "plain_text", text: "キャンセル" },
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*質問:* ${escalation.question}` } },
      {
        type: "input",
        block_id: "answer_block",
        label: { type: "plain_text", text: "回答" },
        element: {
          type: "plain_text_input",
          action_id: "answer_input",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "例: 駐車場代は経費になりません。移動にかかる費用は時給に含まれます",
          },
        },
        hint: {
          type: "plain_text",
          text: "この人向けの返事ではなく、誰にでも当てはまる書き方にすると、そのまま知識になります",
        },
      },
    ],
  };

  const opened = await slackBotOpenView(triggerId, view);
  if (!opened.ok) {
    console.warn("[nakano-loop] views.open failed:", opened.error);
    await slackBotPostMessage({
      channel,
      threadTs: ts,
      text: "文案作成の画面を開けませんでした。お手数ですが、もう一度ボタンを押してください",
    }).catch(() => undefined);
  }
  return NextResponse.json({ ok: true });
}

/** モーダル（回答入力）の送信を処理する */
async function handleViewSubmission(payload: Record<string, unknown>): Promise<Response> {
  const view = (payload.view ?? {}) as Record<string, unknown>;
  if (view.callback_id !== KNOWLEDGE_MODAL_CALLBACK_ID) {
    return NextResponse.json({});
  }

  let meta: { channel?: unknown; ts?: unknown };
  try {
    meta = JSON.parse(String(view.private_metadata ?? "")) as { channel?: unknown; ts?: unknown };
  } catch {
    return NextResponse.json({});
  }
  const channel = meta.channel;
  const ts = meta.ts;
  if (typeof channel !== "string" || typeof ts !== "string") {
    return NextResponse.json({});
  }

  const state = (view.state ?? {}) as Record<string, unknown>;
  const values = (state.values ?? {}) as Record<string, unknown>;
  const answerBlock = (values.answer_block ?? {}) as Record<string, unknown>;
  const answerInput = (answerBlock.answer_input ?? {}) as Record<string, unknown>;
  const answer = typeof answerInput.value === "string" ? answerInput.value.trim() : "";
  if (answer === "") {
    return NextResponse.json({
      response_action: "errors",
      errors: { answer_block: "回答を入力してください" },
    });
  }

  const userObj = (payload.user ?? {}) as Record<string, unknown>;
  const responderName =
    typeof userObj.username === "string" && userObj.username !== ""
      ? userObj.username
      : typeof userObj.name === "string" && userObj.name !== ""
        ? userObj.name
        : "担当者";

  const result = await runNakanoKnowledgeCaptureFromModal({ channel, ts, answer, responderName });
  if (result.kind === "errors") {
    return NextResponse.json({ response_action: "errors", errors: result.errors });
  }
  return NextResponse.json({ response_action: "clear" });
}
