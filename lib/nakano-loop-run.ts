/**
 * 中野くん知識ループの本体処理。
 *
 * 📚リアクション（app/api/webhooks/slack-events/route.ts）と
 * 「📚 知識の文案を作る」ボタン（app/api/webhooks/slack-interactive/route.ts）の
 * 両方から呼ばれる共通処理。channel と ts（エスカレ通知 or その返信のいずれかのts）が
 * 確定した後の、親ts解決→escalation逆引き→重複チェック→AI整形→保存→案内までを担う。
 *
 * 設計: docs/superpowers/specs/2026-08-07-nakano-knowledge-loop-design.md §6
 */

import { generateKnowledgeDraft } from "@/lib/nakano-draft";
import {
  findActiveDraftByEscalationId,
  findNakanoEscalationBySlackTs,
  insertNakanoKnowledgeDraft,
} from "@/lib/nakano-loop-data";
import { notifyNakanoLoopFailure } from "@/lib/nakano-server";
import {
  slackBotFetchThreadReplies,
  slackBotGetPermalink,
  slackBotPostMessage,
  slackBotResolveThreadParentTs,
} from "@/lib/slack-bot";

/** view_submission の response_action に落とし込むための結果型 */
export type NakanoModalSubmitResult =
  | { kind: "clear" }
  | { kind: "errors"; errors: Record<string, string> };

/**
 * 知識化の本体。📚リアクションと「知識の文案を作る」ボタンの両方から呼ばれる。
 * どんな失敗でも throw しない（呼び出し側はSlackに200を返すだけでよい）。
 */
export async function runNakanoKnowledgeCapture(params: { channel: string; ts: string }): Promise<void> {
  const { channel, ts } = params;

  // 処理中に何が起きても Slack には 200 を返す（エラーを返すと再送で多重処理になる）
  try {
    let effectiveTs = ts;
    let escalation = await findNakanoEscalationBySlackTs(channel, ts);
    if (!escalation) {
      // 担当は「良い回答（＝スレッド内の返信）」に📚を付ける、またはボタンを押すことが多い。
      // 返信に付いた/押された場合は親（エスカレ通知）へ辿って引き直す。
      const parentTs = await slackBotResolveThreadParentTs(channel, ts);
      if (parentTs && parentTs !== ts) {
        escalation = await findNakanoEscalationBySlackTs(channel, parentTs);
        if (escalation) effectiveTs = parentTs;
      }
    }
    if (!escalation) {
      await slackBotPostMessage({
        channel,
        threadTs: ts,
        text: "この投稿からは元の質問を特定できませんでした(エスカレーション通知とそのスレッドでのみ知識化が使えます。Bot導入前の古い通知も対象外です)",
      });
      return;
    }

    const existing = await findActiveDraftByEscalationId(escalation.id);
    if (existing) {
      await slackBotPostMessage({
        channel,
        threadTs: effectiveTs,
        text:
          existing.status === "approved"
            ? "この質問は既に知識に登録されています(重複登録を防ぐため何もしませんでした)"
            : "この質問の文案は既に承認待ちにあります。管理画面の「中野くん」→「承認待ち」を確認してください",
      });
      return;
    }

    const replies = await slackBotFetchThreadReplies(channel, effectiveTs);
    if (replies.length === 0) {
      await slackBotPostMessage({
        channel,
        threadTs: effectiveTs,
        text: "先にこのスレッドに回答を書いてから知識化を実行してください",
      });
      return;
    }
    const rawAnswer = replies.join("\n");

    // 整形に失敗しても素材(担当の回答)を失わないことを最優先にする
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

    const permalink = await slackBotGetPermalink(channel, effectiveTs);
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
      threadTs: effectiveTs,
      text: "📚 知識の文案を作りました。管理画面の「中野くん」→「承認待ち」から確認・承認してください",
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[nakano-loop] knowledge capture failed:", detail);
    // 逆引き失敗には案内を返すのに、より深刻な障害が無音なのは非対称。
    // 再送は無視される設計なので、担当が📚を付け直せる/ボタンを押し直せるよう必ず知らせる
    await slackBotPostMessage({
      channel,
      threadTs: ts,
      text: "知識化の処理に失敗しました。お手数ですが、もう一度📚を付け直すか、ボタンを押し直してください",
    }).catch(() => undefined);
    await notifyNakanoLoopFailure(`知識化の処理に失敗: ${detail}`);
  }
}

/**
 * モーダル（「📚 知識の文案を作る」ボタン→入力ボックス）からの送信を保存する。
 * 📚リアクション/旧ボタン経路（runNakanoKnowledgeCapture）と違い、AI整形を挟まない
 * （view_submission はSlack側の3秒応答制限があり、AI呼び出しを待つと間に合わないため）。
 * タイトルは質問の先頭30字、本文は入力そのまま。
 *
 * view_submission の応答形式に合わせて、成功/入力エラーを NakanoModalSubmitResult で返す
 * （呼び出し側の route が response_action の JSON に変換する）。
 *
 * 重複チェック（findActiveDraftByEscalationId）はここでのみ行う。
 * モーダルを開く時点（block_actions）では trigger_id が発行から3秒で失効するため、
 * 質問文取得の1クエリだけに絞り、重複チェックはこの送信時点に寄せている。
 */
export async function runNakanoKnowledgeCaptureFromModal(params: {
  channel: string;
  ts: string;
  answer: string;
  responderName: string;
}): Promise<NakanoModalSubmitResult> {
  const { channel, ts, answer, responderName } = params;
  try {
    const escalation = await findNakanoEscalationBySlackTs(channel, ts);
    if (!escalation) {
      await slackBotPostMessage({
        channel,
        threadTs: ts,
        text: "この投稿からは元の質問を特定できませんでした(エスカレーション通知とそのスレッドでのみ知識化が使えます。Bot導入前の古い通知も対象外です)",
      }).catch(() => undefined);
      return { kind: "clear" };
    }

    const existing = await findActiveDraftByEscalationId(escalation.id);
    if (existing) {
      return {
        kind: "errors",
        errors: { answer_block: "この質問の文案は既に承認待ちまたは登録済みです" },
      };
    }

    const rawAnswer = `回答者: ${responderName}\n${answer}`;
    const draftTitle = escalation.question.slice(0, 30);
    const draftBody = answer;

    // permalink取得は失敗しても致命ではない一方、views.open→view_submission応答は
    // Slackの3秒制限があるため、AI整形なしでもここで足を引っ張らせない(取得しない)。
    await insertNakanoKnowledgeDraft({
      escalationId: escalation.id,
      question: escalation.question,
      rawAnswer,
      draftTitle,
      draftBody,
      slackPermalink: null,
    });

    await slackBotPostMessage({
      channel,
      threadTs: ts,
      text: `📚 ${responderName} さんの回答を承認待ちに入れました\n> ${answer}\n管理画面の「知識の承認待ち」から承認してください`,
    }).catch(() => undefined);

    return { kind: "clear" };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[nakano-loop] modal knowledge capture failed:", detail);
    await notifyNakanoLoopFailure(`知識化(モーダル)の処理に失敗: ${detail}`);
    return {
      kind: "errors",
      errors: { answer_block: "保存に失敗しました。時間を置いてもう一度お試しください" },
    };
  }
}
