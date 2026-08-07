import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { buildNakanoKnowledgeText, looksLikeNakanoDeferral } from "@/lib/nakano";
import { NAKANO_LINE_FALLBACK } from "@/lib/nakano-access";
import { streamNakanoReply, type NakanoHistoryTurn } from "@/lib/nakano-client";
import {
  getOrCreateNakanoConversation,
  insertNakanoMessage,
  loadNakanoKnowledge,
  loadNakanoMessages,
  touchNakanoConversation,
} from "@/lib/nakano-data";
import { buildNakanoSystemBlocks, NAKANO_NOT_READY_MESSAGE } from "@/lib/nakano-prompt";
import {
  loadNakanoContext,
  notifyNakanoEscalation,
  notifyNakanoOutage,
  type NakanoContext,
} from "@/lib/nakano-server";

export const dynamic = "force-dynamic";

/** 1問あたりの入力上限。長文を貼られて入力コストが跳ねるのを防ぐ */
const MAX_QUESTION_LENGTH = 2000;

const OUTAGE_MESSAGE = `今つながりません。${NAKANO_LINE_FALLBACK}`;

/** ツールだけ呼んで本文を書かなかったときに代わりに出す一言 */
const ESCALATED_FALLBACK_TEXT = "担当に確認して折り返しますね。";

