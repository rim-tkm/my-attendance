import { isWeekendYmd } from "@/lib/attendance";
import { nationalHolidaysForYear } from "@/lib/company-holiday-suggestions";

/**
 * 支払期日（末日締め・翌月15日払い）の共通計算。
 *
 * 背景（2026-08-06 管理者判断）:
 * 翌月15日が土曜・日曜・国民の祝日のときは実際には銀行振込ができないため、
 * **前倒し（前営業日）** に統一する。15日が日曜なら金曜（13日）に、金曜も祝日なら
 * さらに前の営業日へ、というように「営業日になるまで1日ずつ遡る」。
 *
 * この計算結果は freee 外注費CSV・一括記帳スプレッドシート・請求書 HTML/PDF の
 * 3箇所から共通で使う（lib/freee-deals-csv.ts, lib/invoice-batch-export-shared.ts,
 * lib/invoice-html.ts）。各呼び出し元は返り値 `YYYY-MM-DD` をそれぞれの出力フォーマット
 * （ゼロ埋め有無）に変換して使うこと。ここではフォーマット変換は行わない。
 *
 * 対象外: freee 取引先マスタの支払条件（cutoff_day/additional_months/fixed_day）は
 * 「15日払い」という“ルール”の設定であり、具体的な日付ではない。freee 側が独自の
 * 休日調整を行うため、このファイルの対象外（lib/freee-partners-csv.ts, lib/freee-partner-sync.ts は変更しない）。
 */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toYmd(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** ymd の前日（YYYY-MM-DD）。カレンダー計算は Date に委譲する。 */
function previousDayYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d - 1);
  return toYmd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

/**
 * ymd が銀行休業日（土曜・日曜・国民の祝日）かどうか。
 * 祝日は `nationalHolidaysForYear`（lib/company-holiday-suggestions.ts）を再利用し、
 * 振替休日・国民の休日を含めて判定する。祝日テーブルを二重に持たない。
 *
 * 年末年始（12/31〜1/3）の銀行窓口休業は考慮していない。支払日は「対象月の翌月15日」
 * なので、15日がこの期間に入ることはなく（15日は常に1〜31の範囲でこのウィンドウとは
 * 重ならない）、考慮不要。
 */
export function isBankHolidayYmd(ymd: string): boolean {
  if (isWeekendYmd(ymd)) return true;
  const year = Number(ymd.slice(0, 4));
  return nationalHolidaysForYear(year).has(ymd);
}

/**
 * ymd が営業日ならそのまま返し、そうでなければ「前倒し」で直前の営業日まで
 * 1日ずつ遡って返す（2026-08-06 管理者判断: 翌月15日払いの土日祝は前営業日に前倒し）。
 *
 * 年をまたぐケース（1月頭の祝日連続等）に備え、無限ループ防止のため最大10回で
 * 打ち切り、そこまでに見つかった最後の候補日を返す（祝日データが万一異常でも
 * 落ちないようにするための安全弁。通常の運用では2〜3日以内に営業日が見つかる）。
 */
export function previousBusinessDayYmd(ymd: string): string {
  let candidate = ymd;
  for (let i = 0; i < 10; i++) {
    if (!isBankHolidayYmd(candidate)) return candidate;
    candidate = previousDayYmd(candidate);
  }
  return candidate;
}

/**
 * 対象月（YYYY-MM）の「翌月15日払い」を、前倒し（前営業日）調整した上で
 * `YYYY-MM-DD` 形式で返す。
 *
 * 例: yearMonth="2026-06" → 素の翌月15日は 2026-07-15。
 * 2026-07-15 は水曜（営業日）なのでそのまま返る。
 * 15日が土日祝なら、営業日になるまで前の日へ遡って調整した日付を返す。
 */
export function paymentDueYmdForYearMonth(yearMonth: string): string {
  const [yStr, mStr] = yearMonth.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  // m は 1 始まりの「対象月」なので Date(y, m, 15) は翌月15日になる
  const due = new Date(y, m, 15);
  const rawYmd = toYmd(due.getFullYear(), due.getMonth() + 1, due.getDate());
  return previousBusinessDayYmd(rawYmd);
}
