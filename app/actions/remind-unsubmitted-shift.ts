"use server";

import { loginUser } from "@/lib/supabase-data";
import { runRemindUnsubmittedShiftReminder } from "@/lib/remind-unsubmitted-shifts";

export type RemindUnsubmittedShiftTestActionResult =
  | { ok: true; sent: boolean; count: number; rangeStart: string; rangeEnd: string }
  | { ok: false; error: string; detail?: string };

/**
 * 管理者のみ。Cron と同じ runRemindUnsubmittedShiftReminder を即時実行する。
 */
export async function remindUnsubmittedShiftTestAction(payload: {
  adminLoginId: string;
  adminPassword: string;
}): Promise<RemindUnsubmittedShiftTestActionResult> {
  const idTrim = typeof payload.adminLoginId === "string" ? payload.adminLoginId.trim() : "";
  const pass = typeof payload.adminPassword === "string" ? payload.adminPassword : "";
  if (!idTrim || !pass) {
    return { ok: false, error: "管理者のログインIDとパスワードが必要です" };
  }

  const member = await loginUser(idTrim, pass);
  if (!member || (member.loginAccount ?? "").toLowerCase() !== "admin") {
    return { ok: false, error: "管理者として認証できませんでした（ログインID・パスワードを確認してください）" };
  }

  const result = await runRemindUnsubmittedShiftReminder({ adminImmediateTest: true });
  if (!result.ok) {
    console.error("[remind-unsubmitted-shift test]", result.error, result.detail ?? "");
    return { ok: false, error: result.error, detail: result.detail };
  }

  return {
    ok: true,
    sent: result.sent,
    count: result.count,
    rangeStart: result.rangeStart,
    rangeEnd: result.rangeEnd,
  };
}
