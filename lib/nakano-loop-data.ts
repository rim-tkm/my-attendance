/**
 * 知識ループのデータ読み書き（Supabase）。サーバー専用。
 *
 * nakano_escalations / nakano_knowledge_drafts は RLS 有効・ポリシー無しなので
 * service_role（サーバー）からのみ読み書きできる。lib/nakano-data.ts と同じ流儀。
 *
 * 設計: docs/superpowers/specs/2026-08-07-nakano-knowledge-loop-design.md §5
 */

import { getUsersDb } from "@/lib/supabase-data";
import { insertNakanoKnowledge } from "@/lib/nakano-data";
import type { NakanoKnowledge } from "@/lib/nakano";

function db() {
  const supabase = getUsersDb();
  if (!supabase) throw new Error("Supabase が設定されていません。");
  return supabase;
}

/* ------------------------------------------------------------------ *
 * エスカレ投稿の対応表
 * ------------------------------------------------------------------ */

export type NakanoEscalation = {
  id: string;
  conversationId: string | null;
  userId: string;
  question: string;
  slackChannelId: string;
  slackTs: string;
  createdAt: string;
};

type DbNakanoEscalation = {
  id: string;
  conversation_id: string | null;
  user_id: string;
  question: string;
  slack_channel_id: string;
  slack_ts: string;
  created_at: string | null;
};

const ESCALATION_COLUMNS = "id, conversation_id, user_id, question, slack_channel_id, slack_ts, created_at";

function toNakanoEscalation(r: DbNakanoEscalation): NakanoEscalation {
  return {
    id: r.id,
    conversationId: r.conversation_id ?? null,
    userId: r.user_id,
    question: r.question,
    slackChannelId: r.slack_channel_id,
    slackTs: r.slack_ts,
    createdAt: r.created_at ?? "",
  };
}

// 書き込み時は必ず会話がある（エスカレはチャット中にしか起きない）ので input は non-null。
// 読み取り型が null 許可なのは会話削除後の SET NULL のため。
export async function insertNakanoEscalation(input: {
  conversationId: string;
  userId: string;
  question: string;
  slackChannelId: string;
  slackTs: string;
}): Promise<void> {
  const supabase = db();
  const { error } = await supabase.from("nakano_escalations").insert({
    conversation_id: input.conversationId,
    user_id: input.userId,
    question: input.question,
    slack_channel_id: input.slackChannelId,
    slack_ts: input.slackTs,
  });
  if (error) throw new Error(error.message);
}

/** 📚が付いた投稿の (channel, ts) から元の質問を逆引きする */
export async function findNakanoEscalationBySlackTs(
  channelId: string,
  ts: string
): Promise<NakanoEscalation | null> {
  const supabase = db();
  const { data, error } = await supabase
    .from("nakano_escalations")
    .select(ESCALATION_COLUMNS)
    .eq("slack_channel_id", channelId)
    .eq("slack_ts", ts)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toNakanoEscalation(data as DbNakanoEscalation) : null;
}

/* ------------------------------------------------------------------ *
 * 承認待ちドラフト
 * ------------------------------------------------------------------ */

export type NakanoDraftStatus = "pending" | "approved" | "rejected";

export type NakanoKnowledgeDraft = {
  id: string;
  escalationId: string | null;
  question: string;
  rawAnswer: string;
  draftTitle: string;
  draftBody: string;
  status: NakanoDraftStatus;
  slackPermalink: string | null;
  approvedKnowledgeId: string | null;
  createdAt: string;
  updatedAt: string;
};

