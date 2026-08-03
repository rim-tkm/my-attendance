import { isWeekendYmd, type CompanyHoliday } from "@/lib/attendance";

/**
 * 会社休業日の「提案」ロジック。
 * 日本の祝日をアプリ内で計算し（外部サービス不要）、GW などの連休・お盆・年末年始・単発の平日祝日を
 * 管理者に提案する。提案は却下（DB 記録）または休業日登録で消える。
 * 祝日計算は現行法ベース（振替休日・国民の休日を含む）。春分・秋分は 2099 年まで有効な近似式。
 */

export type CompanyHolidaySuggestion = {
  /** 却下記録・重複判定用の安定キー（例: "obon-2026", "nh-2026-09-21"。同じ連休は毎回同じキー） */
  key: string;
  name: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
};

/** 提案を表示し始める日数（開始日の何日前から出すか） */
export const COMPANY_HOLIDAY_SUGGESTION_LEAD_DAYS = 60;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toYmd(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function addDaysYmd(base: string, days: number): string {
  const [y, m, d] = base.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return toYmd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

function dayOfWeek(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** 第 n 月曜（ハッピーマンデー用） */
function nthMondayOfMonth(year: number, month: number, nth: number): string {
  const firstDow = dayOfWeek(toYmd(year, month, 1));
  const offsetToFirstMonday = (8 - firstDow) % 7;
  return toYmd(year, month, 1 + offsetToFirstMonday + (nth - 1) * 7);
}

/** 春分・秋分の日にち近似（1980〜2099 年で官報告示と一致する標準式） */
function equinoxDay(year: number, base: number): number {
  return Math.floor(base + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

/** その年の祝日（YYYY-MM-DD → 名称）。振替休日・国民の休日を含む */
export function nationalHolidaysForYear(year: number): Map<string, string> {
  const out = new Map<string, string>();
  const add = (m: number, d: number, name: string) => out.set(toYmd(year, m, d), name);
  add(1, 1, "元日");
  out.set(nthMondayOfMonth(year, 1, 2), "成人の日");
  add(2, 11, "建国記念の日");
  add(2, 23, "天皇誕生日");
  add(3, equinoxDay(year, 20.8431), "春分の日");
  add(4, 29, "昭和の日");
  add(5, 3, "憲法記念日");
  add(5, 4, "みどりの日");
  add(5, 5, "こどもの日");
  out.set(nthMondayOfMonth(year, 7, 3), "海の日");
  add(8, 11, "山の日");
  out.set(nthMondayOfMonth(year, 9, 3), "敬老の日");
  add(9, equinoxDay(year, 23.2488), "秋分の日");
  out.set(nthMondayOfMonth(year, 10, 2), "スポーツの日");
  add(11, 3, "文化の日");
  add(11, 23, "勤労感謝の日");
  // 振替休日: 祝日が日曜のとき、その後の最初の「祝日でない日」
  const baseDates = Array.from(out.keys());
  for (const dateStr of baseDates) {
    if (dayOfWeek(dateStr) !== 0) continue;
    let t = addDaysYmd(dateStr, 1);
    while (out.has(t)) t = addDaysYmd(t, 1);
    out.set(t, `振替休日（${out.get(dateStr) ?? "祝日"}）`);
  }
  // 国民の休日: 前後を祝日に挟まれた平日（9月の敬老の日〜秋分の日で発生しうる）
  const withSubstitutes = Array.from(out.keys());
  for (const dateStr of withSubstitutes) {
    const dayAfterNext = addDaysYmd(dateStr, 2);
    if (!out.has(dayAfterNext)) continue;
    const between = addDaysYmd(dateStr, 1);
    if (!out.has(between) && dayOfWeek(between) !== 0) out.set(between, "国民の休日");
  }
  return out;
}

/** 期間内の平日（土日以外）の YYYY-MM-DD 一覧 */
function listWeekdayYmdsInRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDaysYmd(d, 1)) {
    if (!isWeekendYmd(d)) out.push(d);
  }
  return out;
}

/** 提案期間の平日がすべて登録済み休業日でカバーされているか（カバー済みなら提案不要） */
function isCoveredByRegistered(suggestion: CompanyHolidaySuggestion, registered: CompanyHoliday[]): boolean {
  const weekdays = listWeekdayYmdsInRange(suggestion.startDate, suggestion.endDate);
  if (weekdays.length === 0) return true;
  return weekdays.every((d) => registered.some((h) => h.startDate <= d && d <= h.endDate));
}

/** 慣習的な長期休み（祝日ではないが会社が休みにしやすい期間） */
function customaryPeriodsForYear(year: number): CompanyHolidaySuggestion[] {
  return [
    { key: `obon-${year}`, name: "お盆休み", startDate: toYmd(year, 8, 13), endDate: toYmd(year, 8, 16) },
    { key: `nenmatsu-${year}`, name: "年末年始休み", startDate: toYmd(year, 12, 29), endDate: toYmd(year + 1, 1, 3) },
  ];
}

/**
 * 表示すべき休業日提案の一覧（開始日昇順）。
 * - 今日〜 leadDays 日後に始まる（または進行中の）候補のみ
 * - 却下済み・平日がすべて登録済み休業日でカバー済みの候補は除外
 * - 祝日は連続する平日祝日をひとつの連休にまとめる。GW 期間は「ゴールデンウィーク」と命名
 * - お盆・年末年始の期間内に収まる祝日（元日など）は、期間の提案に含まれるため単独では出さない
 */
export function buildCompanyHolidaySuggestions(input: {
  todayYmd: string;
  registered: CompanyHoliday[];
  dismissedKeys: ReadonlySet<string>;
  leadDays?: number;
}): CompanyHolidaySuggestion[] {
  const { todayYmd, registered, dismissedKeys } = input;
  const leadDays = input.leadDays ?? COMPANY_HOLIDAY_SUGGESTION_LEAD_DAYS;
  const windowEnd = addDaysYmd(todayYmd, leadDays);
  const years: number[] = [];
  for (let y = Number(todayYmd.slice(0, 4)); y <= Number(windowEnd.slice(0, 4)); y++) years.push(y);

  const holidayNames = new Map<string, string>();
  for (const y of years) {
    nationalHolidaysForYear(y).forEach((name, d) => holidayNames.set(d, name));
  }

  const customary = years.flatMap((y) => customaryPeriodsForYear(y));

  // 平日の祝日を日付順に並べ、連続する日をひとつの連休グループにまとめる
  const weekdayHolidayDates = Array.from(holidayNames.keys())
    .filter((d) => !isWeekendYmd(d))
    .sort();
  const groups: string[][] = [];
  for (const d of weekdayHolidayDates) {
    const last = groups[groups.length - 1];
    if (last && addDaysYmd(last[last.length - 1], 1) === d) last.push(d);
    else groups.push([d]);
  }

  const isInGwWindow = (d: string): boolean => {
    const md = d.slice(5); // MM-DD
    return md >= "04-29" && md <= "05-06";
  };

  const holidaySuggestions: CompanyHolidaySuggestion[] = groups
    .filter((g) => {
      // お盆・年末年始の期間内に収まる祝日は期間提案に任せる（元日など）
      return !g.every((d) => customary.some((c) => c.startDate <= d && d <= c.endDate));
    })
    .map((g) => {
      const start = g[0];
      const end = g[g.length - 1];
      if (g.length === 1) {
        return { key: `nh-${start}`, name: holidayNames.get(start) ?? "祝日", startDate: start, endDate: end };
      }
      const name = g.some(isInGwWindow)
        ? "ゴールデンウィーク"
        : `連休（${holidayNames.get(start) ?? "祝日"}〜${holidayNames.get(end) ?? "祝日"}）`;
      return { key: `nh-${start}`, name, startDate: start, endDate: end };
    });

  return [...customary, ...holidaySuggestions]
    .filter((s) => s.endDate >= todayYmd && s.startDate <= windowEnd)
    .filter((s) => !dismissedKeys.has(s.key))
    .filter((s) => !isCoveredByRegistered(s, registered))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}
