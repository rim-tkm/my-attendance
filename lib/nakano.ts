/**
 * AIアシスタント「中野くん」の純粋ロジック。
 * React も Supabase も import しない（型だけ Member を借りる）。テストしやすさのため。
 *
 * 設計: docs/superpowers/specs/2026-08-06-nakano-bot-design.md
 */

import type { Member } from "@/lib/attendance";

export type NakanoCategory = "operation" | "rule" | "billing" | "other";

export const NAKANO_CATEGORIES: NakanoCategory[] = ["operation", "rule", "billing", "other"];

export function nakanoCategoryLabel(c: NakanoCategory): string {
  switch (c) {
    case "operation":
      return "操作方法";
    case "rule":
      return "ルール";
    case "billing":
      return "請求";
    default:
      return "その他";
  }
}

export function normalizeNakanoCategory(raw: unknown): NakanoCategory {
  const t = typeof raw === "string" ? raw.trim() : "";
  return (NAKANO_CATEGORIES as string[]).includes(t) ? (t as NakanoCategory) : "other";
}

/** 知識1件。ステップUIのボタン＋回答と、AIに渡す知識を兼ねる */
export type NakanoKnowledge = {
  id: string;
  title: string;
  body: string;
  category: NakanoCategory;
  parentId: string | null;
  showAsStep: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type DbNakanoKnowledge = {
  id: string;
  title: string | null;
  body: string | null;
  category: string | null;
  parent_id: string | null;
  show_as_step: boolean | null;
  is_active: boolean | null;
  sort_order: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export function toNakanoKnowledge(r: DbNakanoKnowledge): NakanoKnowledge {
  return {
    id: r.id,
    title: (r.title ?? "").trim(),
    body: r.body ?? "",
    category: normalizeNakanoCategory(r.category),
    parentId: r.parent_id,
    showAsStep: r.show_as_step === true,
    isActive: r.is_active !== false,
    sortOrder: typeof r.sort_order === "number" ? r.sort_order : 0,
    // created_at / updated_at は NOT NULL だが、型の穴を空文字で塞いで下流の null 分岐を無くす。
    createdAt: r.created_at ?? "",
    updatedAt: r.updated_at ?? "",
  };
}

export type NakanoMessageRole = "user" | "assistant";
export type NakanoMessageSource = "ai" | "step";

export type NakanoMessage = {
  id: string;
  conversationId: string;
  userId: string;
  role: NakanoMessageRole;
  content: string;
  source: NakanoMessageSource;
  escalated: boolean;
  inputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  outputTokens: number | null;
  createdAt: string;
};

export type DbNakanoMessage = {
  id: string;
  conversation_id: string;
  user_id: string;
  role: string | null;
  content: string | null;
  source: string | null;
  escalated: boolean | null;
  input_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  output_tokens: number | null;
  created_at: string | null;
};

export function toNakanoMessage(r: DbNakanoMessage): NakanoMessage {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    userId: r.user_id,
    role: r.role === "assistant" ? "assistant" : "user",
    content: r.content ?? "",
    source: r.source === "step" ? "step" : "ai",
    escalated: r.escalated === true,
    inputTokens: typeof r.input_tokens === "number" ? r.input_tokens : null,
    cacheReadTokens: typeof r.cache_read_tokens === "number" ? r.cache_read_tokens : null,
    cacheWriteTokens: typeof r.cache_write_tokens === "number" ? r.cache_write_tokens : null,
    outputTokens: typeof r.output_tokens === "number" ? r.output_tokens : null,
    createdAt: r.created_at ?? "",
  };
}

/* ------------------------------------------------------------------ *
 * ステップ式クイック回答（API未使用）
 * ------------------------------------------------------------------ */

/** メンバーのブラウザへ渡すステップの1ノード。body はそのまま回答として表示される */
export type NakanoStepNode = {
  id: string;
  title: string;
  body: string;
  children: NakanoStepNode[];
};

/**
 * 知識一覧から、メンバーに配るステップ木を組み立てる。
 * - `showAsStep && isActive` の行だけを対象にする（AI専用の知識はメンバーに配らない）
 * - 親が対象外なら、その子も出さない（親が非公開なのに子だけ露出する事故を防ぐ）
 * - 各段は sortOrder 昇順、同値なら title 昇順で安定させる
 */
export function buildNakanoStepTree(all: NakanoKnowledge[]): NakanoStepNode[] {
  const visible = all.filter((k) => k.showAsStep && k.isActive);
  const byId = new Map(visible.map((k) => [k.id, k]));

  const childrenOf = new Map<string, NakanoKnowledge[]>();
  const roots: NakanoKnowledge[] = [];
  for (const k of visible) {
    // 親が非表示・非公開・存在しない場合はぶら下げ先が無いので出さない。
    if (k.parentId != null && !byId.has(k.parentId)) continue;
    if (k.parentId == null) {
      roots.push(k);
      continue;
    }
    const list = childrenOf.get(k.parentId) ?? [];
    list.push(k);
    childrenOf.set(k.parentId, list);
  }

  const sortNodes = (list: NakanoKnowledge[]): NakanoKnowledge[] =>
    [...list].sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      if (a.title !== b.title) return a.title < b.title ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });

  // 自己参照・循環でスタックが溢れないよう、辿った id を持って回る。
  const build = (node: NakanoKnowledge, seen: Set<string>): NakanoStepNode => {
    const nextSeen = new Set(seen);
    nextSeen.add(node.id);
    const kids = sortNodes(childrenOf.get(node.id) ?? []).filter((c) => !nextSeen.has(c.id));
    return {
      id: node.id,
      title: node.title,
      body: node.body,
      children: kids.map((c) => build(c, nextSeen)),
    };
  };

  return sortNodes(roots).map((r) => build(r, new Set()));
}

