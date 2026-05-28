import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  getMondayOfCalendarWeekForYmd,
  getSubmittableShiftWeekMondays,
  isWeekOpenForEntry,
  isWeekendYmd,
  SHIFT_ENTRY_NONE,
  validateShiftsPlannedMorningStartRestriction,
  validateShiftsPlannedOperatingWindow,
  type Shift,
} from "@/lib/attendance";
import { getTodayJstDateString } from "@/lib/export-schedule";
import {
  formatDateYmdJapaneseWithWeekday,
  pickEarliestPlannedWorkDetail,
} from "@/lib/shift-planned-work";
import {
  getUserSlackFirstShiftHoursNotifiedAt,
  loadMembers,
  loadUserCanWorkMorning,
  markUserSlackFirstShiftHoursNotified,
  saveShiftsForUser,
  userHasPlannedWorkShiftInDb,
} from "@/lib/supabase-data";
import { notifyFirstShiftSubmittedSlack } from "@/lib/slack-first-shift-submit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Vercel ログからの復旧用: 正規化後の当該ユーザー分のみ（1行・JSON）。scripts/parse-vercel-schedule-log.mjs が解析 */
function logShiftSummaryForVercelRecovery(userId: string, shifts: Shift[]): void {
  const mine = shifts
    .filter((s) => s.userId === userId)
    .map((s) => ({
      d: s.date,
      a: s.startPlanned,
      b: s.endPlanned,
      a2: s.startPlanned2 ?? "",
      b2: s.endPlanned2 ?? "",
    }))
    .sort((x, y) => x.d.localeCompare(y.d));
  let json = JSON.stringify({ u: userId, n: mine.length, rows: mine });
  const max = 48000;
  if (json.length > max) json = json.slice(0, max) + "…";
  console.log(`[api/schedule] shiftSummary ${json}`);
}

