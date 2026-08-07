/**
 * 中野くんのデータ読み書き（Supabase）。
 *
 * nakano_* テーブルは RLS 有効・ポリシー無しなので、anon キーからは一切読めない。
 * サーバー（service_role）経由でのみ動く。getUsersDb() は
 * サーバーでは service_role、ブラウザでは anon を返すため、
 * ここの関数はサーバー側からのみ呼ぶこと。
 *
 * 設計: docs/superpowers/specs/2026-08-06-nakano-bot-design.md
 */

import { getTodayJstDateString } from "@/lib/export-schedule";
import { getUsersDb } from "@/lib/supabase-data";
import {
  toNakanoKnowledge,
  toNakanoMessage,
  type DbNakanoKnowledge,
  type DbNakanoMessage,
  type NakanoCategory,
  type NakanoKnowledge,
  type NakanoMessage,
  type NakanoMessageRole,
  type NakanoMessageSource,
} from "@/lib/nakano";

const KNOWLEDGE_COLUMNS =
  "id, title, body, category, parent_id, show_as_step, is_active, sort_order, created_at, updated_at";

const MESSAGE_COLUMNS =
  "id, conversation_id, user_id, role, content, source, escalated, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, created_at";

/** PostgREST の1回あたり上限。これを超える件数はページングで取る */
const PAGE_SIZE = 1000;

function db() {
  const supabase = getUsersDb();
  if (!supabase) throw new Error("Supabase が設定されていません。");
  return supabase;
}

/* ------------------------------------------------------------------ *
 * 知識
 * ------------------------------------------------------------------ */

/**
 * 知識を全件読む。件数は多くても数百件想定だが、
 * 1000行の壁で静かに切れると「中野くんが一部の知識を忘れる」という
 * 気づきにくい不具合になるため、ページングして必ず全件取る。
 */
