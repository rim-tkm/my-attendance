/**
 * LINEアカウント紐付け（個別コード方式）のデータ読み書き。サーバー専用。
 *
 * users テーブルに line_user_id / line_link_code / line_linked_at の3カラムを持つ
 * （supabase-migration-users-line-link.sql）。UNIQUE制約はDB側にもあるが、
 * コード採番時のローカル衝突回避とリトライは本ファイルで行う。
 * lib/nakano-loop-data.ts と同じ流儀（getUsersDb・nullガード付きdb()・throw new Error(error.message)）。
 *
 * 設計: docs/superpowers/specs/2026-08-07-line-account-linking-design.md §4〜§6
 */

import { getUsersDb } from "@/lib/supabase-data";

function db() {
  const supabase = getUsersDb();
  if (!supabase) throw new Error("Supabase が設定されていません。");
  return supabase;
}

/* ------------------------------------------------------------------ *
 * 一覧
 * ------------------------------------------------------------------ */

export type LineLinkRow = {
  id: string;
  name: string;
  lineUserId: string | null;
  lineLinkCode: string | null;
  lineLinkedAt: string | null;
  isIntern: boolean;
};

type DbLineLinkRow = {
  id: string;
  name: string | null;
  line_user_id: string | null;
  line_link_code: string | null;
  line_linked_at: string | null;
  is_intern: boolean | null;
};

function toLineLinkRow(r: DbLineLinkRow): LineLinkRow {
  return {
    id: r.id,
    name: (r.name ?? "").trim(),
    lineUserId: r.line_user_id,
    lineLinkCode: r.line_link_code,
    lineLinkedAt: r.line_linked_at,
    isIntern: r.is_intern === true,
  };
}

export async function loadLineLinkRows(): Promise<LineLinkRow[]> {
  const supabase = db();
  const { data, error } = await supabase
    .from("users")
    .select("id, name, line_user_id, line_link_code, line_linked_at, is_intern")
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as DbLineLinkRow[]).map(toLineLinkRow);
}

/* ------------------------------------------------------------------ *
 * コード発行
 * ------------------------------------------------------------------ */

const MAX_ISSUE_RETRIES = 10;

function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  if (error.code === "23505") return true;
  return (error.message ?? "").includes("uniq_users_line_link_code");
}

function randomLineLinkCode(usedCodes: Set<string>): string {
  // usedCodes 内で衝突しないコードを探す（最終防衛はDBのUNIQUE制約）
  for (let i = 0; i < 200; i++) {
    const num = 1000 + Math.floor(Math.random() * 9000);
    const code = `RIM-${num}`;
    if (!usedCodes.has(code)) return code;
  }
  // 200回引いても空きが見つからない異常系（実質起こり得ない）は諦めて最後の候補を返す
  const num = 1000 + Math.floor(Math.random() * 9000);
  return `RIM-${num}`;
}

/**
 * is_active かつ未発行（line_link_code IS NULL）のメンバーに RIM-1000〜9999 のコードを採番する。
 * 1行ずつUPDATEし、UNIQUE違反が出たら再抽選して最大10回リトライ。10回失敗したらその行はスキップ。
 * 戻り値は採番できた件数。
 */
export async function issueLineLinkCodes(): Promise<number> {
  const supabase = db();

  const { data: existingRows, error: existingError } = await supabase
    .from("users")
    .select("line_link_code")
    .not("line_link_code", "is", null);
  if (existingError) throw new Error(existingError.message);
  const usedCodes = new Set<string>(
    ((existingRows ?? []) as { line_link_code: string | null }[])
      .map((r) => r.line_link_code)
      .filter((c): c is string => !!c)
  );

  const { data: targetRows, error: targetError } = await supabase
    .from("users")
    .select("id")
    .eq("is_active", true)
    .is("line_link_code", null);
  if (targetError) throw new Error(targetError.message);
  const targetIds = ((targetRows ?? []) as { id: string }[]).map((r) => r.id);

  let issuedCount = 0;

  for (const userId of targetIds) {
    let succeeded = false;
    for (let attempt = 0; attempt < MAX_ISSUE_RETRIES; attempt++) {
      const code = randomLineLinkCode(usedCodes);
      usedCodes.add(code);
      const { error: updateError } = await supabase
        .from("users")
        .update({ line_link_code: code })
        .eq("id", userId);
      if (!updateError) {
        succeeded = true;
        issuedCount++;
        break;
      }
      if (!isUniqueViolation(updateError)) {
        throw new Error(updateError.message);
      }
      // UNIQUE違反: このコードは既に使われていた（ローカルSetに反映して次の抽選に回す）
    }
    if (!succeeded) {
      console.warn(`[line-link-data] コード採番に失敗（${MAX_ISSUE_RETRIES}回リトライ後もUNIQUE衝突）: userId=${userId}`);
    }
  }

  return issuedCount;
}

/* ------------------------------------------------------------------ *
 * 突合・紐付け
 * ------------------------------------------------------------------ */

export async function findUserByLineLinkCode(
  code: string
): Promise<{ id: string; name: string; lineUserId: string | null } | null> {
  const supabase = db();
  const { data, error } = await supabase
    .from("users")
    .select("id, name, line_user_id")
    .eq("line_link_code", code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id as string,
    name: ((data.name as string | null) ?? "").trim(),
    lineUserId: data.line_user_id as string | null,
  };
}

export async function findUserByLineUserId(
  lineUserId: string
): Promise<{ id: string; name: string } | null> {
  const supabase = db();
  const { data, error } = await supabase
    .from("users")
    .select("id, name")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id as string,
    name: ((data.name as string | null) ?? "").trim(),
  };
}

export async function linkLineUser(userId: string, lineUserId: string): Promise<void> {
  const supabase = db();
  const { error } = await supabase
    .from("users")
    .update({ line_user_id: lineUserId, line_linked_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

export async function unlinkLineUser(userId: string): Promise<void> {
  const supabase = db();
  const { error } = await supabase
    .from("users")
    .update({ line_user_id: null, line_linked_at: null })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}
