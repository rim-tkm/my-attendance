/**
 * スレッド返信を「中野くんの知識」の文案に整形する。サーバー専用。
 *
 * スレッド返信の生文は「その人・その場面向け」（例:「はい、その場合は大丈夫です！」）で、
 * そのまま知識に入れても中野くんは使えない。質問＋回答から一般化した知識文に整える。
 * 整形は安価なモデルで十分（1件1円未満）。失敗時は呼び出し側が生文のまま保存する。
 *
 * 設計: docs/superpowers/specs/2026-08-07-nakano-knowledge-loop-design.md §6
 */

import Anthropic from "@anthropic-ai/sdk";

const DRAFT_DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export async function generateKnowledgeDraft(params: {
  question: string;
  rawAnswer: string;
}): Promise<{ title: string; body: string }> {
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (apiKey === "") throw new Error("ANTHROPIC_API_KEY が設定されていません。");
  const client = new Anthropic();
  const model = (process.env.NAKANO_DRAFT_MODEL ?? "").trim() || DRAFT_DEFAULT_MODEL;

  const res = await client.messages.create({
    model,
    max_tokens: 1000,
    system:
      "あなたは社内FAQの編集者です。メンバーからの質問と、担当者がSlackに書いた回答を渡します。" +
      "これを、AIアシスタントが今後同じ質問に答えるための知識項目に整形してください。\n" +
      "ルール:\n" +
      "- 特定の個人・日付・その場限りの文脈を除き、誰にでも当てはまる一般的な記述にする\n" +
      "- 回答に書かれていないことを推測で足さない。書かれていることだけを整理する\n" +
      "- タイトルは質問の要点を15文字前後で\n" +
      "- 本文は敬体で簡潔に。手順があれば番号付きにする\n" +
      '- 出力は次のJSONだけ: {"title": "...", "body": "..."}',
    messages: [
      {
        role: "user",
        content: `【質問】\n${params.question}\n\n【担当者の回答（Slackスレッド）】\n${params.rawAnswer}`,
      },
    ],
  });

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  // 前後に説明文が付いても最初のJSONオブジェクトだけ拾う
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("整形結果からJSONを取り出せませんでした");
  const parsed = JSON.parse(match[0]) as { title?: unknown; body?: unknown };
  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
  if (title === "" || body === "") throw new Error("整形結果のtitle/bodyが空です");
  return { title, body };
}