export async function loadNakanoKnowledge(): Promise<NakanoKnowledge[]> {
  const supabase = db();
  const out: NakanoKnowledge[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("nakano_knowledge")
      .select(KNOWLEDGE_COLUMNS)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as DbNakanoKnowledge[];
    out.push(...rows.map(toNakanoKnowledge));
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

export type NakanoKnowledgeInput = {
  title: string;
  body: string;
  category: NakanoCategory;
  parentId: string | null;
  showAsStep: boolean;
  isActive: boolean;
  sortOrder: number;
};

export async function insertNakanoKnowledge(input: NakanoKnowledgeInput): Promise<NakanoKnowledge> {
  const supabase = db();
  const { data, error } = await supabase
    .from("nakano_knowledge")
    .insert({
      title: input.title,
      body: input.body,
      category: input.category,
      parent_id: input.parentId,
      show_as_step: input.showAsStep,
      is_active: input.isActive,
      sort_order: input.sortOrder,
    })
    .select(KNOWLEDGE_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return toNakanoKnowledge(data as DbNakanoKnowledge);
}

export async function updateNakanoKnowledge(
  id: string,
  input: Partial<NakanoKnowledgeInput>
): Promise<NakanoKnowledge> {
  const supabase = db();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.body !== undefined) patch.body = input.body;
  if (input.category !== undefined) patch.category = input.category;
  if (input.parentId !== undefined) patch.parent_id = input.parentId;
  if (input.showAsStep !== undefined) patch.show_as_step = input.showAsStep;
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;

  const { data, error } = await supabase
    .from("nakano_knowledge")
    .update(patch)
    .eq("id", id)
    .select(KNOWLEDGE_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return toNakanoKnowledge(data as DbNakanoKnowledge);
}

export async function deleteNakanoKnowledge(id: string): Promise<void> {
  const supabase = db();
  const { error } = await supabase.from("nakano_knowledge").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ *
 * 会話
 * ------------------------------------------------------------------ */

/** 最新の会話がこれより古ければ新しい会話を作る（別の日の質問で文脈が混ざるのを防ぐ） */
const CONVERSATION_MAX_IDLE_MS = 24 * 60 * 60 * 1000;

export type NakanoConversation = {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
};

type DbNakanoConversation = {
  id: string;
  user_id: string;
  created_at: string | null;
  updated_at: string | null;
};

function toConversation(r: DbNakanoConversation): NakanoConversation {
  return {
    id: r.id,
    userId: r.user_id,
    createdAt: r.created_at ?? "",
    updatedAt: r.updated_at ?? "",
  };
}

/**
 * そのメンバーの「今の会話」を返す。24時間以上空いていれば新しく作る。
 */
export async function getOrCreateNakanoConversation(
  userId: string,
  now: Date = new Date()
): Promise<NakanoConversation> {
  const supabase = db();
  const { data, error } = await supabase
    .from("nakano_conversations")
    .select("id, user_id, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);

  const latest = (data ?? [])[0] as DbNakanoConversation | undefined;
  if (latest) {
    const updatedMs = Date.parse(latest.updated_at ?? "");
    if (Number.isFinite(updatedMs) && now.getTime() - updatedMs < CONVERSATION_MAX_IDLE_MS) {
      return toConversation(latest);
    }
  }

  const { data: created, error: insErr } = await supabase
    .from("nakano_conversations")
    .insert({ user_id: userId })
    .select("id, user_id, created_at, updated_at")
    .single();
  if (insErr) throw new Error(insErr.message);
  return toConversation(created as DbNakanoConversation);
}

export async function touchNakanoConversation(conversationId: string): Promise<void> {
  const supabase = db();
  // 失敗しても会話自体は成立しているので、握りつぶさず投げる（呼び出し側で判断する）。
  const { error } = await supabase
    .from("nakano_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ *
 * 発言
 * ------------------------------------------------------------------ */

export async function loadNakanoMessages(
  conversationId: string,
  limit = 40
): Promise<NakanoMessage[]> {
  const supabase = db();
  // 直近 limit 件を新しい順で取り、古い順に並べ直して返す。
  const { data, error } = await supabase
    .from("nakano_messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as DbNakanoMessage[]).map(toNakanoMessage).reverse();
}

export type NakanoMessageInput = {
  conversationId: string;
  userId: string;
  role: NakanoMessageRole;
  content: string;
  source: NakanoMessageSource;
  escalated?: boolean;
  inputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  outputTokens?: number | null;
};

export async function insertNakanoMessage(input: NakanoMessageInput): Promise<NakanoMessage> {
  const supabase = db();
  const { data, error } = await supabase
    .from("nakano_messages")
    .insert({
      conversation_id: input.conversationId,
      user_id: input.userId,
      role: input.role,
      content: input.content,
      source: input.source,
      escalated: input.escalated === true,
      input_tokens: input.inputTokens ?? null,
      cache_read_tokens: input.cacheReadTokens ?? null,
      cache_write_tokens: input.cacheWriteTokens ?? null,
      output_tokens: input.outputTokens ?? null,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return toNakanoMessage(data as DbNakanoMessage);
}

/**
 * 回数制限の判定に使う「AI宛の質問時刻（直近24時間）」を返す。
 * ステップ式クイック回答（source='step'）は API を呼んでいないので含めない。
 */
export async function loadNakanoAiAskTimesMs(
  userId: string,
  now: Date = new Date()
): Promise<number[]> {
  const supabase = db();
  const sinceIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("nakano_messages")
    .select("created_at")
    .eq("user_id", userId)
    .eq("role", "user")
    .eq("source", "ai")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { created_at: string | null }[])
    .map((r) => Date.parse(r.created_at ?? ""))
    .filter((ms) => Number.isFinite(ms));
}

/* ------------------------------------------------------------------ *
 * 管理画面用
 * ------------------------------------------------------------------ */

/** 誰の質問かが分からないとフォローも FAQ 追加もできないので、名前を添えて返す */
export type NakanoLogRow = NakanoMessage & { memberName: string };

/** 管理画面「届いた質問」。新しい順にページングで返す */
export async function loadNakanoRecentMessages(params: {
  limit: number;
  offset: number;
  escalatedOnly?: boolean;
}): Promise<{ rows: NakanoLogRow[]; hasMore: boolean }> {
  const supabase = db();
  const limit = Math.min(Math.max(1, params.limit), 200);
  let q = supabase
    .from("nakano_messages")
    .select(MESSAGE_COLUMNS)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(params.offset, params.offset + limit); // +1件多く取って hasMore を判定
  if (params.escalatedOnly) q = q.eq("escalated", true);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const messages = ((data ?? []) as DbNakanoMessage[]).map(toNakanoMessage);
  const page = messages.slice(0, limit);

  const idSet = new Set<string>();
  for (const m of page) idSet.add(m.userId);
  const userIds = Array.from(idSet);

  const nameById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: users, error: userErr } = await supabase
      .from("users")
      .select("id, name")
      .in("id", userIds);
    // 名前が引けなくてもログ自体は見せる（本文が読めることの方が優先）。
    if (!userErr) {
      for (const u of (users ?? []) as { id: string; name: string | null }[]) {
        nameById.set(u.id, (u.name ?? "").trim());
      }
    }
  }

  return {
    rows: page.map((m) => ({ ...m, memberName: nameById.get(m.userId) || "（不明）" })),
    hasMore: messages.length > limit,
  };
}

export type NakanoUsage = {
  month: string; // YYYY-MM
  aiQuestionCount: number;
  stepUseCount: number;
  escalatedCount: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
};

/**
 * 当月の使用状況。トークン数から概算費用を出す材料。
 * 件数は多くても月数千件なのでページングして全件集計する。
 */
export async function loadNakanoUsageForMonth(monthYm: string): Promise<NakanoUsage> {
  const supabase = db();
  const startIso = new Date(`${monthYm}-01T00:00:00+09:00`).toISOString();
  const [y, m] = monthYm.split("-").map((v) => Number(v));
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const endIso = new Date(`${nextMonth}-01T00:00:00+09:00`).toISOString();

  const usage: NakanoUsage = {
    month: monthYm,
    aiQuestionCount: 0,
    stepUseCount: 0,
    escalatedCount: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
  };

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("nakano_messages")
      .select("role, source, escalated, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as {
      role: string | null;
      source: string | null;
      escalated: boolean | null;
      input_tokens: number | null;
      cache_read_tokens: number | null;
      cache_write_tokens: number | null;
      output_tokens: number | null;
    }[];

    for (const r of rows) {
      if (r.role === "user" && r.source === "ai") usage.aiQuestionCount += 1;
      if (r.role === "user" && r.source === "step") usage.stepUseCount += 1;
      if (r.escalated === true) usage.escalatedCount += 1;
      usage.inputTokens += r.input_tokens ?? 0;
      usage.cacheReadTokens += r.cache_read_tokens ?? 0;
      usage.cacheWriteTokens += r.cache_write_tokens ?? 0;
      usage.outputTokens += r.output_tokens ?? 0;
    }

    if (rows.length < PAGE_SIZE) break;
  }

  return usage;
}

/** 1日ぶんの使用状況。日付は JST の YYYY-MM-DD */
export type NakanoDailyUsage = {
  date: string;
  aiQuestionCount: number;
  stepUseCount: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
};

/**
 * 直近 days 日ぶんを日別に集計する（当日を含む・新しい順で返す）。
 *
 * 月合計だけだと「今日いくら使ったか」が分からず、
 * 「1日いくらまで」という運用ルールの判断ができないので分けている。
 * 質問が無かった日も 0 の行を返す（表から日付が抜けると増減が読めない）。
 */
export async function loadNakanoDailyUsage(days: number, now: Date = new Date()): Promise<NakanoDailyUsage[]> {
  const supabase = db();
  const span = Math.max(1, Math.min(Math.round(days), 90));

  // JST の「今日」を基準に、span 日前の 00:00(JST) から今までを見る。
  const startYmd = getTodayJstDateString(new Date(now.getTime() - (span - 1) * 86_400_000));
  const startIso = new Date(`${startYmd}T00:00:00+09:00`).toISOString();

  const byDate = new Map<string, NakanoDailyUsage>();
  // 空の日も並ぶように、先に枠を作っておく。
  for (let i = 0; i < span; i += 1) {
    const ymd = getTodayJstDateString(new Date(now.getTime() - i * 86_400_000));
    byDate.set(ymd, {
      date: ymd,
      aiQuestionCount: 0,
      stepUseCount: 0,
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
    });
  }

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("nakano_messages")
      .select("role, source, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, created_at")
      .gte("created_at", startIso)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as {
      role: string | null;
      source: string | null;
      input_tokens: number | null;
      cache_read_tokens: number | null;
      cache_write_tokens: number | null;
      output_tokens: number | null;
      created_at: string;
    }[];

    for (const r of rows) {
      const ymd = getTodayJstDateString(new Date(r.created_at));
      const cur = byDate.get(ymd);
      // 枠外（未来日時など想定外の行）は捨てる。表の合計がずれる方が困る。
      if (!cur) continue;
      if (r.role === "user" && r.source === "ai") cur.aiQuestionCount += 1;
      if (r.role === "user" && r.source === "step") cur.stepUseCount += 1;
      cur.inputTokens += r.input_tokens ?? 0;
      cur.cacheReadTokens += r.cache_read_tokens ?? 0;
      cur.cacheWriteTokens += r.cache_write_tokens ?? 0;
      cur.outputTokens += r.output_tokens ?? 0;
    }

    if (rows.length < PAGE_SIZE) break;
  }

  return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? 1 : -1));
}