/* ------------------------------------------------------------------ *
 * エスカレーションの安全網
 * ------------------------------------------------------------------ */

/**
 * 返信本文が「担当に回す」意思を示しているかを判定する。
 *
 * エスカレーションの本来のトリガーは escalate_to_admin ツールの呼び出しだが、
 * モデルが気まぐれにツールを呼ばず「担当に確認して折り返しますね」等の一文だけを
 * 本文に書くことがある（2026-08-07 に実データで確認）。その場合、通知もラベルも出ず
 * メンバーの質問が誰にも届かないまま失われる。
 *
 * これは検知の主役ではなく、ツール未使用のときだけ効かせる保険。
 * 「担当に回す」自己申告の定型句だけを狭く拾い、通常の回答（画面案内・締切の説明など）は
 * 拾わないようにして、担当への誤通知（オオカミ少年化）を避ける。
 */
export function looksLikeNakanoDeferral(text: string): boolean {
  const t = text.replace(/\s/g, "");
  if (t === "") return false;
  return (
    // ① 担当に回す自己申告
    /担当(者|の方)?に(確認|お伝え|お聞き|聞い|相談|問い合わせ|連携|回し)/.test(t) ||
    /折り返し(ます|いたし|し|ますね)/.test(t) ||
    // ② 知識に無く答えられないと断るケース。
    //    個人実績の「実際の数値は見ていないので画面で確認を」という案内とは
    //    言い回しが違うため、こちらは拾わない（誤通知を避ける）。
    /(手元の)?(資料|情報)に(は)?(なく|ありませ|載って|ございませ)/.test(t) ||
    /推測で(は)?お答え/.test(t)
  );
}

/* ------------------------------------------------------------------ *
 * AIに渡す知識
 * ------------------------------------------------------------------ */

/**
 * 有効な知識を1つのテキストに連結する。system プロンプトの末尾に入る。
 * 並び順を安定させることが重要：プロンプトキャッシュは前方一致なので、
 * 順序が毎回揺れるとキャッシュが一切効かず入力コストが10倍になる。
 */
export function buildNakanoKnowledgeText(all: NakanoKnowledge[]): string {
  const active = [...all]
    .filter((k) => k.isActive)
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.id < b.id ? -1 : 1;
    });

  if (active.length === 0) return "";

  return active
    .map((k) => `## ${k.title}（${nakanoCategoryLabel(k.category)}）\n${k.body}`.trim())
    .join("\n\n");
}

/* ------------------------------------------------------------------ *
 * 対象者
 * ------------------------------------------------------------------ */

export function isNakanoAdmin(member: Member): boolean {
  return (member.loginAccount ?? "").trim().toLowerCase() === "admin";
}

/**
 * 中野くんを表示する対象か。
 * インターンは打刻対象外でシフトが無く、稼働時間帯の判定ができないため対象外
 * （質問は従来どおり公式LINEで受ける）。
 */
export function isNakanoAvailableTo(member: Member): boolean {
  if (member.isActive === false) return false;
  if (isNakanoAdmin(member)) return true;
  if (member.isIntern === true) return false;
  return true;
}
