"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  buildKpiProductivityInstantLowAlertSlackText,
  formatExpectedValidCallsLabel,
  shouldAlertLowKpiProductivity,
  sumDecimalWorkHoursFromRawAttendance,
} from "@/lib/kpi-productivity-eval";
import { getKpiForDate, getKpiForUser } from "@/lib/attendance";
import {
  loadKpi,
  loadMembers,
  loadRecords,
  releaseKpiProductivityAlertSent,
  tryClaimKpiProductivityAlertSent,
} from "@/lib/supabase-data";
import { postSlackIncomingWebhook, resolveSlackWebhookUrl } from "@/lib/slack-webhook";
import { getSlackProductivityNotifyMentionLine } from "@/lib/slack-productivity-mentions";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 同一 Node インスタンス内で、同一ユーザー・同一日の afterSave アラート処理が重複起動しないようにする */
const productivityAfterSaveInFlight = new Map<
  string,
  Promise<{ ok: true; notified: boolean } | { ok: false; error: string }>
>();

type NotifyCoreOpts =
  | {
      mode: "afterSave";
      sessionUserId: string;
      /** true のとき Webhook 未設定でもエラーにせず notified: false（KPI 保存直後の本番用） */
      silentMissingWebhook?: boolean;
    }
  | {
      mode: "adminTest";
      memberId: string;
      forceSend: boolean;
      silentMissingWebhook?: boolean;
    };

type NotifyCoreSuccess = {
  ok: true;
  notified: boolean;
  workHours: number;
  validCalls: number;
  expectedCallsLabel: string;
  belowThreshold: boolean;
  skipped?: boolean;
  skipReason?: "not_below_threshold" | "no_work_hours" | "no_webhook" | "already_sent";
};

type NotifyCoreFail = { ok: false; error: string; detail?: string };

async function notifyKpiProductivitySlackCore(
  dateStr: string,
  opts: NotifyCoreOpts
): Promise<NotifyCoreSuccess | NotifyCoreFail> {
  const [records, kpiAll, membersOrNull] = await Promise.all([loadRecords(), loadKpi(), loadMembers()]);
  const members = membersOrNull ?? [];

  const statsUserId = opts.mode === "afterSave" ? opts.sessionUserId : opts.memberId;
  const workHoursStats = sumDecimalWorkHoursFromRawAttendance(records, statsUserId, dateStr);
  const kpiRowStats = getKpiForDate(getKpiForUser(kpiAll, statsUserId), dateStr);
  const validCallsStats = kpiRowStats?.validCalls ?? 0;
  const belowThresholdStats = shouldAlertLowKpiProductivity(validCallsStats, workHoursStats);
  const expectedCallsLabel = formatExpectedValidCallsLabel(workHoursStats);

  const memberName =
    (members.find((x) => x.id === statsUserId)?.name ?? "").trim() || "（氏名なし）";

  if (opts.mode === "adminTest") {
    const { forceSend } = opts;
    if (!forceSend) {
      if (!(workHoursStats > 0)) {
        return {
          ok: true,
          notified: false,
          skipped: true,
          skipReason: "no_work_hours",
          workHours: workHoursStats,
          validCalls: validCallsStats,
          expectedCallsLabel,
          belowThreshold: false,
        };
      }
      if (!belowThresholdStats) {
        return {
          ok: true,
          notified: false,
          skipped: true,
          skipReason: "not_below_threshold",
          workHours: workHoursStats,
          validCalls: validCallsStats,
          expectedCallsLabel,
          belowThreshold: false,
        };
      }
    }
  } else {
    if (!(workHoursStats > 0)) {
      return {
        ok: true,
        notified: false,
        skipped: true,
        skipReason: "no_work_hours",
        workHours: workHoursStats,
        validCalls: validCallsStats,
        expectedCallsLabel,
        belowThreshold: belowThresholdStats,
      };
    }
    if (!belowThresholdStats) {
      return {
        ok: true,
        notified: false,
        skipped: true,
        skipReason: "not_below_threshold",
        workHours: workHoursStats,
        validCalls: validCallsStats,
        expectedCallsLabel,
        belowThreshold: false,
      };
    }
  }

  const webhookUrl = resolveSlackWebhookUrl("productivity");
  if (!webhookUrl) {
    if (opts.silentMissingWebhook) {
      console.warn(
        "[kpi-productivity-alert] Slack webhook が未設定のため送信しません（SLACK_WEBHOOK_PRODUCTIVITY_URL / SLACK_WEBHOOK_URL）"
      );
      return {
        ok: true,
        notified: false,
        skipped: true,
        skipReason: "no_webhook",
        workHours: workHoursStats,
        validCalls: validCallsStats,
        expectedCallsLabel,
        belowThreshold: belowThresholdStats,
      };
    }
    return {
      ok: false,
      error: "Slack webhook が未設定です（SLACK_WEBHOOK_PRODUCTIVITY_URL または SLACK_WEBHOOK_URL）",
    };
  }

  if (opts.mode === "afterSave") {
    const claimed = await tryClaimKpiProductivityAlertSent(statsUserId, dateStr);
    if (!claimed) {
      return {
        ok: true,
        notified: false,
        skipped: true,
        skipReason: "already_sent",
        workHours: workHoursStats,
        validCalls: validCallsStats,
        expectedCallsLabel,
        belowThreshold: true,
      };
    }
  }

  const text = buildKpiProductivityInstantLowAlertSlackText({
    memberName,
    workHours: workHoursStats,
    validCalls: validCallsStats,
    mentionLine: getSlackProductivityNotifyMentionLine(),
  });
  const sent = await postSlackIncomingWebhook(webhookUrl, { text });
  if (!sent.ok) {
    if (opts.mode === "afterSave") {
      await releaseKpiProductivityAlertSent(statsUserId, dateStr);
    }
    console.error("[kpi-productivity-alert] Slack 送信失敗:", sent.error, sent.detail);
    return { ok: false, error: sent.error, detail: sent.detail };
  }

  return {
    ok: true,
    notified: true,
    workHours: workHoursStats,
    validCalls: validCallsStats,
    expectedCallsLabel,
    belowThreshold: belowThresholdStats,
  };
}

