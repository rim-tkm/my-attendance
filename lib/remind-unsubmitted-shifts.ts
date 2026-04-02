import { getSupabase } from "@/lib/supabase";
import { postSlackIncomingWebhook, resolveSlackWebhookUrl, slackWebhookMissingMessage } from "@/lib/slack-webhook";
import { getTodayJstDateString } from "@/lib/export-schedule";
import { addWeeksToWeekStart, getMondayOfCalendarWeekForYmd, getWeekDates } from "@/lib/attendance";

type DbUserRow = {
  id: string;
  name: string | null;
  login_account: string | null;
  is_active: boolean | null;
  slack_id?: string | null;
};

/** PostgREST / Supabase の error を画面・JSON に渡せる文字列にする（[object Object] 防止） */
export function formatSupabaseError(err: unknown): string {
  if (err == null || err === false) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof e.message === "string" && e.message.trim()) parts.push(e.message.trim());
    if (typeof e.details === "string" && e.details.trim()) parts.push(e.details.trim());
    if (typeof e.hint === "string" && e.hint.trim()) parts.push(e.hint.trim());
    if (typeof e.code === "string" && e.code.trim()) parts.push(`code: ${e.code.trim()}`);
    if (parts.length > 0) return parts.join(" — ");
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

async function fetchUsersForReminder(supabase: NonNullable<ReturnType<typeof getSupabase>>): Promise<
  { ok: true; rows: DbUserRow[] } | { ok: false; error: unknown }
> {
  const withSlack = await supabase.from("users").select("id, name, login_account, is_active, slack_id");
  if (!withSlack.error) {
    return { ok: true, rows: (withSlack.data as DbUserRow[] | null) ?? [] };
  }

  console.error("[remind-unsubmitted] users query (with slack_id) failed:", formatSupabaseError(withSlack.error), withSlack.error);

  const basic = await supabase.from("users").select("id, name, login_account, is_active");
  if (basic.error) {
    console.error("[remind-unsubmitted] users query (fallback) failed:", formatSupabaseError(basic.error), basic.error);
    return { ok: false, error: basic.error };
  }

  const rows = ((basic.data as Omit<DbUserRow, "slack_id">[] | null) ?? []).map((u) => ({ ...u, slack_id: null }));
  return { ok: true, rows };
}

function hasShiftOnAnyDay(userId: string, rows: { userId: string; date: string }[], weekDates: string[]): boolean {
  const set = new Set(weekDates);
  return rows.some((s) => s.userId === userId && set.has(s.date));
}

/** slack_id が空・またはメンション用として不適切な値のときは表示名のみ（メンションなし）。 */
function reminderLineForUser(displayName: string, slackId: string | null | undefined): string {
  const name = displayName.trim() || "(名前なし)";
  const sid = (slackId ?? "").trim();
  if (!sid) return name;
  if (/^U[A-Z0-9]{8,}$/i.test(sid) || /^W[A-Z0-9]{8,}$/i.test(sid)) return `<@${sid}>`;
  return name;
}

export type RemindUnsubmittedShiftResult =
  | { ok: true; sent: true; count: number; rangeStart: string; rangeEnd: string }
  | { ok: true; sent: false; count: 0; rangeStart: string; rangeEnd: string }
  | { ok: false; error: string; detail?: string };

export type RunRemindUnsubmittedOptions = {
  /**
   * 管理画面のテストから実行するとき true。
   * Cron の曜日・時刻に依存せず、この瞬間のデータで翌週未入力者を抽出して送る（本文にテスト旨を付記）。
   */
  adminImmediateTest?: boolean;
};

/**
 * 翌週（月〜日）に shifts が1件もない業務委託ユーザーを抽出し、
 * いる場合のみ Slack Incoming Webhook に催促文とリストを送信する。
 * users.slack_id が有効な形式なら <@id>、空・不正な形式なら表示名のみ（メンションなし）。
 */
export async function runRemindUnsubmittedShiftReminder(
  options?: RunRemindUnsubmittedOptions
): Promise<RemindUnsubmittedShiftResult> {
  const webhookUrl = resolveSlackWebhookUrl("remind_unsubmitted");
  if (!webhookUrl) {
    return { ok: false, error: "Slack webhook is not configured", detail: slackWebhookMissingMessage("remind_unsubmitted") };
  }

  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: "Supabase is not configured" };
  }

  const todayJst = getTodayJstDateString();
  const thisMon = getMondayOfCalendarWeekForYmd(todayJst);
  const nextWeekMon = addWeeksToWeekStart(thisMon, 1);
  const weekDates = getWeekDates(nextWeekMon);
  const rangeStart = weekDates[0];
  const rangeEnd = weekDates[6];

  const [{ data: shiftRows, error: shiftErr }, userFetch] = await Promise.all([
    supabase.from("shifts").select("user_id, date").gte("date", rangeStart).lte("date", rangeEnd),
    fetchUsersForReminder(supabase),
  ]);

  if (shiftErr) {
    console.error("[remind-unsubmitted] shifts query failed:", formatSupabaseError(shiftErr), shiftErr);
    return { ok: false, error: "shifts query failed", detail: formatSupabaseError(shiftErr) };
  }

  if (!userFetch.ok) {
    return {
      ok: false,
      error: "users query failed",
      detail: formatSupabaseError(userFetch.error),
    };
  }

  const users = userFetch.rows;
  const shiftIndex = (shiftRows ?? []).map((r: { user_id: string; date: string }) => ({
    userId: r.user_id,
    date: r.date,
  }));

  const contractors = users.filter(
    (u) => u.is_active !== false && (u.login_account ?? "").toLowerCase() !== "admin"
  );

  const lines: string[] = [];
  for (const u of contractors) {
    if (hasShiftOnAnyDay(u.id, shiftIndex, weekDates)) continue;
    const name = (u.name ?? "").trim() || "(名前なし)";
    lines.push(reminderLineForUser(name, u.slack_id));
  }

  if (lines.length === 0) {
    return { ok: true, sent: false, count: 0, rangeStart, rangeEnd };
  }

  const head =
    options?.adminImmediateTest === true
      ? "【管理者テスト・即時送信】この時点のデータで翌週未入力者を抽出しています（曜日・時刻の制限はありません）。\n\n以下のメンバーの来週のシフトが未入力です。日曜23:59までに登録をお願いします。"
      : "以下のメンバーの来週のシフトが未入力です。日曜23:59までに登録をお願いします。";
  const body = [head, "", ...lines.map((line) => `・${line}`)].join("\n");

  const posted = await postSlackIncomingWebhook(webhookUrl, { text: body });
  if (!posted.ok) {
    return { ok: false, error: posted.error, detail: posted.detail };
  }

  return { ok: true, sent: true, count: lines.length, rangeStart, rangeEnd };
}