type DbNakanoKnowledgeDraft = {
  id: string;
  escalation_id: string | null;
  question: string;
  raw_answer: string;
  draft_title: string;
  draft_body: string;
  status: string;
  slack_permalink: string | null;
  approved_knowledge_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const DRAFT_COLUMNS =
  "id, escalation_id, question, raw_answer, draft_title, draft_body, status, slack_permalink, approved_knowledge_id, created_at, updated_at";

function toNakanoKnowledgeDraft(r: DbNakanoKnowledgeDraft): NakanoKnowledgeDraft {
  const status: NakanoDraftStatus =
    r.status === "approved" || r.status === "rejected" ? r.status : "pending";
  return {
    id: r.id,
    escalationId: r.escalation_id,
    question: r.question,
    rawAnswer: r.raw_answer,
    draftTitle: r.draft_title,
    draftBody: r.draft_body,
    status,
    slackPermalink: r.slack_permalink,
    approvedKnowledgeId: r.approved_knowledge_id,
    createdAt: r.created_at ?? "",
    updatedAt: r.updated_at ?? "",
  };
}

/** 📚の重複押下で二重作成しないためのチェック */
export async function findPendingDraftByEscalationId(
  escalationId: string
): Promise<NakanoKnowledgeDraft | null> {
  const supabase = db();
  const { data, error } = await supabase
    .from("nakano_knowledge_drafts")
    .select(DRAFT_COLUMNS)
    .eq("escalation_id", escalationId)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toNakanoKnowledgeDraft(data as DbNakanoKnowledgeDraft) : null;
}

export async function insertNakanoKnowledgeDraft(input: {
  escalationId: string | null;
  question: string;
  rawAnswer: string;
  draftTitle: string;
  draftBody: string;
  slackPermalink: string | null;
}): Promise<NakanoKnowledgeDraft> {
  const supabase = db();
  const { data, error } = await supabase
    .from("nakano_knowledge_drafts")
    .insert({
      escalation_id: input.escalationId,
      question: input.question,
      raw_answer: input.rawAnswer,
      draft_title: input.draftTitle,
      draft_body: input.draftBody,
      slack_permalink: input.slackPermalink,
    })
    .select(DRAFT_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return toNakanoKnowledgeDraft(data as DbNakanoKnowledgeDraft);
}

export async function loadPendingNakanoDrafts(): Promise<NakanoKnowledgeDraft[]> {
  const supabase = db();
  const { data, error } = await supabase
    .from("nakano_knowledge_drafts")
    .select(DRAFT_COLUMNS)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as DbNakanoKnowledgeDraft[]).map(toNakanoKnowledgeDraft);
}

/**
 * 承認: 編集後のタイトル・本文で nakano_knowledge に正式登録し、ドラフトを approved にする。
 * FAQボタンには出さない（show_as_step=false）。出すかどうかは既存の知識管理UIで後から変えられる。
 */
export async function approveNakanoDraft(
  id: string,
  input: { title: string; body: string }
): Promise<NakanoKnowledge> {
  const supabase = db();

  // 先に「承認権」を取る。pending→approved に更新できた呼び出しだけが知識を作れる。
  // 順序を逆（知識INSERT→UPDATE）にすると、二重クリックや同時承認で
  // 知識が重複作成され、孤児が中野くんの回答に混入する。
  const { data: claimed, error: claimError } = await supabase
    .from("nakano_knowledge_drafts")
    .update({
      status: "approved",
      draft_title: input.title,
      draft_body: input.body,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending")
    .select(DRAFT_COLUMNS)
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) throw new Error("この文案は既に処理済みです（承認済みまたは却下済み）");

  let knowledge: NakanoKnowledge;
  try {
    knowledge = await insertNakanoKnowledge({
      title: input.title,
      body: input.body,
      category: "operation",
      parentId: null,
      showAsStep: false,
      isActive: true,
      sortOrder: 0,
    });
  } catch (e) {
    // 知識を作れなかったら承認を取り消して pending に戻す（再承認できるように）。
    // この巻き戻しまで失敗したら「approved なのに知識が無い」状態になるが、
    // ログに残るので運用で気づける（supabase-js にトランザクションは無い）。
    const { error: revertError } = await supabase
      .from("nakano_knowledge_drafts")
      .update({ status: "pending", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "approved");
    if (revertError) {
      console.error("[nakano-loop] 承認の巻き戻しに失敗:", revertError.message);
    }
    throw e;
  }

  // 知識IDの反映は best-effort。失敗しても知識と承認は成立している。
  const { error: linkError } = await supabase
    .from("nakano_knowledge_drafts")
    .update({ approved_knowledge_id: knowledge.id, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (linkError) {
    console.error("[nakano-loop] approved_knowledge_id の保存に失敗:", linkError.message);
  }

  return knowledge;
}

export async function rejectNakanoDraft(id: string): Promise<void> {
  const supabase = db();
  const { error } = await supabase
    .from("nakano_knowledge_drafts")
    .update({ status: "rejected", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
}
