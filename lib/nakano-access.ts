/**
 * 中野くんの利用可否（対象者・稼働時間帯・回数上限）。純粋関数のみ。
 *
 * これらの判定は必ずサーバー側で行うこと。画面でボタンを隠すだけでは
 * API を直接叩けば通ってしまう。
 *
 * 設計: docs/superpowers/specs/2026-08-06-nakano-bot-design.md §5-A
 */

import type { Member, Shift } from "@/lib/attendance";
import { timeToMinutes } from "@/lib/attendance";
import { getTodayJstDateString } from "@/lib/export-schedule";
import { isNakanoAdmin, isNakanoAvailableTo } from "@/lib/nakano";

// 1人あたりの上限。運用判断で 10/30 から引き下げた（2026-08-06）。
export const NAKANO_DEFAULT_HOURLY_LIMIT = 5;
export const NAKANO_DEFAULT_DAILY_LIMIT = 15;
export const NAKANO_DEFAULT_SHIFT_MARGIN_MINUTES = 30;

export const NAKANO_LINE_FALLBACK = "急ぎの用件は公式LINEへお願いします。";

export type NakanoDenyReason =
  | "not_launched"
  | "not_eligible"
  | "outside_shift_window"
  | "hourly_limit"
  | "daily_limit";

export type NakanoAccess =
  | { allowed: true; remainingHour: number; remainingDay: number }
  | {
      allowed: false;
      reason: NakanoDenyReason;
      message: string;
      remainingHour: number;
      remainingDay: number;
    };

export type NakanoLimits = {
  hourlyLimit: number;
  dailyLimit: number;
  marginMinutes: number;
  /**
   * メンバーへ公開済みか。既定は false（管理者だけが使える試運転状態）。
   * 公開は取り返しがつかない（全メンバーの画面に一斉に出る）ので、
   * 環境変数を明示的に立てるまでは開かない側に倒す。
   */
  memberLaunched: boolean;
};

function positiveIntFromEnv(raw: string | undefined, fallback: number): number {
  const n = Number((raw ?? "").trim());
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  return i > 0 ? i : fallback;
}

function isTruthyEnv(raw: string | undefined): boolean {
  const t = (raw ?? "").trim().toLowerCase();
  return t === "1" || t === "true" || t === "yes";
}

export function readNakanoLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): NakanoLimits {
  return {
    hourlyLimit: positiveIntFromEnv(env.NAKANO_HOURLY_LIMIT, NAKANO_DEFAULT_HOURLY_LIMIT),
    dailyLimit: positiveIntFromEnv(env.NAKANO_DAILY_LIMIT, NAKANO_DEFAULT_DAILY_LIMIT),
    marginMinutes: positiveIntFromEnv(
      env.NAKANO_SHIFT_MARGIN_MINUTES,
      NAKANO_DEFAULT_SHIFT_MARGIN_MINUTES
    ),
    memberLaunched: isTruthyEnv(env.NAKANO_LAUNCHED),
  };
}

/** JST の「その日 0:00 からの分」 */
function jstMinutesSinceMidnight(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "NaN");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "NaN");
  if (!Number.isFinite(h) || !Number.isFinite(m)) return -1;
  return h * 60 + m;
}

