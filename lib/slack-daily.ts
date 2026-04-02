import { isWeekendYmd } from "@/lib/attendance";
import { getSupabase } from "@/lib/supabase";
import { postSlackIncomingWebhook, resolveSlackWebhookUrl, slackWebhookMissingMessage } from "@/lib/slack-webhook";

const SLACK_ENTRY_NONE = "なし";

/** 日本時間で「今日」の YYYY-MM-DD を返す */
export function getTodayJstDateString(): string {
  const now = new Date();
  const jst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const y = jst.getFullYear();
  const m = String(jst.getMonth() + 1).padStart(2, "0");
  const d = String(jst.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function hasRealSchedule(
  startPlanned: string | null | undefined,
  endPlanned: string | null | undefined
): boolean {
  const s = (startPlanned ?? "").trim();
  const e = (endPlanned ?? "").trim();
  return s !== "" && s !== SLACK_ENTRY_NONE && e !== "" && e !== SLACK_ENTRY_NONE;
}

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
    .select("id, name, is_active")
    .eq("is_active", true);

  const users = new Map((userRows ?? []).map((u) => [u.id, u]));
  const shifts = (shiftRows ?? []).filter(
    (s) =>
      hasRealSchedule(s.start_planned, s.end_planned) ||
      hasRealSchedule(s.start_planned2, s.end_planned2)
  );

  const nameSet = new Set<string>();
  for (const s of shifts) {
    const u = users.get(s.user_id);
    if (!u?.name?.trim()) continue;
    if (
      hasRealSchedule(s.start_planned, s.end_planned) ||
      hasRealSchedule(s.start_planned2, s.end_planned2)
    ) {
      nameSet.add(u.name.trim());
    }
  }

  const names = Array.from(nameSet).sort((a, b) => a.localeCompare(b, "ja"));
  const text =
    names.length === 0
      ? "おはようございます！本日の業務委託の稼働予定者はいません。"
      : `おはようございます！本日の業務委託の稼働予定者は ${names.map((n) => `${n}さん`).join("、")} です。`;

  const posted = await postSlackIncomingWebhook(webhookUrl, { text });
  if (!posted.ok) {
    return { ok: false, error: posted.error, detail: posted.detail };
  }

  return { ok: true, date: dateStr, sent: true };
}