function isAdminSession(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

function parseShiftsPayload(raw: unknown): Shift[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Shift[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const o = item as Record<string, unknown>;
    if (
      typeof o.id !== "string" ||
      typeof o.date !== "string" ||
      typeof o.startPlanned !== "string" ||
      typeof o.endPlanned !== "string"
    ) {
      return null;
    }
    const uid = typeof o.userId === "string" ? o.userId : "";
    const isManualDelete =
      o.is_manual_delete === true ||
      o.isManualDelete === true ||
      (typeof o.is_manual_delete === "string" && o.is_manual_delete.toLowerCase() === "true");
    out.push({
      id: o.id,
      userId: uid,
      date: o.date,
      startPlanned: o.startPlanned,
      endPlanned: o.endPlanned,
      startPlanned2: typeof o.startPlanned2 === "string" ? o.startPlanned2 : undefined,
      endPlanned2: typeof o.endPlanned2 === "string" ? o.endPlanned2 : undefined,
      ...(isManualDelete ? { isManualDelete: true as const } : {}),
    });
  }
  return out;
}

/**
 * 稼働予定の保存。
 * - DB 側は saveShiftsForUser → mergeUserShiftsPreserveExistingByDate（日付マージ＋枠ごとに「なし」で実時間を潰さない）＋ data_change_history
 * - 初回「稼働時間あり」確定時のみ SLACK_WEBHOOK_URL へ通知（users.slack_first_shift_hours_notified_at）
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const sessionUserId = (session?.user as { id?: string } | undefined)?.id;
  if (!session?.user || !sessionUserId) {
    console.log("[api/schedule] 401: no session");
    return NextResponse.json({ error: "ログインしてください" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "不正な JSON です" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });
  }
  const o = body as Record<string, unknown>;

  const rawUserId = typeof o.userId === "string" ? o.userId.trim() : "";
  let targetUserId = sessionUserId;

  if (isAdminSession(session)) {
    if (!rawUserId || !UUID_RE.test(rawUserId)) {
      return NextResponse.json({ error: "管理者による保存では有効な userId が必要です" }, { status: 400 });
    }
    targetUserId = rawUserId;
  } else {
    if (rawUserId && rawUserId !== sessionUserId) {
      return NextResponse.json({ error: "不正なリクエストです" }, { status: 403 });
    }
  }

  const parsed = parseShiftsPayload(o.shifts);
  if (!parsed) {
    return NextResponse.json({ error: "shifts が不正です" }, { status: 400 });
  }

  let normalized = parsed.map((s) => ({ ...s, userId: targetUserId }));
  normalized = normalized.map((s) => {
    if (!isWeekendYmd(s.date)) return s;
    return {
      ...s,
      startPlanned: SHIFT_ENTRY_NONE,
      endPlanned: SHIFT_ENTRY_NONE,
      startPlanned2: undefined,
      endPlanned2: undefined,
    };
  });

  const windowRuleErr = validateShiftsPlannedOperatingWindow(normalized);
  if (windowRuleErr) {
    return NextResponse.json({ error: windowRuleErr }, { status: 400 });
  }

  const canMorning = await loadUserCanWorkMorning(targetUserId);
  const morningErr = validateShiftsPlannedMorningStartRestriction(normalized, canMorning);
  if (morningErr) {
    return NextResponse.json({ error: morningErr }, { status: 400 });
  }

  const todayJst = getTodayJstDateString();
  const thisMon = getMondayOfCalendarWeekForYmd(todayJst);
  const [subW1, subW2] = getSubmittableShiftWeekMondays(thisMon);
  for (const s of normalized) {
    if (s.userId !== targetUserId) continue;
    const wm = getMondayOfCalendarWeekForYmd(s.date);
    if (wm === thisMon) continue;
    if (wm === subW1 || wm === subW2) {
      if (!isWeekOpenForEntry(wm, thisMon)) {
        return NextResponse.json(
          { error: "この週のシフト提出は締め切られています。保存できません。" },
          { status: 400 }
        );
      }
    }
  }

  const [notifiedAt, hadDbBefore] = await Promise.all([
    getUserSlackFirstShiftHoursNotifiedAt(targetUserId),
    userHasPlannedWorkShiftInDb(targetUserId),
  ]);
  const workInPayload = pickEarliestPlannedWorkDetail(normalized);

  console.log("[api/schedule] pre-save notify check", {
    targetUserId,
    alreadyNotified: !!notifiedAt,
    hadPlannedWorkInDbBefore: hadDbBefore,
    hasPlannedWorkInPayload: !!workInPayload,
  });

  // saveShiftsForUser 内で (user_id, date) 重複の削除と既存 id への寄せ（upsert=更新）を実施
  const saved = await saveShiftsForUser(targetUserId, normalized, { changeSource: "api/schedule" });
  if (!saved) {
    console.log("[api/schedule] save failed (upsert)");
    return NextResponse.json({ error: "稼働予定の保存に失敗しました" }, { status: 500 });
  }

  console.log("[api/schedule] save ok", { targetUserId, shiftRows: normalized.length });
  logShiftSummaryForVercelRecovery(targetUserId, normalized);

  if (notifiedAt) {
    console.log("[api/schedule] skip Slack: already notified at", notifiedAt);
    return NextResponse.json({ ok: true });
  }

  if (hadDbBefore === null) {
    console.log("[api/schedule] skip Slack: could not read existing shifts (query error). No flag update.");
    return NextResponse.json({ ok: true });
  }

  if (!workInPayload) {
    console.log("[api/schedule] skip Slack: payload has no planned work hours (all なし or empty)");
    if (hadDbBefore && !notifiedAt) {
      const marked = await markUserSlackFirstShiftHoursNotified(targetUserId);
      console.log(
        "[api/schedule] backfill slack_first_shift_hours_notified_at (had DB work, no hours in this payload):",
        marked
      );
    }
    return NextResponse.json({ ok: true });
  }

  if (hadDbBefore) {
    console.log(
      "[api/schedule] skip Slack: DB already had planned work before this save (not first-time hours)"
    );
    const marked = await markUserSlackFirstShiftHoursNotified(targetUserId);
    console.log("[api/schedule] backfill slack_first_shift_hours_notified_at:", marked);
    return NextResponse.json({ ok: true });
  }

  const members = await loadMembers();
  const memberName = (members?.find((m) => m.id === targetUserId)?.name ?? "").trim() || "（名前なし）";
  const firstWorkDateLabel = formatDateYmdJapaneseWithWeekday(workInPayload.dateYmd);
  const timeRangeLabel = `${workInPayload.start} 〜 ${workInPayload.end}`;

  console.log("[api/schedule] attempting first-shift Slack", {
    targetUserId,
    firstWorkDateLabel,
    timeRangeLabel,
  });

  const sent = await notifyFirstShiftSubmittedSlack({
    memberName,
    firstWorkDateLabel,
    timeRangeLabel,
    memberId: targetUserId,
  });
  if (sent) {
    const marked = await markUserSlackFirstShiftHoursNotified(targetUserId);
    console.log("[api/schedule] Slack OK; slack_first_shift_hours_notified_at updated:", marked);
  } else {
    console.log(
      "[api/schedule] Slack not sent or failed; slack_first_shift_hours_notified_at unchanged (retry on next save)"
    );
  }

  return NextResponse.json({ ok: true });
}