function formatJstHhmm(at: Date): string {
  const mins = jstMinutesSinceMidnight(at);
  if (mins < 0) return "--:--";
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * その日のシフト予定から、中野くんに質問できる時間帯（JST・0:00からの分）を返す。
 * 2部制なら2区間。予定が無ければ null。
 *
 * 実際の打刻ではなく予定で判定するのは、「稼働開始ボタンが押せない」という
 * 最も多い相談を、押す前に受けられるようにするため。
 * また、稼働終了を押し忘れても予定終了+margin で自然に閉じる。
 */
export function getNakanoShiftWindowsJstMinutes(
  shift: Shift | undefined | null,
  marginMinutes: number = NAKANO_DEFAULT_SHIFT_MARGIN_MINUTES
): { from: number; to: number }[] | null {
  if (!shift) return null;

  const out: { from: number; to: number }[] = [];
  const pushRange = (start: string | undefined, end: string | undefined): void => {
    if (!start || !end) return;
    const s = timeToMinutes(start);
    const e = timeToMinutes(end);
    if (!Number.isFinite(s) || !Number.isFinite(e)) return;
    if (e < s) return;
    out.push({ from: s - marginMinutes, to: e + marginMinutes });
  };

  pushRange(shift.startPlanned, shift.endPlanned);
  pushRange(shift.startPlanned2, shift.endPlanned2);

  if (out.length === 0) return null;
  return out.sort((a, b) => a.from - b.from);
}

export function isWithinNakanoShiftWindow(
  now: Date,
  shift: Shift | undefined | null,
  marginMinutes: number = NAKANO_DEFAULT_SHIFT_MARGIN_MINUTES
): boolean {
  const windows = getNakanoShiftWindowsJstMinutes(shift, marginMinutes);
  if (!windows) return false;
  const mins = jstMinutesSinceMidnight(now);
  if (mins < 0) return false;
  return windows.some((w) => mins >= w.from && mins <= w.to);
}

/**
 * AIへの質問が可能かを判定する。
 *
 * `aiAskTimesMs` には、そのメンバーの「AI宛の質問（source='ai' かつ role='user'）」の
 * 発生時刻を直近24時間ぶん渡す。ステップ式クイック回答は API を呼ばないので含めない。
 *
 * 直近60分の判定は暦の毎時0分区切りではなくローリング。
 * 区切り方式だと 10:59 と 11:00 に連投して実質2倍撃てる穴が空くため。
 */
export function evaluateNakanoAiAccess(params: {
  member: Member;
  shift: Shift | undefined | null;
  now: Date;
  aiAskTimesMs: number[];
  limits: NakanoLimits;
}): NakanoAccess {
  const { member, shift, now, aiAskTimesMs, limits } = params;
  const nowMs = now.getTime();
  const todayYmd = getTodayJstDateString(now);

  const hourAgoMs = nowMs - 60 * 60 * 1000;
  const inHour = aiAskTimesMs.filter((t) => t > hourAgoMs && t <= nowMs).sort((a, b) => a - b);
  const inDay = aiAskTimesMs.filter((t) => getTodayJstDateString(new Date(t)) === todayYmd);

  const remainingHour = Math.max(0, limits.hourlyLimit - inHour.length);
  const remainingDay = Math.max(0, limits.dailyLimit - inDay.length);

  const deny = (reason: NakanoDenyReason, message: string): NakanoAccess => ({
    allowed: false,
    reason,
    message,
    remainingHour,
    remainingDay,
  });

  if (!isNakanoAvailableTo(member)) {
    return deny("not_eligible", `AIの中野くんはご利用いただけません。${NAKANO_LINE_FALLBACK}`);
  }

  // 公開前は管理者だけ。試運転を続けつつ、メンバーには一切出さない。
  if (!limits.memberLaunched && !isNakanoAdmin(member)) {
    return deny("not_launched", `AIの中野くんは準備中です。${NAKANO_LINE_FALLBACK}`);
  }

  // 稼働時間帯の制限は 2026-08-06 に撤廃した。
  // 「公式LINEに連絡する前にまず中野くんへ」という運用方針にした以上、
  // 時間外に聞けないままだと、その人はLINEに行くしかなくなり方針が破綻するため。
  // 費用の天井は回数上限（1時間/1日）で押さえているので、外しても上振れしない。
  // 復活させたいときは NAKANO_SHIFT_WINDOW_ENABLED を見るようにすればよい
  // （判定関数 isWithinNakanoShiftWindow はそのまま残してある）。

  if (remainingDay <= 0) {
    return deny(
      "daily_limit",
      `今日の質問はここまでです。よくある質問は見られます。${NAKANO_LINE_FALLBACK}`
    );
  }

  if (remainingHour <= 0) {
    // 直近60分の中で一番古い質問が窓から抜ける時刻＝次に1問空く時刻。
    const oldest = inHour[0];
    const retryAt = typeof oldest === "number" ? formatJstHhmm(new Date(oldest + 60 * 60 * 1000)) : null;
    return deny(
      "hourly_limit",
      retryAt
        ? `少し間を空けてください。${retryAt}ごろにまた質問できます。よくある質問はいつでも見られます。`
        : `少し間を空けてください。よくある質問はいつでも見られます。`
    );
  }

  return { allowed: true, remainingHour, remainingDay };
}
