/**
 * 中野くん知識ループ／Slack→LINE返信の本体処理。
 *
 * 📚リアクション（app/api/webhooks/slack-events/route.ts）と
 * 「✍️ 返信を作成」ボタン（app/api/webhooks/slack-interactive/route.ts）の
 * 両方から呼ばれる共通処理。channel と ts（エスカレ通知 or その返信のいずれかのts）が
 * 確定した後の、親ts解決→escalation逆引き→重複チェック→AI整形→保存→案内までを担う。
 *
 * runNakanoReplyFromModal はモーダル経路専用で、LINEプッシュ送信（設計書
 * docs/superpowers/specs/2026-08-07-slack-line-reply-design.md）を追加で担う。
 *
 * 設計: docs/superpowers/specs/2026-08-07-nakano-knowledge-loop-design.md §6
 *       docs/superpowers/specs/2026-08-07-slack-line-reply-design.md §4〜§6
 */

import { generateKnowledgeDraft } from "@/lib/nakano-draft";
import {
  claimLineReply,
  findActiveDraftByEscalationId,
  findNakanoEscalationBySlackTs,
  insertNakanoKnowledgeDraft,
  releaseLineReply,
} from "@/lib/nakano-loop-data";
import { getLineLinkByUserId } from "@/lib/line-link-data";
import { linePushText } from "@/lib/line-bot";
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
 * モーダル（「✍️ 返信を作成」ボタン→入力ボックス）からの送信を処理する。
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
 *
 * 処理順は **LINE送信 → 知識ドラフト作成 → スレッド記録**（設計書§4）。
 * LINEプッシュは取り返しがつかない（冪等でない・課金対象）ため最初に確定させ、
 * それ以降（ドラフト作成・スレッド記録）の失敗は warn に留めて処理を続ける。
 * ここで errors を返して呼び出し元にモーダルを再表示させると、担当が「送信」を
 * もう一度押してしまい LINE が二重に送られてしまうため。
 */
