import { SHIFT_ENTRY_NONE, type Shift } from "@/lib/attendance";

/** 予定1または予定2に、稼働「なし」以外の開始・終了が入っているか */
export function shiftHasPlannedWorkHours(s: Shift): boolean {
  const sp = (s.startPlanned ?? "").trim();
  const ep = (s.endPlanned ?? "").trim();
  if (
    sp !== "" &&
    sp !== SHIFT_ENTRY_NONE &&
    sp !== "なし" &&
    ep !== "" &&
    ep !== SHIFT_ENTRY_NONE &&
    ep !== "なし"
  ) {
    return true;
  }
  const sp2 = (s.startPlanned2 ?? "").trim();
  const ep2 = (s.endPlanned2 ?? "").trim();
  return (
    sp2 !== "" &&
    sp2 !== SHIFT_ENTRY_NONE &&
    sp2 !== "なし" &&
    ep2 !== "" &&
    ep2 !== SHIFT_ENTRY_NONE &&
    ep2 !== "なし"
  );
}

/** 最も早い日付の稼働枠（予定1を予定2より優先して同日内で並べる） */
export function pickEarliestPlannedWorkDetail(
  shifts: Shift[]
): { dateYmd: string; start: string; end: string } | null {
  type Row = { date: string; start: string; end: string; order: number };
  const rows: Row[] = [];
  for (const s of shifts) {
    const sp = (s.startPlanned ?? "").trim();
    const ep = (s.endPlanned ?? "").trim();
    if (
      sp !== "" &&
      sp !== SHIFT_ENTRY_NONE &&
      sp !== "なし" &&
      ep !== "" &&
      ep !== SHIFT_ENTRY_NONE &&
      ep !== "なし"
    ) {
      rows.push({ date: s.date, start: sp, end: ep, order: 0 });
    }
    const sp2 = (s.startPlanned2 ?? "").trim();
    const ep2 = (s.endPlanned2 ?? "").trim();
    if (
      sp2 !== "" &&
      sp2 !== SHIFT_ENTRY_NONE &&
      sp2 !== "なし" &&
      ep2 !== "" &&
      ep2 !== SHIFT_ENTRY_NONE &&
      ep2 !== "なし"
    ) {
      rows.push({ date: s.date, start: sp2, end: ep2, order: 1 });
    }
  }
  if (rows.length === 0) return null;
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.start.localeCompare(b.start));
  const r = rows[0]!;
  return { dateYmd: r.date, start: r.start, end: r.end };
}

/** YYYY-MM-DD を「2026年04月10日（金）」形式へ（ローカル暦の曜日） */
export function formatDateYmdJapaneseWithWeekday(dateYmd: string): string {
  const parts = dateYmd.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return dateYmd;
  const [y, m, d] = parts as [number, number, number];
  const wd = ["日", "月", "火", "水", "木", "金", "土"];
  const w = wd[new Date(y, m - 1, d).getDay()] ?? "";
  return `${y}年${String(m).padStart(2, "0")}月${String(d).padStart(2, "0")}日（${w}）`;
}
