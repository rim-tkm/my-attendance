import { getSupabase } from "@/lib/supabase";

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

export type SlackDailyResult = { ok: true; date: string } | { ok: false; error: string; detail?: string };

/**
 * Supabase の shifts（稼働予定）から指定日に実際の予定があるユーザーを抽出し、Slack に送信する。
 */
export async function sendSlackDailyForDate(dateStr: string): Promise<SlackDailyResult> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    return { ok: false, error: "SLACK_WEBHOOK_URL is not set" };
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

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const err = await res.text();
    return { ok: false, error: "Slack webhook failed", detail: err };
  }

  return { ok: true, date: dateStr };
}