/**
 * 質問を受けて、回答を NDJSON（1行1JSON）で流し返す。
 *
 * 対象者・稼働時間帯・回数の判定は必ずここで行う。
 * 画面でボタンを隠すだけでは、このAPIを直接叩けば通ってしまうため。
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { message?: unknown } | null;
  const question = typeof body?.message === "string" ? body.message.trim() : "";
  if (question === "") {
    return NextResponse.json({ ok: false, error: "質問を入力してください" }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json(
      { ok: false, error: `質問は${MAX_QUESTION_LENGTH}文字までです。要点をまとめてください。` },
      { status: 400 }
    );
  }

  let ctx: NakanoContext;
  let knowledgeText: string;
  let conversationId: string;
  let history: NakanoHistoryTurn[];
  try {
    const loaded = await loadNakanoContext(userId);
    if (!loaded) {
      return NextResponse.json({ ok: false, error: "メンバーが見つかりません" }, { status: 404 });
    }
    if (!loaded.access.allowed) {
      return NextResponse.json({ ok: false, error: loaded.access.message }, { status: 403 });
    }
    ctx = loaded;

    const knowledge = await loadNakanoKnowledge();
    knowledgeText = buildNakanoKnowledgeText(knowledge);

    const conversation = await getOrCreateNakanoConversation(userId);
    conversationId = conversation.id;
    const past = await loadNakanoMessages(conversationId);
    // ステップ式で既に読んだ内容も履歴に含める。同じ案内を繰り返させないため。
    history = past.map((m) => ({ role: m.role, content: m.content }));

    // 回数を数えるのは role='user' かつ source='ai' の行なので、
    // Claude を呼ぶ前に必ず入れる。途中で落ちても1問ぶんは消費した扱いにする
    // （失敗時に無制限で再試行できてしまうのを防ぐ）。
    await insertNakanoMessage({
      conversationId,
      userId,
      role: "user",
      content: question,
      source: "ai",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  const memberName = ctx.member.name ?? "";
  const memberAccount = ctx.member.loginAccount ?? "";
  const remainingHour = Math.max(0, ctx.access.remainingHour - 1);
  const remainingDay = Math.max(0, ctx.access.remainingDay - 1);

  // パネルを閉じられたら Claude 側の生成も止める。
  // 止めないと、誰も読まない回答を最後まで生成して課金だけが発生する。
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let alive = true;
      const send = (obj: unknown): void => {
        if (!alive) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          // 受け手が既に居ない。以降の書き込みは全部やめる（enqueue を続けると例外が連鎖する）。
          alive = false;
        }
      };

      let fullText = "";
      let escalated = false;
      let inputTokens = 0;
      let cacheReadTokens = 0;
      let cacheWriteTokens = 0;
      let outputTokens = 0;
      let truncated = false;

      try {
        if (knowledgeText.trim() === "") {
          // 知識が空のうちは Claude を呼ばない。呼んでも「分かりません」しか返らず、
          // その分の費用だけがかかるため。
          fullText = NAKANO_NOT_READY_MESSAGE;
          send({ type: "text", text: fullText });
        } else {
          const systemBlocks = buildNakanoSystemBlocks(knowledgeText);
          for await (const ev of streamNakanoReply({
            systemBlocks,
            history,
            question,
            signal: abort.signal,
          })) {
            if (ev.type === "text") {
              send({ type: "text", text: ev.text });
              continue;
            }
            if (ev.type === "escalated") {
              escalated = true;
              // ツールだけ呼んで本文が空だと、画面に何も出ないまま
              // 「担当に届けました」だけが付く。必ず一言は出す。
              if (fullText.trim() === "") {
                fullText = ESCALATED_FALLBACK_TEXT;
                send({ type: "text", text: fullText });
              }
              send({ type: "escalated" });
              await notifyNakanoEscalation({
                memberName,
                memberAccount,
                question,
                reason: ev.reason,
                summary: ev.summary,
              });
              continue;
            }
            if (ev.fullText.trim() !== "") fullText = ev.fullText;
            inputTokens = ev.inputTokens;
            cacheReadTokens = ev.cacheReadTokens;
            cacheWriteTokens = ev.cacheWriteTokens;
            outputTokens = ev.outputTokens;
            truncated = ev.stopReason === "max_tokens";
          }
        }

        // 安全網: モデルが escalate_to_admin を呼ばず「担当に確認して折り返します」等の
        // 一文だけを本文に書いた場合、本来のトリガー（ツール呼び出し）が発火せず、
        // Slack通知もラベルも出ないまま質問が失われる（2026-08-07 に実データで確認）。
        // ツール未使用でも本文が担当対応を示していれば、ここで拾って必ず担当に回す。
        if (!escalated && looksLikeNakanoDeferral(fullText)) {
          escalated = true;
          send({ type: "escalated" });
          await notifyNakanoEscalation({
            memberName,
            memberAccount,
            question,
            reason: "AIが本文で担当対応を案内したがツール未使用のため、安全網で自動エスカレーション",
            summary: "",
          });
        }

        if (truncated) {
          // 黙って途中で終わると、メンバーは切れたことに気づかず誤解したまま行動する。
          const note = "\n\n（回答が長くなりすぎたため途中で切れました。分けて質問してください。）";
          fullText += note;
          send({ type: "text", text: note });
        }

        send({ type: "done", remainingHour, remainingDay });
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        const aborted = abort.signal.aborted;
        if (!aborted) {
          console.error("[nakano] chat failed:", detail);
          send({ type: "error", message: OUTAGE_MESSAGE });
          // 黙って壊れると誰も気づけないので、管理者に知らせる。
          await notifyNakanoOutage(detail);
          fullText = fullText || OUTAGE_MESSAGE;
        }
      } finally {
        // 途中で切れていても、そこまでの回答は残す。
        // 管理画面で「どこで止まったか」が見えないと原因が追えないため。
        try {
          await insertNakanoMessage({
            conversationId,
            userId,
            role: "assistant",
            // 空文字は次回以降の履歴を壊すので、必ず何か入れる。
            content: fullText.trim() === "" ? OUTAGE_MESSAGE : fullText,
            source: "ai",
            escalated,
            inputTokens: inputTokens || null,
            cacheReadTokens: cacheReadTokens || null,
            cacheWriteTokens: cacheWriteTokens || null,
            outputTokens: outputTokens || null,
          });
          await touchNakanoConversation(conversationId);
        } catch (saveErr) {
          console.error(
            "[nakano] failed to save assistant message:",
            saveErr instanceof Error ? saveErr.message : String(saveErr)
          );
        }
        alive = false;
        try {
          controller.close();
        } catch {
          // 受け手が既に居ない場合は閉じる対象も無い。
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      // プロキシに溜め込まれると1文字ずつ流す意味が無くなる。
      "X-Accel-Buffering": "no",
    },
  });
}
