import type { OpenRecord } from "@/lib/attendance";
import { getOpenRecordForUser } from "@/lib/attendance";
import {
  WORK_DURATION_EXCEEDS_24H_MESSAGE,
  WORK_RECORD_END_NOT_AFTER_START_MESSAGE,
  WORK_RECORD_SAME_START_END_MESSAGE,
} from "@/lib/attendance";
import { JST_WEEKEND_WORK_REJECTED_MESSAGE } from "@/lib/export-schedule";
import { NETWORK_TIMEOUT_ERROR, type NetworkRetryOptions } from "@/lib/network-retry";
import {
  PUNCH_DEADLINE_PASSED_MESSAGE,
  PUNCH_OUTSIDE_WINDOW_MESSAGE,
  PUNCH_START_AFTER_PLANNED_MESSAGE,
  PUNCH_START_BEFORE_PLANNED_MESSAGE,
} from "@/lib/punch-time-guard";
import { loadOpenRecords } from "@/lib/supabase-data";

/** 打刻 API 向け: 試行回数・待ち・1 回あたりのタイムアウトをやや長めに */
export const PUNCH_NETWORK_RETRY_OPTIONS: NetworkRetryOptions = {
  maxAttempts: 4,
  baseDelayMs: 800,
  perAttemptTimeoutMs: 25_000,
};

export const PUNCH_GENERIC_NETWORK_ERROR =
  "通信に失敗しました。電波の良い場所で再度お試しください。";

export const PUNCH_ALREADY_STARTED_MESSAGE =
  "既に稼働開始済みです。「業務終了」から終了打刻を行ってください。";

export const PUNCH_NO_OPEN_RECORD_MESSAGE =
  "稼働開始の記録がありません。画面を更新したうえで、必要なら「業務開始」から打刻してください。";

const PASS_THROUGH_MESSAGES = new Set([
  JST_WEEKEND_WORK_REJECTED_MESSAGE,
  PUNCH_OUTSIDE_WINDOW_MESSAGE,
  PUNCH_DEADLINE_PASSED_MESSAGE,
  PUNCH_START_BEFORE_PLANNED_MESSAGE,
  PUNCH_START_AFTER_PLANNED_MESSAGE,
  WORK_DURATION_EXCEEDS_24H_MESSAGE,
  WORK_RECORD_SAME_START_END_MESSAGE,
  WORK_RECORD_END_NOT_AFTER_START_MESSAGE,
  PUNCH_ALREADY_STARTED_MESSAGE,
  PUNCH_NO_OPEN_RECORD_MESSAGE,
  "開始・終了は同一稼働日（日本時間）にしてください。",
  "稼働時間が0分以下のため保存できません。",
  "稼働時間が0分以下になります。開始時刻を調整してください。",
  "開始時刻を HH:mm（例 09:00）で入力してください。",
  "ユーザーが一致しません",
]);

/** 打刻失敗時: バリデーション・セッション等はそのまま、通信系のみ汎用メッセージ */
export function resolvePunchErrorMessage(
  error: unknown,
  fallback: string = PUNCH_GENERIC_NETWORK_ERROR
): string {
  const msg = (error instanceof Error ? error.message : typeof error === "string" ? error : "").trim();
  if (!msg) return fallback;
  if (PASS_THROUGH_MESSAGES.has(msg)) return msg;
  if (/^既に稼働開始/.test(msg)) return msg;
  if (/unauthorized|401|ログインしてください/i.test(msg)) {
    return "ログインセッションが切れました。一度ログアウトして再ログインしてください。";
  }
  if (/データベースに接続/i.test(msg)) {
    return "サーバーに接続できません。しばらく待ってから再試行してください。";
  }
  if (
    msg === NETWORK_TIMEOUT_ERROR ||
    /timeout|fetch failed|failed to fetch|network error|econnreset|enotfound|etimedout/i.test(msg)
  ) {
    return fallback;
  }
  if (msg.length <= 240) return msg;
  return fallback;
}

/** DB から本人の未終了打刻を取得（打刻直前の状態同期用） */
export async function loadMemberOpenRecordFromDb(userId: string): Promise<OpenRecord | null> {
  const list = await loadOpenRecords();
  return getOpenRecordForUser(list, userId) ?? null;
}
