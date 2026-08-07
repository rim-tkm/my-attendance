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

import { randomInt } from "crypto";
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
  isActive: boolean;
};

type DbLineLinkRow = {
  id: string;
  name: string | null;
  line_user_id: string | null;
  line_link_code: string | null;
  line_linked_at: string | null;
  is_intern: boolean | null;
  is_active: boolean | null;
};

function toLineLinkRow(r: DbLineLinkRow): LineLinkRow {
  return {
    id: r.id,
    name: (r.name ?? "").trim(),
    lineUserId: r.line_user_id,
    lineLinkCode: r.line_link_code,
    lineLinkedAt: r.line_linked_at,
    isIntern: r.is_intern === true,
    isActive: r.is_active === true,
  };
}

/**
 * is_active=true のメンバーに加え、退職済みだが紐付けが残っている行（line_user_id が入っている）も見せる。
 * 管理画面から「退職したのにLINEが繋がったまま」の行を把握・取り消しできるようにするため。
 */
export async function loadLineLinkRows(): Promise<LineLinkRow[]> {
  const supabase = db();
  const { data, error } = await supabase
    .from("users")
    .select("id, name, line_user_id, line_link_code, line_linked_at, is_intern, is_active")
    .or("is_active.eq.true,line_user_id.not.is.null")
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

// 紛らわしい 0/1/I/O/L/U を除いた30字。メンバーが手入力（読み違え）する場合の誤読対策。
const CODE_CHARS = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_BODY_LENGTH = 8;

/**
 * RIM- + 8文字（文字集合30種）でコードを生成する。空間は30^8 ≒ 6.5×10^11 で総当たり不能
 * （4桁数字＝1万通りは数百回の試行で他人の枠を奪えてしまうため不可。レビュー指摘）。
 * 乱数は暗号学的に安全な `crypto.randomInt` を1文字ずつ使う（Math.random は予測可能なため全廃）。
 */
function randomLineLinkCode(usedCodes: Set<string>): string {
  const gen = () => {
    let body = "";
    for (let i = 0; i < CODE_BODY_LENGTH; i++) {
      body += CODE_CHARS[randomInt(0, CODE_CHARS.length)];
    }
    return `RIM-${body}`;
  };
  // usedCodes 内で衝突しないコードを探す（最終防衛はDBのUNIQUE制約）。
  // 空間が広大なため実質1回目で当たるが、念のため数回だけリトライする。
  for (let i = 0; i < 5; i++) {
    const code = gen();
    if (!usedCodes.has(code)) return code;
  }
  return gen();
}

/**
 * is_active かつ未発行（line_link_code IS NULL）のメンバーに RIM-XXXXXXXX 形式のコードを採番する。
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
  // is_active=true 限定: 退職者に発行済みのコードが残っていても紐付けさせない（修正5）
  const { data, error } = await supabase
    .from("users")
    .select("id, name, line_user_id")
    .eq("line_link_code", code)
    .eq("is_active", true)
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

/** 質問者のLINE連携状態。モーダルの出し分けと送信時の再確認に使う */
export async function getLineLinkByUserId(
  userId: string
): Promise<{ lineUserId: string; name: string } | null> {
  const supabase = db();
  const { data, error } = await supabase
    .from("users")
    .select("id, name, line_user_id")
    .eq("id", userId)
    .not("line_user_id", "is", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    lineUserId: data.line_user_id as string,
    name: ((data.name as string | null) ?? "").trim(),
  };
}

/** 紐付け。line_user_id が未設定の行だけを更新し、勝てたかを返す（同時送信の後勝ち上書きを防ぐ） */
export async function linkLineUser(userId: string, lineUserId: string): Promise<boolean> {
  const supabase = db();
  const { data, error } = await supabase
    .from("users")
    .update({ line_user_id: lineUserId, line_linked_at: new Date().toISOString(), line_link_code: null })
    .eq("id", userId)
    .is("line_user_id", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data !== null;
}

export async function unlinkLineUser(userId: string): Promise<void> {
  const supabase = db();
  const { error } = await supabase
    .from("users")
    .update({ line_user_id: null, line_linked_at: null })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

/**
 * 1人にコードを再発行する（取り消し後・紛失時用）。既存コードは上書きされ古いものは無効になる。
 * UNIQUE衝突時は再抽選してリトライする（issueLineLinkCodesと同じ流儀）。
 */
export async function reissueLineLinkCode(userId: string): Promise<string> {
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

  for (let attempt = 0; attempt < MAX_ISSUE_RETRIES; attempt++) {
    const code = randomLineLinkCode(usedCodes);
    usedCodes.add(code);
    const { error: updateError } = await supabase.from("users").update({ line_link_code: code }).eq("id", userId);
    if (!updateError) return code;
    if (!isUniqueViolation(updateError)) {
      throw new Error(updateError.message);
    }
    // UNIQUE違反: このコードは既に使われていた。次の抽選に回す
  }
  throw new Error(`コード再発行に失敗しました（${MAX_ISSUE_RETRIES}回リトライ後もUNIQUE衝突）`);
}
