import { buildPlannedShiftListForDate, isWeekendYmd, type Shift } from "@/lib/attendance";
import { getSupabase } from "@/lib/supabase";
import { postSlackIncomingWebhook, resolveSlackWebhookUrl, slackWebhookMissingMessage } from "@/lib/slack-webhook";

type DbShiftRow = {
  id: string;
  user_id: string;
  date: string;
  start_planned: string | null;
  end_planned: string | null;
  start_planned2: string | null;
  end_planned2: string | null;
};

function dbRowToShift(r: DbShiftRow): Shift {
  return {
    id: r.id,
    userId: r.user_id,
    date: r.date,
    startPlanned: (r.start_planned ?? "").trim(),
    endPlanned: (r.end_planned ?? "").trim(),
    startPlanned2: r.start_planned2 != null && String(r.start_planned2).trim() !== "" ? String(r.start_planned2).trim() : undefined,
    endPlanned2: r.end_planned2 != null && String(r.end_planned2).trim() !== "" ? String(r.end_planned2).trim() : undefined,
  };
}

export { getTodayJstDateString } from "@/lib/export-schedule";

export type SlackDailyResult =
  | { ok: true; date: string; sent: true }
  | { ok: true; date: string; sent: false; skipReason: "weekend" }
  | { ok: false; error: string; detail?: string };

export type SendSlackDailyOptions = {
  /** true のとき土日でも送信する（管理画面テスト・?test=true の手動実行用）。Cron 本番では付けない。 */
  bypassWeekendSkip?: boolean;
};

/**
 * Supabase の shifts（稼働予定）から指定日に実際の予定があるユーザーを抽出し、Slack に送信する。
 * 本番 Cron は日本時間 朝 8:00 前後（その日の稼働予定を朝に共有する想定）を想定。
 * 土日（対象日の暦）では既定では送信しない（稼働がない前提）。`bypassWeekendSkip` で回避可。
 */
export async function sendSlackDailyForDate(dateStr: string, options?: SendSlackDailyOptions): Promise<SlackDailyResult> {
  if (!options?.bypassWeekendSkip && isWeekendYmd(dateStr)) {
    return { ok: true, date: dateStr, sent: false, skipReason: "weekend" };
  }

  const webhookUrl = resolveSlackWebhookUrl("daily");
  if (!webhookUrl) {
    return { ok: false, error: "Slack webhook is not configured", detail: slackWebhookMissingMessage("daily") };
  }

  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: "Supabase is not configured" };
  }

  const { data: shiftRows } = await supabase
    .from("shifts")
    .select("id, user_id, date, start_planned, end_planned, start_planned2, end_planned2")
    .eq("date", dateStr);

  const { data: userRows } = await supabase
    .from("users")
    .select("id, name, is_active, is_intern")
    .eq("is_active", true);

  const memberPick = (userRows ?? [])
    .filter((u) => u.is_active === true)
    .map((u) => ({
      id: u.id as string,
      name: (u.name as string | null) ?? "",
      isActive: true as const,
      isIntern: (u as { is_intern?: boolean | null }).is_intern === true,
    }));

  const shifts: Shift[] = (shiftRows ?? []).map((r) => dbRowToShift(r as DbShiftRow));
  const plannedList = buildPlannedShiftListForDate(shifts, dateStr, memberPick);

  const generalRows = plannedList.filter((r) => r.isIntern !== true);
  const internRows = plannedList.filter((r) => r.isIntern === true);
  const totalCount = plannedList.length;

  const header = "お疲れ様です。";
  const summaryLine = `👥 本日（${dateStr}）の稼働予定：合計 ${totalCount}名（一般 ${generalRows.length}名 / インターン ${internRows.length}名）`;

  const formatRow = (row: { name: string; plannedLabel: string; isIntern?: boolean }) => [
    `・${row.name} さん${row.isIntern ? "【インターン】" : ""}`,
    `　予定：${row.plannedLabel}`,
    "",
  ];

  let bodyLines: string[];
  if (totalCount === 0) {
    bodyLines = ["", summaryLine, "", "本日の業務委託の稼働予定者はいません。"];
  } else {
    bodyLines = ["", summaryLine, ""];
    if (generalRows.length > 0) {
      bodyLines.push(`🔹 一般メンバー（${generalRows.length}名）`, "");
      bodyLines.push(...generalRows.flatMap(formatRow));
    }
    if (internRows.length > 0) {
      bodyLines.push(`🔸 インターン生（${internRows.length}名）`, "");
      bodyLines.push(...internRows.flatMap(formatRow));
    }
  }
  const text = [header, ...bodyLines].join("\n").trimEnd();

  const posted = await postSlackIncomingWebhook(webhookUrl, { text });
  if (!posted.ok) {
    return { ok: false, error: posted.error, detail: posted.detail };
  }

  return { ok: true, date: dateStr, sent: true };
}