/**
 * メンバーが KPI を保存した直後に呼ぶ（クライアントから即時に実行する想定）。
 * 保存した本人の当日データのみを判定し、閾値未満のときだけ Slack に即時送信する。
 * 同一ユーザー・同一稼働日は DB 上で1回に制限（連打・複数インスタンスでも重複送信しない）。
 * 同一 Node 上の並行呼び出しは 1 本に合流する。
 */
export async function runKpiProductivityAlertAfterSave(input: {
  date: string;
}): Promise<{ ok: true; notified: boolean } | { ok: false; error: string }> {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return { ok: false, error: "未ログインのため通知をスキップしました" };
  }
  const dateStr = (input.date ?? "").trim();
  if (!DATE_RE.test(dateStr)) {
    return { ok: false, error: "日付が不正です" };
  }

  const dedupeKey = `${userId}\t${dateStr}`;
  const existing = productivityAfterSaveInFlight.get(dedupeKey);
  if (existing) return await existing;

  const job = (async (): Promise<{ ok: true; notified: boolean } | { ok: false; error: string }> => {
    const r = await notifyKpiProductivitySlackCore(dateStr, {
      mode: "afterSave",
      sessionUserId: userId,
      silentMissingWebhook: true,
    });
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, notified: r.notified };
  })();

  productivityAfterSaveInFlight.set(dedupeKey, job);
  job.finally(() => {
    if (productivityAfterSaveInFlight.get(dedupeKey) === job) productivityAfterSaveInFlight.delete(dedupeKey);
  });

  return await job;
}

export type KpiProductivityAdminTestResult =
  | (NotifyCoreSuccess & { ok: true })
  | { ok: false; error: string; detail?: string };

/**
 * 管理者のみ。指定メンバー・指定日の打刻・KPI で生産性低下アラート（本番と同じ Webhook・メンション体裁）をテスト送信する。
 * `forceSend` が false のときは本番と同様、閾値未満のときだけ送信する。
 */
export async function runKpiProductivityAlertAdminTestAction(payload: {
  memberId: string;
  date: string;
  forceSend?: boolean;
}): Promise<KpiProductivityAdminTestResult> {
  const session = await getServerSession(authOptions);
  const loginId = (session?.user as { loginId?: string } | undefined)?.loginId?.trim().toLowerCase();
  if (!session?.user || loginId !== "admin") {
    return { ok: false, error: "この操作は管理者（admin）のみが実行できます" };
  }

  const memberId = typeof payload.memberId === "string" ? payload.memberId.trim() : "";
  const dateStr = typeof payload.date === "string" ? payload.date.trim() : "";
  if (!UUID_RE.test(memberId)) {
    return { ok: false, error: "メンバーを選択してください" };
  }
  if (!DATE_RE.test(dateStr)) {
    return { ok: false, error: "日付を YYYY-MM-DD で指定してください" };
  }

  const members = (await loadMembers()) ?? [];
  const exists = members.some((m) => m.id === memberId && m.isActive !== false);
  if (!exists) {
    return { ok: false, error: "指定のメンバーが見つからないか、無効化されています" };
  }

  return notifyKpiProductivitySlackCore(dateStr, {
    mode: "adminTest",
    memberId,
    forceSend: payload.forceSend === true,
    silentMissingWebhook: false,
  });
}
