import type { Member } from "@/lib/attendance";
import { getSupabase } from "@/lib/supabase";

/**
 * 打刻押し忘れロック。
 * - カウント = 未打刻アラート送信履歴（punch_start_reminder_sent / punch_end_reminder_sent）の当月行数。
 *   開始アラートは予定+15分に送信され、開始打刻は予定+14分59秒で締め切られるため「アラート送信=押し忘れ確定」。
 *   開始を押し忘れた稼働は終了ボタン自体が存在しないため、同一稼働で開始・終了が二重カウントされることはない。
 * - 月3回に達するとロック。規約同意→公式LINEへ報告→管理者が解除（punch_miss_released_*）するまで稼働不可。
 * - 解除後も「解除時点の回数」を超える新たな押し忘れが起きると再ロックされる。
 */
export const PUNCH_MISS_LOCK_THRESHOLD = 3;

/** 当月（YYYY-MM）の押し忘れ回数をユーザー別に集計（アラート送信履歴の行数） */
export async function loadPunchMissCountsForMonth(month: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const supabase = getSupabase();
  if (!supabase || !/^\d{4}-\d{2}$/.test(month)) return counts;
  const from = `${month}-01`;
  const to = `${month}-31`;
  const tables = ["punch_start_reminder_sent", "punch_end_reminder_sent"] as const;
  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select("user_id, work_date, slot_kind")
      .gte("work_date", from)
      .lte("work_date", to);
    if (error) {
      console.warn(`[punch-miss] ${table} read error:`, error);
      continue;
    }
    for (const row of (data ?? []) as { user_id: string }[]) {
      counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1);
    }
  }
  return counts;
}

/** 解除が効いている回数（解除月が当月でなければ 0 = 解除なし扱い） */
export function punchMissReleasedCountFor(member: Member, month: string): number {
  if ((member.punchMissReleasedMonth ?? "") !== month) return 0;
  const n = member.punchMissReleasedCount;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

/** ロック中か。押し忘れが閾値以上 かつ 解除時点の回数を超えて増えている場合にロック */
export function isPunchMissLocked(member: Member, monthCount: number, month: string): boolean {
  if (monthCount < PUNCH_MISS_LOCK_THRESHOLD) return false;
  return monthCount > punchMissReleasedCountFor(member, month);
}

/** ロック画面に表示する規約文面 */
export const PUNCH_MISS_TERMS_TEXT = `【打刻に関する規約】

1. 稼働開始・稼働終了の打刻は、稼働の事実を証明する唯一の記録であり、本人が必ず行うものとします。

2. 打刻の押し忘れ（開始・終了のいずれか）が1ヶ月に${PUNCH_MISS_LOCK_THRESHOLD}回に達した場合、アカウントはロックされ、本規約に同意のうえ公式LINEへ報告し、管理者がロックを解除するまで稼働（打刻・シフト提出）はできません。

3. 1ヶ月で${PUNCH_MISS_LOCK_THRESHOLD + 1}回目以降の押し忘れが発生した稼働については、以後いかなる理由があっても修正は行われず、稼働として認められない（報酬のお支払い対象外となる）場合があります。

4. ロック解除後も押し忘れが繰り返された場合は、その都度再びロックされます。`;

/** 規約同意後に公式LINEへコピペ送信してもらう文面 */
export function buildPunchMissLineMessage(memberName: string, monthCount: number, month: string): string {
  const [y, m] = month.split("-");
  return `【打刻押し忘れの報告】
氏名：${memberName}
対象：${y}年${Number(m)}月の押し忘れ ${monthCount}回目

打刻規約（1ヶ月${PUNCH_MISS_LOCK_THRESHOLD}回を超える押し忘れは修正不可・稼働として認められない場合があること）を確認し、同意します。
以後、打刻を徹底します。ロックの解除をお願いいたします。`;
}
