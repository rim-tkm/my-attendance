"use server";

import { loginUser } from "@/lib/supabase-data";
import { sendSlackManualRoiReport } from "@/lib/slack-manual-report";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type SlackManualReportActionResult =
  | { ok: true; start: string; end: string }
  | { ok: false; error: string; detail?: string };

/**
 * ROI の「Slackにレポートを送信」。
 * NextAuth の Cookie に依存せず、Supabase の loginUser で管理者を再検証する（本番 Vercel で確実に動作）。
 */
export async function slackManualReportAction(payload: {
  startDate: string;
  endDate: string;
  memberIds: string[] | null;
  adminLoginId: string;
  adminPassword: string;
}): Promise<SlackManualReportActionResult> {
  const { adminLoginId, adminPassword } = payload;
  const idTrim = typeof adminLoginId === "string" ? adminLoginId.trim() : "";
  const pass = typeof adminPassword === "string" ? adminPassword : "";
  if (!idTrim || !pass) {
    return { ok: false, error: "管理者のログインIDとパスワードが必要です" };
  }

  const member = await loginUser(idTrim, pass);
  if (!member || (member.loginAccount ?? "").toLowerCase() !== "admin") {
    return { ok: false, error: "管理者として認証できませんでした（ログインID・パスワードを確認してください）" };
  }

  const { startDate, endDate, memberIds: rawMemberIds } = payload;
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    return { ok: false, error: "startDate / endDate は YYYY-MM-DD 形式で指定してください" };
  }

  let memberIds: string[] | null = null;
  if (Array.isArray(rawMemberIds)) {
    memberIds = rawMemberIds.filter((x): x is string => typeof x === "string" && x.length > 0);
  } else if (rawMemberIds === null || rawMemberIds === undefined) {
    memberIds = null;
  } else {
    return { ok: false, error: "memberIds は文字列の配列または null です" };
  }

  const result = await sendSlackManualRoiReport(startDate, endDate, memberIds);
  if (!result.ok) {
    return { ok: false, error: result.error, detail: "detail" in result ? result.detail : undefined };
  }
  return { ok: true, start: result.start, end: result.end };
}
