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

// 1人あたりの上限。10/30 → 5/15 に下げたのち、時間帯制限の撤廃にあわせて時間あたりを10に戻した（2026-08-06）。
// メンバーには回数を告知しない方針なので、上限は「気づかれずに暴走を止める」水準に置く。
export const NAKANO_DEFAULT_HOURLY_LIMIT = 10;
// 1日15回のままだと1時間10回がほぼ効かない（2時間目以降が5回で頭打ち）ため30に合わせた。
export const NAKANO_DEFAULT_DAILY_LIMIT = 30;
export const NAKANO_DEFAULT_SHIFT_MARGIN_MINUTES = 30;

export const NAKANO_LINE_FALLBACK = "急ぎの用件は公式LINEへお願いします。";

/** 稼働開始から何ヶ月は回数無制限にするか */
export const NAKANO_UNLIMITED_MONTHS = 1;

/**
 * 導入時点で既に稼働している人を、全員「1ヶ月目」として扱うための期限。
 * この日までは初回稼働日に関係なく全員無制限。
 * 既存メンバーの初回稼働日は何ヶ月も前なので、これが無いと導入初日から全員が上限付きになる。
 */
export const NAKANO_DEFAULT_GRACE_UNTIL = "2026-09-07";

/** 上限が近いことを伝え始める使用回数（1時間あたり） */
export const NAKANO_NOTICE_AFTER_USES = 6;

export type NakanoDenyReason =
  | "not_launched"
  | "not_eligible"
  | "outside_shift_window"
  | "hourly_limit"
  | "daily_limit";

export type NakanoAccess =
  | { allowed: true; remainingHour: number; remainingDay: number; unlimited: boolean }
  | {
      allowed: false;
      reason: NakanoDenyReason;
      message: string;
      remainingHour: number;
      remainingDay: number;
      unlimited: boolean;
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
  /** この日（YYYY-MM-DD・JST）までは全員が回数無制限 */
  unlimitedGraceUntil: string;
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
    unlimitedGraceUntil:
      (env.NAKANO_UNLIMITED_GRACE_UNTIL ?? "").trim() || NAKANO_DEFAULT_GRACE_UNTIL,
  };
}

/**
 * YYYY-MM-DD の1ヶ月後を返す。月末は繰り上がらないよう丸める
 * （1/31 の1ヶ月後は 2/31 ではなく 2/28）。
 */
export function addMonthsYmd(ymd: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const total = (y * 12 + (mo - 1)) + months;
  const ny = Math.floor(total / 12);
  const nmo = (total % 12) + 1;
  // その月の日数に収める
  const lastDay = new Date(Date.UTC(ny, nmo, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nmo).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

/**
 * 回数無制限か。
 *
 * 稼働を始めたばかりの人ほど分からないことが多く、そこで上限に当たると
 * 結局これまでどおり公式LINEへ流れてしまう。入口の1ヶ月は開けておく。
 *
 * `firstWorkDate` が無い（まだ一度も稼働していない）人も無制限にする。
 * これから始める人なので、当然いちばん質問が多い。
 */
export function isNakanoUnlimited(params: {
  firstWorkDate: string | null;
  now: Date;
  graceUntilYmd: string;
}): boolean {
  const today = getTodayJstDateString(params.now);
  // 導入時点で在籍している人は全員この日まで無制限
  if (today <= params.graceUntilYmd) return true;
  const first = (params.firstWorkDate ?? "").trim();
  if (first === "") return true;
  return today <= addMonthsYmd(first, NAKANO_UNLIMITED_MONTHS);
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
  /** 稼働1ヶ月目などで回数無制限か。未指定は false */
  unlimited?: boolean;
}): NakanoAccess {
  const { member, shift, now, aiAskTimesMs, limits } = params;
  const unlimited = params.unlimited === true;
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
    unlimited,
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

  // 無制限の人はここで確定。対象者判定と公開前ゲートは通したうえで回数だけ免除する。
  if (unlimited) {
    return { allowed: true, remainingHour, remainingDay, unlimited: true };
  }

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

  return { allowed: true, remainingHour, remainingDay, unlimited: false };
}
