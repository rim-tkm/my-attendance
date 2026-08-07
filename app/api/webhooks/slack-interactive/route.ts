import { NextResponse } from "next/server";
import { runNakanoReplyFromModal } from "@/lib/nakano-loop-run";
import { findNakanoEscalationBySlackTs } from "@/lib/nakano-loop-data";
import { getLineLinkByUserId } from "@/lib/line-link-data";
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

/** 対象外(escalationが見つからない)時の案内文。runNakanoReplyFromModal と同一文言 */
const NOT_FOUND_TEXT =
  "この投稿からは元の質問を特定できませんでした(エスカレーション通知とそのスレッドでのみ知識化が使えます。Bot導入前の古い通知も対象外です)";

/** 送信オプション（checkboxes）の選択肢。value は view_submission 側の判定と対応させる */
const LINE_OPTION = { text: { type: "plain_text", text: "LINEで本人に送信" }, value: "send_line" };
const KNOWLEDGE_OPTION = {
  text: { type: "plain_text", text: "中野くんの知識に追加（承認待ちへ）" },
  value: "save_knowledge",
};

/**
 * Slack Interactivity（block_actions / view_submission）の受け口。
 *
 * - block_actions: エスカレ通知の「✍️ 返信を作成」ボタン押下。質問文とLINE連携状態を取得し、
 *   回答入力用のモーダルを開く（views.open）。
 * - view_submission: モーダルの「送信」送信。LINEへのプッシュ送信・承認待ちドラフト作成を行う。
 *
 * trigger_id は発行から3秒で失効するため、block_actions では「質問文・連携状態の取得（数クエリ）→
 * モーダルを開く」だけに絞り、実際の送信処理（LINE再確認・重複チェック等）は view_submission 側
 * （lib/nakano-loop-run.ts の runNakanoReplyFromModal）に寄せている。
 *
 * 📚リアクション（app/api/webhooks/slack-events/route.ts）と「スレッド返信→📚/ボタン」の
 * 旧2ステップ経路（runNakanoKnowledgeCapture、AI整形あり）は変更せずそのまま残す（LINE送信はしない）。
 * このモーダル経路はAI整形を挟まない（view_submissionの3秒応答制限に収めるため）。
 *
 * 設計: docs/superpowers/specs/2026-08-07-slack-line-reply-design.md §4〜§6
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

  // 連携状態はここでは「モーダルに何を出すか」の判定にだけ使う。実際の送信可否は
  // view_submission 側で改めて取り直して判定する（モーダル放置中の状態変化・改竄対策。設計書§4）。
  let lineLink: { lineUserId: string; name: string } | null = null;
  try {
    lineLink = await getLineLinkByUserId(escalation.userId);
  } catch (e) {
    console.warn("[nakano-loop] line link lookup failed:", e instanceof Error ? e.message : String(e));
    lineLink = null;
  }

  const optionsBlock = lineLink
    ? {
        type: "input",
        block_id: "options_block",
        optional: true,
        label: { type: "plain_text", text: "送信オプション" },
        element: {
          type: "checkboxes",
          action_id: "options_input",
          initial_options: [LINE_OPTION, KNOWLEDGE_OPTION],
          options: [LINE_OPTION, KNOWLEDGE_OPTION],
        },
      }
    : {
        type: "input",
        block_id: "options_block",
        optional: true,
        label: { type: "plain_text", text: "送信オプション" },
        element: {
          type: "checkboxes",
          action_id: "options_input",
          initial_options: [KNOWLEDGE_OPTION],
          options: [KNOWLEDGE_OPTION],
        },
      };

  const view = {
    type: "modal",
    callback_id: KNOWLEDGE_MODAL_CALLBACK_ID,
    private_metadata: JSON.stringify({ channel, ts }),
    title: { type: "plain_text", text: "返信を作成" },
    submit: { type: "plain_text", text: "送信" },
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
      ...(lineLink
        ? []
        : [
            {
              type: "context",
              elements: [
                { type: "mrkdwn", text: "⚠️ この方はLINE未連携のため、回答は手動でLINEしてください" },
              ],
            },
          ]),
      optionsBlock,
    ],
  };

  const opened = await slackBotOpenView(triggerId, view);
  if (!opened.ok) {
    console.warn("[nakano-loop] views.open failed:", opened.error);
    await slackBotPostMessage({
      channel,
      threadTs: ts,
      text: "返信作成の画面を開けませんでした。お手数ですが、もう一度ボタンを押してください",
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

  // options_block は optional な checkboxes なので、1つもチェックしていないと
  // selected_options が存在しない（undefined）ことがある。安全に既定[]へ倒す。
  const optionsBlock = (values.options_block ?? {}) as Record<string, unknown>;
  const optionsInput = (optionsBlock.options_input ?? {}) as Record<string, unknown>;
  const selectedOptions = Array.isArray(optionsInput.selected_options)
    ? (optionsInput.selected_options as Record<string, unknown>[])
    : [];
  const selectedValues = new Set(
    selectedOptions
      .map((o) => o.value)
      .filter((v): v is string => typeof v === "string")
  );
  const sendLine = selectedValues.has(LINE_OPTION.value);
  const saveKnowledge = selectedValues.has(KNOWLEDGE_OPTION.value);

  const result = await runNakanoReplyFromModal({ channel, ts, answer, responderName, sendLine, saveKnowledge });
  if (result.kind === "errors") {
    return NextResponse.json({ response_action: "errors", errors: result.errors });
  }
  return NextResponse.json({ response_action: "clear" });
}
