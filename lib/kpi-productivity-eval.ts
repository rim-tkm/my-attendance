import type { WorkRecord } from "@/lib/attendance";

/** 1 時間あたりの有効コール基準（件） */
export const VALID_CALLS_PER_WORK_HOUR = 10;

/**
 * 指定日の打刻（start_raw / end_raw の実時刻）から実稼働時間（時間・小数）を合算する。
 * 複数セグメントがある日はすべて加算する。
 */
export function sumDecimalWorkHoursFromRawAttendance(
  records: WorkRecord[],
  userId: string,
  dateStr: string
): number {
  let ms = 0;
  for (const r of records) {
    if (r.userId !== userId || r.date !== dateStr) continue;
    const a = new Date(r.startRaw).getTime();
    const b = new Date(r.endRaw).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    ms += b - a;
  }
  return ms / (1000 * 60 * 60);
}

/** validCalls < (稼働時間(h) × 10) なら true（稼働時間が正のときのみ判定） */
export function shouldAlertLowKpiProductivity(validCalls: number, workHours: number): boolean {
  if (!(workHours > 0)) return false;
  const threshold = workHours * VALID_CALLS_PER_WORK_HOUR;
  return validCalls < threshold;
}

/** 小数時間 → 表示用「H 時間 M 分」（分は 0〜59、合計分を四捨五入してから時分化） */
export function decimalWorkHoursToHoursMinutes(workHours: number): { hours: number; minutes: number } {
  const totalMinutes = Math.max(0, Math.round(workHours * 60));
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

export function formatExpectedValidCallsLabel(workHours: number): string {
  const x = workHours * VALID_CALLS_PER_WORK_HOUR;
  if (!Number.isFinite(x)) return "—";
  if (Math.abs(x - Math.round(x)) < 1e-6) return String(Math.round(x));
  return x.toFixed(1);
}

export type KpiProductivityInstantAlertInput = {
  memberName: string;
  workHours: number;
  validCalls: number;
  /** 先頭に付ける <@U…> 行など（任意） */
  mentionLine?: string;
};

/**
 * KPI 保存直後の即時アラート用 Slack テキスト（本人1名分のみ）。
 */
export function buildKpiProductivityInstantLowAlertSlackText(input: KpiProductivityInstantAlertInput): string {
  const { hours, minutes } = decimalWorkHoursToHoursMinutes(input.workHours);
  const expectedLabel = formatExpectedValidCallsLabel(input.workHours);
  const mentionPrefix =
    input.mentionLine && input.mentionLine.trim() !== "" ? `${input.mentionLine.trim()}\n\n` : "";
  return `${mentionPrefix}🚨 【即時アラート：生産性低下を検知】

👤 ${input.memberName} さん
・稼働時間：${hours}時間${minutes}分
・有効コール数：${input.validCalls} 件（基準：${expectedLabel}件）

⚠️ 判定結果:
ただいま入力された数値が基準（10件/h）を下回っています。
状況の確認が必要な場合は、直ちに本人へヒアリングを行ってください。`;
}
