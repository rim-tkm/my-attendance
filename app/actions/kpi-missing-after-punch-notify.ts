"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { tryNotifyKpiMissingAfterPunchForUser } from "@/lib/kpi-missing-after-punch-reminder";

/**
 * 終了打刻から猶予経過後も KPI が空のとき、Slack を 1 回だけ送る（本日・ログインユーザーのみ）。
 * クライアント: 終了打刻成功からの setTimeout、KPI タブ表示、KPI 保存直後などから呼ぶ。
 */
export async function notifyKpiMissingAfterPunchIfEligibleAction(): Promise<
  { ok: true; notified: boolean; reason?: string } | { ok: false; error: string; detail?: string }
> {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return { ok: false, error: "未ログインのためスキップしました" };
  }
  const r = await tryNotifyKpiMissingAfterPunchForUser(userId);
  if (!r.ok) {
    return { ok: false, error: r.error, detail: r.detail };
  }
  if (r.notified) {
    return { ok: true, notified: true };
  }
  return { ok: true, notified: false, reason: r.reason };
}
