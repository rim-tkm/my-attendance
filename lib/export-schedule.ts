import type { Member, Shift } from "@/lib/attendance";
import { SHIFT_ENTRY_NONE, getDateStringsInclusive } from "@/lib/attendance";
import { addCalendarDays } from "@/lib/roi-analysis";

/** 土日判定エラー・UI 共通メッセージ（日本の暦で土曜・日曜） */
export const JST_WEEKEND_WORK_REJECTED_MESSAGE = "土日は稼働対象外です";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * YYYY-MM-DD を日本（Asia/Tokyo）の暦日として解釈し、土曜・日曜かどうかを返す。
 * サーバーの TZ が UTC でも、日付文字列に対する曜日がずれないようにする。
 */
export function isWeekendYmdJst(ymd: string): boolean {
  const t = ymd.trim();
  if (!YMD_RE.test(t)) return false;
  const anchor = new Date(`${t}T12:00:00+09:00`);
  if (Number.isNaN(anchor.getTime())) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  }).formatToParts(anchor);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  const w = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (!y || !m || !d || `${y}-${m}-${d}` !== t) return false;
  return w === "Saturday" || w === "Sunday";
}

/** 日本時間で「今日」の YYYY-MM-DD（クライアント・サーバー共通。Intl で JST を直接解釈） */
export function getTodayJstDateString(now: Date = new Date()): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dtf.formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (y && m && d) return `${y}-${m}-${d}`;
  const fallback = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const yy = fallback.getFullYear();
  const mm = String(fallback.getMonth() + 1).padStart(2, "0");
  const dd = String(fallback.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** 日本時間での「その瞬間」の時・分のみ（0 時からの経過分）。ダッシュボードの予実判定などで使用 */
export function getJstClockMinutesSinceMidnight(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** 暦上、その日を含む週の月曜日（YYYY-MM-DD） */
export function getMondayOfCalendarWeekContaining(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const wd = new Date(y, m - 1, d).getDay();
  const diff = wd === 0 ? -6 : 1 - wd;
  const mon = new Date(y, m - 1, d + diff);
  const yy = mon.getFullYear();
  const mm = String(mon.getMonth() + 1).padStart(2, "0");
  const dd = String(mon.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** アンカー日を含む週の「翌週」月曜〜日曜 */
export function getNextWeekRangeInclusive(anchorJstYmd: string): { start: string; end: string } {
  const thisMon = getMondayOfCalendarWeekContaining(anchorJstYmd);
  const nextMon = addCalendarDays(thisMon, 7);
  const nextSun = addCalendarDays(nextMon, 6);
  return { start: nextMon, end: nextSun };
}

/** 1件分の予定テキスト（CSV・表示用） */
export function formatShiftContentForCsv(shift: Shift | undefined): string {
  if (!shift) return "未登録";
  if (shift.startPlanned === SHIFT_ENTRY_NONE) return "稼働予定なし";
  let t = `${shift.startPlanned}～${shift.endPlanned}`;
  if (shift.startPlanned2 && shift.endPlanned2 && shift.startPlanned2.trim() && shift.endPlanned2.trim()) {
    t += ` ／ ${shift.startPlanned2}～${shift.endPlanned2}`;
  }
  return t;
}

function csvEscapeCell(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** 列見出し: `2026-03-24（月）` 形式 */
export function formatScheduleColumnHeader(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const labels = ["日", "月", "火", "水", "木", "金", "土"];
  const w = labels[date.getDay()];
  return `${dateStr}（${w}）`;
}

/** マトリックス行（先頭セルが名前、以降が各日の内容） */
export function buildScheduleMatrixDataRows(
  members: Member[],
  dates: string[],
  shifts: Shift[]
): string[][] {
  const byUserDate = new Map<string, Shift>();
  const dateSet = new Set(dates);
  for (const s of shifts) {
    if (dateSet.has(s.date)) {
      byUserDate.set(`${s.userId}\t${s.date}`, s);
    }
  }
  const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name, "ja"));
  return sorted.map((mem) => [
    mem.name,
    ...dates.map((ds) => formatShiftContentForCsv(byUserDate.get(`${mem.id}\t${ds}`))),
  ]);
}

/** シフト表形式 CSV（UTF-8 BOM）。列: 名前, 各日（曜付き） */
export function scheduleMatrixToCsvString(members: Member[], dates: string[], shifts: Shift[]): string {
  const headers = ["名前", ...dates.map(formatScheduleColumnHeader)];
  const dataRows = buildScheduleMatrixDataRows(members, dates, shifts);
  const lines = [headers.map(csvEscapeCell).join(",")];
  for (const row of dataRows) {
    lines.push(row.map(csvEscapeCell).join(","));
  }
  return `\uFEFF${lines.join("\n")}`;
}

/** 指定期間の稼働予定をマトリックス CSV（UTF-8 BOM）にする */
export function exportScheduleToCsvString(
  periodStart: string,
  periodEnd: string,
  shifts: Shift[],
  members: Member[]
): string {
  const start = periodStart <= periodEnd ? periodStart : periodEnd;
  const end = periodStart <= periodEnd ? periodEnd : periodStart;
  const dates = getDateStringsInclusive(start, end);
  return scheduleMatrixToCsvString(members, dates, shifts);
}
