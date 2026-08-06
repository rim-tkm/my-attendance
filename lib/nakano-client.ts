/**
 * 中野くんの Claude 呼び出し。サーバー専用。
 *
 * 設計: docs/superpowers/specs/2026-08-06-nakano-bot-design.md §5-C
 */

import Anthropic from "@anthropic-ai/sdk";
import type { NakanoSystemPromptBlock } from "@/lib/nakano-prompt";

/** 既定は Claude Opus 5。実ログを見てから環境変数1行で下位モデルに切り替えられる */
export const NAKANO_DEFAULT_MODEL = "claude-opus-5";

/**
 * thinking と回答テキストの合計上限。
 * effort=low でも、知識が長く質問が複雑だと思考に多く使われて回答が途中で切れる。
 * ストリーミングなのでHTTPタイムアウトの心配は無く、余裕を持たせる方が安い。
 */
const MAX_TOKENS = 12000;

/** 会話履歴として渡す直近件数。増やすほど文脈は保つが入力コストが増える */
export const NAKANO_HISTORY_LIMIT = 20;

export class NakanoNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY が設定されていません。");
    this.name = "NakanoNotConfiguredError";
  }
}

export function isNakanoConfigured(): boolean {
  return (process.env.ANTHROPIC_API_KEY ?? "").trim() !== "";
}

function getClient(): Anthropic {
  if (!isNakanoConfigured()) throw new NakanoNotConfiguredError();
  return new Anthropic();
}

/**
 * 「これは自分で答えず人に回す」とモデル自身に判断させるためのツール。
 *
 * キーワード一致にしないのは、「解約」「辞めたい」「やめようと思ってて」のような
 * 言い換えを人手で列挙しきれないため。文意で判断させる。
 */
const ESCALATE_TOOL = {
  name: "escalate_to_admin",
  description:
    "自分では答えられない質問、または報酬・契約・他人の情報・体調や人間関係の相談・不具合報告を受けたときに使う。" +
    "呼ぶと質問内容が担当者のSlackに届く。呼ぶときは同時に、メンバーへの短い一言も本文に書くこと。",
  input_schema: {
    type: "object" as const,
    properties: {
      reason: {
        type: "string",
        description: "なぜ自分で答えず担当に回すのか。担当者が見て判断できるように書く",
      },
      summary: {
        type: "string",
        description: "メンバーの質問の要約。担当者はこれを見て折り返す",
      },
    },
    required: ["reason", "summary"],
  },
};

export type NakanoHistoryTurn = { role: "user" | "assistant"; content: string };

/**
 * 履歴を Claude に渡せる形に整える。
 *
 * DBの行はそのままでは渡せない。中身が空の行（保存に失敗した回答・
 * ツールだけ呼んで本文を書かなかった回答）は 400 になり、
 * 先頭が assistant の配列も 400 になる。
 * どちらも「1回の書き込み失敗のあと、その会話が24時間まるごと壊れる」形で効いてくるので、
 * 渡す直前にここで落とす。
 */
export function sanitizeNakanoHistory(turns: NakanoHistoryTurn[]): NakanoHistoryTurn[] {
  const nonEmpty = turns.filter((t) => t.content.trim() !== "");
  const firstUser = nonEmpty.findIndex((t) => t.role === "user");
  return firstUser < 0 ? [] : nonEmpty.slice(firstUser);
}

export type NakanoStreamEvent =
  | { type: "text"; text: string }
  | { type: "escalated"; reason: string; summary: string }
  | {
      type: "done";
      fullText: string;
      /** 単価が違うので合算しない。合算すると概算費用が実際の10倍近くになる */
      inputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      outputTokens: number;
      /** "max_tokens" なら回答が途中で切れている */
      stopReason: string | null;
    };

/**
 * 回答を1文字ずつ流しながら生成する。
 *
 * 履歴はテキストだけを積む（thinking ブロックは保存していない）。
 * 推論の連続性は失われるが、tool_use と tool_result の対応漏れで
 * 400 が出る事故を構造的に起こさないという利点の方が大きい。
 */
export async function* streamNakanoReply(params: {
  systemBlocks: NakanoSystemPromptBlock[];
  history: NakanoHistoryTurn[];
  question: string;
  signal?: AbortSignal;
}): AsyncGenerator<NakanoStreamEvent> {
  const client = getClient();
  const model = (process.env.NAKANO_MODEL ?? "").trim() || NAKANO_DEFAULT_MODEL;

  // slice のあとに整える。先に整えてから切ると、切った結果また assistant 始まりになりうる。
  const history = sanitizeNakanoHistory(params.history.slice(-NAKANO_HISTORY_LIMIT));
  const messages: Anthropic.MessageParam[] = [
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: "user" as const, content: params.question },
  ];

  const stream = client.messages.stream(
    {
      model,
      max_tokens: MAX_TOKENS,
      system: params.systemBlocks as Anthropic.TextBlockParam[],
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      tools: [ESCALATE_TOOL],
      messages,
    },
    params.signal ? { signal: params.signal } : undefined
  );

  let fullText = "";
  for await (const event of stream) {
    if (event.type !== "content_block_delta") continue;
    if (event.delta.type !== "text_delta") continue;
    fullText += event.delta.text;
    yield { type: "text", text: event.delta.text };
  }

  const final = await stream.finalMessage();

  for (const block of final.content) {
    if (block.type !== "tool_use") continue;
    if (block.name !== ESCALATE_TOOL.name) continue;
    const input = (block.input ?? {}) as { reason?: unknown; summary?: unknown };
    yield {
      type: "escalated",
      reason: typeof input.reason === "string" ? input.reason : "",
      summary: typeof input.summary === "string" ? input.summary : "",
    };
  }

  yield {
    type: "done",
    fullText,
    inputTokens: final.usage.input_tokens,
    cacheReadTokens: final.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: final.usage.cache_creation_input_tokens ?? 0,
    outputTokens: final.usage.output_tokens,
    stopReason: final.stop_reason ?? null,
  };
}