export async function runNakanoReplyFromModal(params: {
  channel: string;
  ts: string;
  answer: string;
  responderName: string;
  sendLine: boolean;
  saveKnowledge: boolean;
}): Promise<NakanoModalSubmitResult> {
  const { channel, ts, answer, responderName, sendLine, saveKnowledge } = params;

  if (!sendLine && !saveKnowledge) {
    // チェックボックス（options_block）の下にエラーを出したいので、そのブロックのキーで返す
    return {
      kind: "errors",
      errors: { options_block: "送信先（LINE）か知識追加のどちらかを選んでください" },
    };
  }

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

    // ① LINE送信（要求されていれば最優先で確定させる。何も保存していない時点での失敗なので
    // errors を返して再試行を促すのが最も安全）
    let lineSentToName: string | null = null;
    if (sendLine) {
      // モーダルを開いた時点(block_actions)ではなく、送信直前の状態で再確認する。
      // モーダルを開いたまま放置されている間に紐付けが解除される等の変化に対応するため。
      const lineLink = await getLineLinkByUserId(escalation.userId);
      if (!lineLink) {
        return {
          kind: "errors",
          errors: {
            options_block: "この方はLINE未連携のため送信できません。チェックを外して再送信してください",
          },
        };
      }

      // 送信権のclaim（押し直し・担当2人の同時操作で同じ回答が2通LINEに飛ぶ実経路をここで塞ぐ）。
      // 取れなかった＝既に他の呼び出しが送信済み（またはpush中）なので、ここで送らずに終える。
      const claimed = await claimLineReply(escalation.id);
      if (!claimed) {
        return {
          kind: "errors",
          errors: { options_block: "この質問には既にLINEで回答済みです（重複送信を防ぎました）" },
        };
      }

      const pushed = await linePushText(lineLink.lineUserId, `ご質問いただいた件、担当より回答します😊\n\n${answer}`);
      if (!pushed.ok) {
        console.warn("[nakano-loop] LINE push failed:", pushed.error);
        // claimを戻して再試行できるようにする（このpush失敗ではLINEは届いていないため、
        // claimを残したままだと担当が直しても二度と送れなくなる）
        await releaseLineReply(escalation.id);
        return {
          kind: "errors",
          errors: {
            options_block:
              "LINEの送信に失敗しました（通数上限・ブロック等の可能性）。時間を置くか、手動でLINEしてください",
          },
        };
      }
      lineSentToName = lineLink.name !== "" ? `${lineLink.name}さん` : "本人";
    }

    // ② 知識ドラフト作成（要求されていれば）。LINE送信が既に成功している場合、
    // ここでの失敗（重複含む）を errors にすると担当が「送信」を再度押して二重LINE送信になるため、
    // 続行してスレッド記録に「知識追加は失敗」を添えるだけにとどめる。
    let knowledgeSaved = false;
    let knowledgeFailed = false;
    // 重複（findActiveDraftByEscalationIdがヒット）は実エラーではないので分けて扱う。
    // 「失敗しました」と表示すると、実際は既に登録済みなのに担当が📚でやり直して混乱するため。
    let knowledgeDuplicate = false;
    if (saveKnowledge) {
      try {
        const existing = await findActiveDraftByEscalationId(escalation.id);
        if (existing) {
          if (lineSentToName === null) {
            return {
              kind: "errors",
              errors: { answer_block: "この質問の文案は既に承認待ちまたは登録済みです" },
            };
          }
          knowledgeDuplicate = true;
        } else {
          const rawAnswer = `回答者: ${responderName}\n${answer}`;
          // permalink取得は失敗しても致命ではない一方、views.open→view_submission応答は
          // Slackの3秒制限があるため、AI整形なしでもここで足を引っ張らせない(取得しない)。
          await insertNakanoKnowledgeDraft({
            escalationId: escalation.id,
            question: escalation.question,
            rawAnswer,
            draftTitle: escalation.question.slice(0, 30),
            draftBody: answer,
            slackPermalink: null,
          });
          knowledgeSaved = true;
        }
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        console.error("[nakano-loop] modal knowledge capture failed:", detail);
        if (lineSentToName === null) {
          await notifyNakanoLoopFailure(`知識化(モーダル)の処理に失敗: ${detail}`);
          return {
            kind: "errors",
            errors: { answer_block: "保存に失敗しました。時間を置いてもう一度お試しください" },
          };
        }
        knowledgeFailed = true;
        await notifyNakanoLoopFailure(`知識化(モーダル/LINE送信後)の処理に失敗: ${detail}`);
      }
    }

    // ③ スレッド記録（best-effort。失敗しても本体処理は成立している）
    let threadText: string;
    if (lineSentToName !== null) {
      // lineSentToName は既に「○○さん」または「本人」の形（fix8: 氏名未設定時に「本人さん」にならないよう呼び出し元で組み立て済み）
      threadText = `📤 ${lineSentToName}宛にLINEで回答を送信しました（回答者: ${responderName}）\n> ${answer}`;
      if (knowledgeSaved) {
        threadText += "\n📚 知識の承認待ちにも入れました";
      } else if (knowledgeDuplicate) {
        threadText += "\n（知識は既に承認待ち・登録済みです）";
      } else if (knowledgeFailed) {
        threadText += "\n（知識追加は失敗しました。📚リアクションでやり直せます）";
      }
    } else {
      threadText = `📚 ${responderName} さんの回答を承認待ちに入れました\n> ${answer}\n管理画面の「知識の承認待ち」から承認してください`;
    }
    await slackBotPostMessage({ channel, threadTs: ts, text: threadText }).catch(() => undefined);

    return { kind: "clear" };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[nakano-loop] modal reply failed:", detail);
    await notifyNakanoLoopFailure(`返信(モーダル)の処理に失敗: ${detail}`);
    return {
      kind: "errors",
      errors: { answer_block: "処理に失敗しました。時間を置いてもう一度お試しください" },
    };
  }
}
