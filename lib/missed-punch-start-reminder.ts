import { getTodayJstDateString } from "@/lib/export-schedule";
import {
  SHIFT_ENTRY_NONE,
  canonicalShiftForUserDate,
  getRecordsForUser,
  type OpenRecord,
  type Shift,
  type WorkRecord,
} from "@/lib/attendance";
import { loadMembers, loadOpenRecords, loadRecords, loadShifts } from "@/lib/supabase-data";
import { getSupabase } from "@/lib/supabase";
import {
  postSlackIncomingWebhook,
  resolveSlackWebhookUrl,
  slackWebhookMissingMessage,
} from "@/lib/slack-webhook";

function readGraceMinutes(): number {
  const v = process.env.MISSED_PUNCH_START_GRACE_MINUTES?.trim();
  if (!v) return 15;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 && n <= 240 ? n : 15;
}

function isConcreteSlot(start: string, end: string): boolean {
  const sp = start.trim();
  const ep = end.trim();
  return (
    sp !== "" &&
    sp !== SHIFT_ENTRY_NONE &&
    sp !== "なし" &&
    ep !== "" &&
    ep !== SHIFT_ENTRY_NONE &&
    ep !== "なし"
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** その日の HH:mm を JST の瞬間（ms）に変換 */
function jstInstantOnYmd(ymd: string, hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  const [y, M, d] = ymd.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(M) || !Number.isFinite(d)) return null;
  const iso = `${y}-${pad2(M)}-${pad2(d)}T${pad2(h)}:${pad2(min)}:00+09:00`;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function slotRangeMs(ymd: string, startHhmm: string, endHhmm: string): { startMs: number; endMs: number } | null {
  const startMs = jstInstantOnYmd(ymd, startHhmm);
  const endMs0 = jstInstantOnYmd(ymd, endHhmm);
  if (startMs == null || endMs0 == null) return null;
  let endMs = endMs0;
  if (endMs <= startMs) endMs += 24 * 60 * 60 * 1000;
  return { startMs, endMs };
}

function attendanceOverlapsSlot(rec: Pick<WorkRecord, "startRaw" | "endRaw">, startMs: number, endMs: number): boolean {
  const a = new Date(rec.startRaw).getTime();
  const b = new Date(rec.endRaw).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return false;
  return a < endMs && b > startMs;
}

function hasOpenRecordOnDate(openRecs: OpenRecord[], userId: string, dateYmd: string): boolean {
  return openRecs.some((o) => o.userId === userId && o.date === dateYmd);
}

/** [openStart, 現在まで) が予定枠 [startMs, endMs] と交差する */
function openOverlapsSlotForEndAlert(open: OpenRecord, dateYmd: string, startMs: number, endMs: number): boolean {
  if (open.date !== dateYmd) return false;
  const openStart = new Date(open.startRaw).getTime();
  if (!Number.isFinite(openStart)) return false;
  return openStart < endMs;
}

function buildSlotAlertText(params: {
  memberName: string;
  plannedStart: string;
  plannedEnd: string;
  situation: "開始忘れ" | "終了報告忘れ";
}): string {
  const { memberName, plannedStart, plannedEnd, situation } = params;
  return `🚨 【未打刻アラート：15分経過】

👤 ${memberName} さん
・予定時間：${plannedStart} 〜 ${plannedEnd}
・現在の状況：${situation}

💡 状況を確認し、打刻を忘れている場合は速やかに操作するよう促してください。`;
}

type RowSent = { user_id: string; slot_kind: string };

export type MissedPunchSlotKind = "primary" | "secondary";

export type MissedPunchSliceResult = {
  sent: boolean;
  count: number;
  skipReason?: "no_webhook" | "no_candidates" | "db_read_failed" | "db_write_failed";
  error?: string;
  detail?: string;
};

export type MissedPunchSlotRemindersResult =
  | { ok: true; dateYmd: string; start: MissedPunchSliceResult; end: MissedPunchSliceResult }
  | { ok: false; error: string; detail?: string };

export type MissedPunchStartReminderResult =
  | {
      ok: true;
      sent: boolean;
      count: number;
      dateYmd: string;
      skipReason?: "no_webhook" | "no_candidates" | "db_read_failed" | "db_write_failed";
    }
  | { ok: false; error: string; detail?: string };

type StartCand = {
  userId: string;
  memberName: string;
  plannedStart: string;
  plannedEnd: string;
  slotKind: MissedPunchSlotKind;
};

type EndCand = {
  userId: string;
  memberName: string;
  plannedStart: string;
  plannedEnd: string;
  slotKind: MissedPunchSlotKind;
};

/**
 * 予定開始＋猶予（既定 15 分）経過後も当日の業務開始（open_records）がなく、
 * 該当枠に重なる活動記録もないメンバーへ Slack（同一枠につき 1 日 1 回）。
 * 開始の事実は open_records / attendance で判定（kpis は日次集計のため開始判定に使わない）。
 */
function collectMissedPunchStartCandidates(
  dateYmd: string,
  nowMs: number,
  graceMs: number,
  members: NonNullable<Awaited<ReturnType<typeof loadMembers>>>,
  records: WorkRecord[],
  shifts: Shift[],
  openRecs: OpenRecord[],
  sentSet: Set<string>
): StartCand[] {
  const candidates: StartCand[] = [];

  for (const m of members) {
    if (m.isActive === false) continue;
    const firstWork = m.firstWorkDate?.trim();
    if (firstWork && /^\d{4}-\d{2}-\d{2}$/.test(firstWork) && dateYmd < firstWork) continue;

    if (hasOpenRecordOnDate(openRecs, m.id, dateYmd)) continue;

    const shift = canonicalShiftForUserDate(shifts, m.id, dateYmd);
    if (!shift) continue;

    const userRecords = getRecordsForUser(records, m.id).filter((r: WorkRecord) => r.date === dateYmd);
    const name = (m.name ?? "").trim() || "（氏名なし）";

    const slots: { kind: MissedPunchSlotKind; start: string; end: string }[] = [];
    if (isConcreteSlot(shift.startPlanned, shift.endPlanned)) {
      slots.push({ kind: "primary", start: shift.startPlanned, end: shift.endPlanned });
    }
    const sp2 = shift.startPlanned2 ?? "";
    const ep2 = shift.endPlanned2 ?? "";
    if (isConcreteSlot(sp2, ep2)) {
      slots.push({ kind: "secondary", start: sp2, end: ep2 });
    }

    for (const slot of slots) {
      const key = `${m.id}\t${slot.kind}`;
      if (sentSet.has(key)) continue;

      const bounds = slotRangeMs(dateYmd, slot.start, slot.end);
      if (!bounds) continue;

      const deadlineMs = bounds.startMs + graceMs;
      if (nowMs < deadlineMs) continue;

      const overlapped = userRecords.some((r) => attendanceOverlapsSlot(r, bounds.startMs, bounds.endMs));
      if (overlapped) continue;

      candidates.push({
        userId: m.id,
        memberName: name,
        plannedStart: slot.start,
        plannedEnd: slot.end,
        slotKind: slot.kind,
      });
    }
  }

  candidates.sort(
    (a, b) =>
      a.memberName.localeCompare(b.memberName, "ja") ||
      (a.slotKind === b.slotKind ? 0 : a.slotKind === "primary" ? -1 : 1)
  );
  return candidates;
}

/**
 * 予定終了＋猶予経過後も未終了打刻（open_records）が枠と重なっている＝終了報告未完了。
 */
function collectMissedPunchEndCandidates(
  dateYmd: string,
  nowMs: number,
  graceMs: number,
  members: NonNullable<Awaited<ReturnType<typeof loadMembers>>>,
  shifts: Shift[],
  openRecs: OpenRecord[],
  sentSet: Set<string>
): EndCand[] {
  const candidates: EndCand[] = [];
  const opensByUser = new Map<string, OpenRecord[]>();
  for (const o of openRecs) {
    if (o.date !== dateYmd) continue;
    const list = opensByUser.get(o.userId) ?? [];
    list.push(o);
    opensByUser.set(o.userId, list);
  }

  for (const m of members) {
    if (m.isActive === false) continue;
    const firstWork = m.firstWorkDate?.trim();
    if (firstWork && /^\d{4}-\d{2}-\d{2}$/.test(firstWork) && dateYmd < firstWork) continue;

    const userOpens = opensByUser.get(m.id);
    if (!userOpens?.length) continue;

    const shift = canonicalShiftForUserDate(shifts, m.id, dateYmd);
    if (!shift) continue;

    const name = (m.name ?? "").trim() || "（氏名なし）";

    const slots: { kind: MissedPunchSlotKind; start: string; end: string }[] = [];
    if (isConcreteSlot(shift.startPlanned, shift.endPlanned)) {
      slots.push({ kind: "primary", start: shift.startPlanned, end: shift.endPlanned });
    }
    const sp2 = shift.startPlanned2 ?? "";
    const ep2 = shift.endPlanned2 ?? "";
    if (isConcreteSlot(sp2, ep2)) {
      slots.push({ kind: "secondary", start: sp2, end: ep2 });
    }

    for (const slot of slots) {
      const key = `${m.id}\t${slot.kind}`;
      if (sentSet.has(key)) continue;

      const bounds = slotRangeMs(dateYmd, slot.start, slot.end);
      if (!bounds) continue;

      const deadlineMs = bounds.endMs + graceMs;
      if (nowMs < deadlineMs) continue;

      const overlapsOpen = userOpens.some((o) => openOverlapsSlotForEndAlert(o, dateYmd, bounds.startMs, bounds.endMs));
      if (!overlapsOpen) continue;

      candidates.push({
        userId: m.id,
        memberName: name,
        plannedStart: slot.start,
        plannedEnd: slot.end,
        slotKind: slot.kind,
      });
    }
  }

  candidates.sort(
    (a, b) =>
      a.memberName.localeCompare(b.memberName, "ja") ||
      (a.slotKind === b.slotKind ? 0 : a.slotKind === "primary" ? -1 : 1)
  );
  return candidates;
}

async function sendStartAlertsAndPersist(
  supabase: NonNullable<ReturnType<typeof getSupabase>>,
  dateYmd: string,
  candidates: StartCand[],
  webhookUrl: string
): Promise<{ ok: true; count: number } | { ok: false; error: string; detail?: string }> {
  for (const c of candidates) {
    const text = buildSlotAlertText({
      memberName: c.memberName,
      plannedStart: c.plannedStart,
      plannedEnd: c.plannedEnd,
      situation: "開始忘れ",
    });
    const posted = await postSlackIncomingWebhook(webhookUrl, { text });
    if (!posted.ok) {
      return { ok: false, error: posted.error, detail: posted.detail };
    }
    const { error: insErr } = await supabase.from("punch_start_reminder_sent").upsert(
      {
        user_id: c.userId,
        work_date: dateYmd,
        slot_kind: c.slotKind,
        notified_at: new Date().toISOString(),
      },
      { onConflict: "user_id,work_date,slot_kind" }
    );
    if (insErr) {
      console.error("[missed-punch] upsert punch_start_reminder_sent failed:", insErr);
      return { ok: false, error: "DB write failed", detail: insErr.message };
    }
  }
  return { ok: true, count: candidates.length };
}

async function sendEndAlertsAndPersist(
  supabase: NonNullable<ReturnType<typeof getSupabase>>,
  dateYmd: string,
  candidates: EndCand[],
  webhookUrl: string
): Promise<{ ok: true; count: number } | { ok: false; error: string; detail?: string }> {
  for (const c of candidates) {
    const text = buildSlotAlertText({
      memberName: c.memberName,
      plannedStart: c.plannedStart,
      plannedEnd: c.plannedEnd,
      situation: "終了報告忘れ",
    });
    const posted = await postSlackIncomingWebhook(webhookUrl, { text });
    if (!posted.ok) {
      return { ok: false, error: posted.error, detail: posted.detail };
    }
    const { error: insErr } = await supabase.from("punch_end_reminder_sent").upsert(
      {
        user_id: c.userId,
        work_date: dateYmd,
        slot_kind: c.slotKind,
        notified_at: new Date().toISOString(),
      },
      { onConflict: "user_id,work_date,slot_kind" }
    );
    if (insErr) {
      console.error("[missed-punch] upsert punch_end_reminder_sent failed:", insErr);
      return { ok: false, error: "DB write failed", detail: insErr.message };
    }
  }
  return { ok: true, count: candidates.length };
}

/**
 * 開始・終了の未打刻アラートをまとめて実行（Cron 用）。
 * 同一ユーザー×日×枠（primary/secondary）ごとに DB で 1 回のみ通知。
 */
export async function runMissedPunchSlotReminders(options?: {
  dateYmd?: string;
  now?: Date;
}): Promise<MissedPunchSlotRemindersResult> {
  const now = options?.now ?? new Date();
  const dateYmdRaw = (options?.dateYmd ?? "").trim();
  const dateYmd = /^\d{4}-\d{2}-\d{2}$/.test(dateYmdRaw) ? dateYmdRaw : getTodayJstDateString(now);
  const graceMs = readGraceMinutes() * 60 * 1000;
  const nowMs = now.getTime();

  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: "Supabase is not configured" };
  }

  const [membersOrNull, records, shifts, openRecs] = await Promise.all([
    loadMembers(),
    loadRecords(),
    loadShifts(),
    loadOpenRecords(),
  ]);
  const members = membersOrNull ?? [];

  const { data: startSentRows, error: startSentErr } = await supabase
    .from("punch_start_reminder_sent")
    .select("user_id, slot_kind")
    .eq("work_date", dateYmd);
  if (startSentErr) {
    console.warn("[missed-punch] read punch_start_reminder_sent:", startSentErr);
    return { ok: false, error: "DB read failed", detail: startSentErr.message };
  }
  const startSentSet = new Set(
    (startSentRows as RowSent[] | null | undefined ?? []).map((r) => `${r.user_id}\t${r.slot_kind}`)
  );

  const { data: endSentRows, error: endSentErr } = await supabase
    .from("punch_end_reminder_sent")
    .select("user_id, slot_kind")
    .eq("work_date", dateYmd);
  if (endSentErr) {
    console.warn("[missed-punch] read punch_end_reminder_sent:", endSentErr);
    return { ok: false, error: "DB read failed", detail: endSentErr.message };
  }
  const endSentSet = new Set((endSentRows as RowSent[] | null | undefined ?? []).map((r) => `${r.user_id}\t${r.slot_kind}`));

  const startCandidates = collectMissedPunchStartCandidates(
    dateYmd,
    nowMs,
    graceMs,
    members,
    records,
    shifts,
    openRecs,
    startSentSet
  );
  const endCandidates = collectMissedPunchEndCandidates(
    dateYmd,
    nowMs,
    graceMs,
    members,
    shifts,
    openRecs,
    endSentSet
  );

  const webhookUrl = resolveSlackWebhookUrl("missed_punch_start");
  const emptyStart: MissedPunchSliceResult = { sent: false, count: 0, skipReason: "no_candidates" };
  const emptyEnd: MissedPunchSliceResult = { sent: false, count: 0, skipReason: "no_candidates" };

  let startSlice: MissedPunchSliceResult = emptyStart;
  let endSlice: MissedPunchSliceResult = emptyEnd;

  if (!webhookUrl) {
    console.warn(
      "[missed-punch] Webhook が未設定のため送信しません（" + slackWebhookMissingMessage("missed_punch_start") + ")"
    );
    if (startCandidates.length > 0) {
      startSlice = { sent: false, count: startCandidates.length, skipReason: "no_webhook" };
    }
    if (endCandidates.length > 0) {
      endSlice = { sent: false, count: endCandidates.length, skipReason: "no_webhook" };
    }
    return { ok: true, dateYmd, start: startSlice, end: endSlice };
  }

  if (startCandidates.length > 0) {
    const r = await sendStartAlertsAndPersist(supabase, dateYmd, startCandidates, webhookUrl);
    if (!r.ok) {
      startSlice = {
        sent: false,
        count: startCandidates.length,
        error: r.error,
        detail: r.detail,
        skipReason: "db_write_failed",
      };
    } else {
      startSlice = { sent: true, count: r.count };
    }
  }

  if (endCandidates.length > 0) {
    const r = await sendEndAlertsAndPersist(supabase, dateYmd, endCandidates, webhookUrl);
    if (!r.ok) {
      endSlice = {
        sent: false,
        count: endCandidates.length,
        error: r.error,
        detail: r.detail,
        skipReason: "db_write_failed",
      };
    } else {
      endSlice = { sent: true, count: r.count };
    }
  }

  return { ok: true, dateYmd, start: startSlice, end: endSlice };
}

/** @deprecated 互換用。内部では `runMissedPunchSlotReminders` の開始分のみ返す。 */
export async function runMissedPunchStartReminder(options?: {
  dateYmd?: string;
  now?: Date;
}): Promise<MissedPunchStartReminderResult> {
  const r = await runMissedPunchSlotReminders(options);
  if (!r.ok) return r;
  const s = r.start;
  if (s.error) return { ok: false, error: s.error, detail: s.detail };
  return {
    ok: true,
    sent: s.sent,
    count: s.count,
    dateYmd: r.dateYmd,
    ...(s.skipReason && !s.sent ? { skipReason: s.skipReason } : {}),
  };
}
