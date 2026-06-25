import { formatYmdJst, parseStartInstantJstOnWorkDate } from "@/lib/punch-jst-time";
import {
  normalizeMemberContractorCategory,
  type MemberContractorCategory,
} from "@/lib/member-category";

/** メンバー（表示名・ログイン・委託料単価・振込先付き） */
export interface Member {
  id: string;
  name: string;
  /** フリガナ */
  furigana?: string;
  /** ログイン用アカウント名 */
  loginAccount?: string;
  /** パスワード（localStorage に平文保存・テスト用） */
  password?: string;
  /** 委託料単価（円/時間）。未設定時は DEFAULT_HOURLY_RATE */
  hourlyRate?: number;
  /** 郵便番号 */
  postalCode?: string;
  /** 住所 */
  address?: string;
  /** 銀行名 */
  bankName?: string;
  /** 支店名 */
  branchName?: string;
  /** 口座種別（普通 / 当座） */
  accountType?: string;
  /** 口座番号 */
  accountNumber?: string;
  /** 口座名義 */
  accountHolder?: string;
  /** 請求管理番号（3桁・DB: invoice_number） */
  invoiceNumber?: string | null;
  /** 適格請求書発行事業者登録番号（T+…・DB: invoice_registration_number） */
  invoiceRegistrationNumber?: string;
  /** 電話番号 */
  phoneNumber?: string;
  /** Slack メンバーID（例: U0123…）。シフト催促で <@…> メンションに使用 */
  slackId?: string | null;
  /** 有効フラグ。false の場合は論理削除（一覧非表示・ログイン不可）。未設定は true 扱い */
  isActive?: boolean;
  /** 初回稼働日（YYYY-MM-DD）。未設定は undefined / null */
  firstWorkDate?: string | null;
  /** true のときのみ稼働予定の開始を契約どおり 10:00 から選択可能。未設定・false は 14:00 以降のみ（新人制限） */
  canWorkMorning?: boolean;
  /** インターン（成果報酬型請求）。true のとき時給請求は 0 円 */
  isIntern?: boolean;
  /** インターン：決裁者商談確定の単価（円/件・税込）。未設定時は 2,000 */
  internRateDecisionMakerApps?: number;
  /** インターン：非決裁者商談確定の単価（円/件・税込）。未設定時は 500 */
  internRateNonDecisionMakerApps?: number;
  /**
   * 業務委託（時給制）の組織区分。インターン（isIntern）とは別。
   * general=一般 / sv=SV / fulltime_candidate=正社員候補
   */
  memberCategory?: MemberContractorCategory;
}

/** 請求管理番号が未入力か。有効メンバーかつ管理者アカウント以外のみ判定対象 */
export function isMemberMissingInvoiceNumber(m: Member): boolean {
  if (m.isActive === false) return false;
  if ((m.loginAccount ?? "").trim().toLowerCase() === "admin") return false;
  if (m.invoiceNumber == null) return true;
  return String(m.invoiceNumber).trim() === "";
}

/** 請求管理番号未入力の有効メンバー一覧（管理者除外） */
export function getActiveMembersMissingInvoiceNumber(members: Member[]): Member[] {
  return members.filter(isMemberMissingInvoiceNumber);
}

export const DEFAULT_HOURLY_RATE = 1400;

/**
 * 稼働記録の型
 */
export interface WorkRecord {
  id: string;
  userId: string;
  startRaw: string;
  startRounded: string;
  endRaw: string;
  endRounded: string;
  durationMinutes: number;
  date: string;
  /** 業務終了が未打刻のまま日付を跨いだ場合、予定終了時刻で自動補完した場合は true */
  isAutoCompleted?: boolean;
}

/** 未終了の活動（業務終了記録待ち） */
export interface OpenRecord {
  id: string;
  userId: string;
  startRaw: string;
  startRounded: string;
  date: string;
}

/** 稼働予定（1日2セット対応） */
export interface Shift {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  startPlanned: string; // HH:mm 15分刻み 予定1
  endPlanned: string;
  startPlanned2?: string; // 予定2
  endPlanned2?: string;
  /** API 送信のみ。DB には書かない。管理者の範囲保存などで merge の空枠維持をバイパスする */
  isManualDelete?: boolean;
}

/** KPI（テレアポ成果・1日1件） */
export interface KpiRecord {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  /** その KPI の紐づけ用開始時刻（HH:mm）。未設定は日次既定。DB の start_time と対応 */
  startTime?: string;
  totalCalls: number; // 総コール数
  validCalls: number; // 総有効コール数
  kcCount: number; // KC（担当者接続）数
  followUpCreated: number; // 追いかけ作成数
  decisionMakerApo: number; // 決裁者アポ数
  nonDecisionMakerApo: number; // 非決裁者アポ数
  /** 管理者確定：決裁者商談確定数（kpis.confirmed_dm） */
  confirmedDecisionMakerApps?: number;
  /** 管理者確定：非決裁者商談確定数（kpis.confirmed_non_dm） */
  confirmedNonDecisionMakerApps?: number;
  /** DB のみ。終了打刻後 KPI 未入力 Slack 送信済みの記録（ISO 時刻） */
  kpiMissingSlackNotifiedAt?: string | null;
}

/** 日次 KPI の既定開始（1日複数セッション用スロットを増やす場合の基準） */
export const KPI_DAY_DEFAULT_START_TIME = "00:00";

/** KPI 開始時刻を HH:mm に正規化（未設定・不正は日次既定） */
export function normalizeKpiStartTime(r: Pick<KpiRecord, "startTime">): string {
  const raw = r.startTime?.trim();
  if (!raw) return KPI_DAY_DEFAULT_START_TIME;
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!m) return KPI_DAY_DEFAULT_START_TIME;
  const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * DB の `kpis.start_time`（time 列）と一致させるため HH:mm:ss に正規化。
 * HH:mm・HH:mm:ss の双方を受け取れる。
 */
export function kpiStartTimeToSqlTime(s: string | undefined | null): string {
  const raw = (s ?? "").trim();
  if (raw === "" || /^undefined|null$/i.test(raw)) return "00:00:00";
  const t = raw;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (!m) return "00:00:00";
  const hh = String(Math.min(23, Math.max(0, parseInt(m[1], 10)))).padStart(2, "0");
  const mm = String(Math.min(59, Math.max(0, parseInt(m[2], 10)))).padStart(2, "0");
  const ss = m[3] != null ? String(Math.min(59, Math.max(0, parseInt(m[3], 10)))).padStart(2, "0") : "00";
  return `${hh}:${mm}:${ss}`;
}

const KPI_DATE_YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** KPI 行の `date`（YYYY-MM-DD）を検証し、不正なら null */
export function coerceKpiWorkDateYmd(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : String(v ?? "").trim();
  if (!KPI_DATE_YMD_RE.test(s)) return null;
  return s;
}

/**
 * `kpis.kpi_missing_slack_notified_at` 等 TIMESTAMPTZ 向け。
 * 空・`undefined` / `null` 文字列・解析不能は除外し、有効時は ISO 文字列を返す。
 */
export function coerceKpiTimestamptzField(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (s === "" || /^undefined|null$/i.test(s)) return undefined;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

/** KPI の集計・重複排除キー（ユーザー・日付・開始時刻） */
export function kpiAggregationKey(r: Pick<KpiRecord, "userId" | "date" | "startTime">): string {
  return `${r.userId}\t${r.date}\t${normalizeKpiStartTime(r)}`;
}

/** 活動記録の開始を JST の「その日の 0:00 からの分数」で表す（DB のユニーク・重複排除と一致させる） */
export function jstWorkStartMinuteFromIso(iso: string): number {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return hour * 60 + minute;
}

/** 同一ユーザー・同一稼働日・同一開始（JST・分単位）の重複排除キー */
export function workRecordAggregationKey(r: WorkRecord): string {
  return `${r.userId}\t${r.date}\t${jstWorkStartMinuteFromIso(r.startRounded)}`;
}

/** KPI に業務実績としての数値が1件でも入っているか（全指標0は未入力扱い） */
export function kpiRecordHasOperationalMetrics(r: KpiRecord | null | undefined): boolean {
  if (!r) return false;
  return (
    r.totalCalls > 0 ||
    r.validCalls > 0 ||
    r.kcCount > 0 ||
    r.followUpCreated > 0 ||
    r.decisionMakerApo > 0 ||
    r.nonDecisionMakerApo > 0
  );
}

/** 同一 userId + date のシフト行と KPI 行（管理画面・API 結合用） */
export type ShiftKpiSlot = { shift?: Shift; kpi?: KpiRecord };

/** shifts と kpis を userId+date で突き合わせたマップ */
export function mergeShiftsAndKpisByUserDate(shifts: Shift[], kpis: KpiRecord[]): Map<string, ShiftKpiSlot> {
  const m = new Map<string, ShiftKpiSlot>();
  for (const s of shifts) {
    const key = `${s.userId}\t${s.date}`;
    const cur = m.get(key) ?? {};
    cur.shift = s;
    m.set(key, cur);
  }
  const sortedKpis = [...kpis].sort((a, b) => {
    const aDef = normalizeKpiStartTime(a) === KPI_DAY_DEFAULT_START_TIME;
    const bDef = normalizeKpiStartTime(b) === KPI_DAY_DEFAULT_START_TIME;
    if (aDef !== bDef) return aDef ? 1 : -1;
    return a.id.localeCompare(b.id);
  });
  for (const k of sortedKpis) {
    const key = `${k.userId}\t${k.date}`;
    const cur = m.get(key) ?? {};
    cur.kpi = k;
    m.set(key, cur);
  }
  return m;
}

/** 結合マップを API 向け配列にする（存在する userId+date のみ） */
export function scheduleGridEntriesFromMerged(
  merged: Map<string, ShiftKpiSlot>
): { userId: string; date: string; shift: Shift | null; kpi: KpiRecord | null }[] {
  return Array.from(merged.entries()).map(([key, v]) => {
    const tab = key.indexOf("\t");
    return {
      userId: key.slice(0, tab),
      date: key.slice(tab + 1),
      shift: v.shift ?? null,
      kpi: v.kpi ?? null,
    };
  });
}

const KEY_RECORDS = "kado-records";
const KEY_OPEN = "kado-open";
const KEY_SHIFTS = "kado-shifts";
const KEY_KPI = "kado-kpi";
const KEY_MEMBERS = "kado-members";
const KEY_AUTO_BACKUP = "kado-auto-backup";
const KEY_AUTO_BACKUP_AT = "kado-auto-backup-at";
const DEFAULT_USER_ID = "default";

function ensureUserId<T extends { userId?: string }>(item: T): T & { userId: string } {
  return { ...item, userId: (item as { userId?: string }).userId ?? DEFAULT_USER_ID };
}

/** 日付の 00:00 からの分数を取得 */
function getMinutesFromMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function setMinutesOnDate(date: Date, totalMinutes: number): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(totalMinutes);
  return d;
}

export function roundUpTo15Minutes(date: Date): Date {
  const mins = getMinutesFromMidnight(date);
  const rounded = Math.ceil(mins / 15) * 15;
  return setMinutesOnDate(date, rounded);
}

export function roundDownTo15Minutes(date: Date): Date {
  const mins = getMinutesFromMidnight(date);
  const rounded = Math.floor(mins / 15) * 15;
  return setMinutesOnDate(date, rounded);
}

/**
 * 2 つの瞬間の差分（分・切り捨て）。打刻・15 分丸めレコードでは、
 * 同一稼働日（JST）内の開始・終了に揃えた上で使うこと。
 */
export function calcDurationMinutes(startRounded: Date, endRounded: Date): number {
  return Math.max(0, Math.floor((endRounded.getTime() - startRounded.getTime()) / (1000 * 60)));
}

/** 1 日あたり保存可能な最大連続稼働（分）。超える記録は無効 */
export const WORK_DURATION_HARD_MAX_MINUTES = 24 * 60;
/** 超えたら本人・管理者 UI で確認ダイアログ（分） */
export const WORK_DURATION_SOFT_CONFIRM_MINUTES = 12 * 60;

export const WORK_DURATION_EXCEEDS_24H_MESSAGE = "稼働時間が24時間を超える記録は保存できません。";
/** 活動記録・打刻（同一時刻のまま保存不可） */
export const WORK_RECORD_SAME_START_END_MESSAGE = "開始と終了を同じ時間に設定できません";
/** 終了が開始より前（同日・時刻順） */
export const WORK_RECORD_END_NOT_AFTER_START_MESSAGE = "終了時刻は開始時刻より後にしてください";
export function assertWorkRecordsDurationWithinHardCap(records: WorkRecord[]): void {
  for (const r of records) {
    const d = r.durationMinutes;
    if (!Number.isFinite(d) || d <= 0) {
      throw new Error("稼働時間が0分以下の記録は保存できません");
    }
    if (d > WORK_DURATION_HARD_MAX_MINUTES) {
      throw new Error(WORK_DURATION_EXCEEDS_24H_MESSAGE);
    }
  }
}

export { formatYmdJst };

/**
 * 指定日・HH:mm から活動記録を生成（15分丸め）。終了≦開始なら null。
 * 管理者の予実調整・フォーム保存の共通処理。
 */
export function buildWorkRecordFromHhmmOnDate(
  dateStr: string,
  startTime: string,
  endTime: string,
  userId: string,
  id?: string,
  isAutoCompleted?: boolean
): WorkRecord | null {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const startDate = new Date(y, m - 1, d, sh, sm);
  const endDate = new Date(y, m - 1, d, eh, em);
  if (endDate.getTime() <= startDate.getTime()) return null;
  const startRounded = roundUpTo15Minutes(startDate);
  const endRounded = roundDownTo15Minutes(endDate);
  const durationMinutes = calcDurationMinutes(startRounded, endRounded);
  if (durationMinutes <= 0) return null;
  /** 同一暦日・時刻のみを想定。丸め後も開始≧終了なら無効 */
  if (durationMinutes > WORK_DURATION_HARD_MAX_MINUTES) return null;
  return {
    id: id ?? crypto.randomUUID(),
    userId,
    startRaw: startRounded.toISOString(),
    startRounded: startRounded.toISOString(),
    endRaw: endRounded.toISOString(),
    endRounded: endRounded.toISOString(),
    date: dateStr,
    durationMinutes,
    ...(isAutoCompleted === true && { isAutoCompleted: true }),
  };
}

/**
 * 管理者の予実「手動で時間を編集」用。JST の壁時計どおり解釈し 15 分丸めは行わない（1 分単位）。
 * 終了が開始より**厳密に前**のときだけ翌日跨ぎ（+24h）。同一時刻は無効（null）。
 */
export function buildAdminExactWorkRecord(
  dateYmd: string,
  startHhmm: string,
  endHhmm: string,
  breakMinutes: number,
  userId: string,
  id?: string
): WorkRecord | null {
  const start = parseStartInstantJstOnWorkDate(dateYmd, startHhmm);
  const end = parseStartInstantJstOnWorkDate(dateYmd, endHhmm);
  if (!start || !end) return null;
  let endMs = end.getTime();
  const startMs = start.getTime();
  if (endMs === startMs) return null;
  if (endMs < startMs) endMs += 24 * 60 * 60 * 1000;
  const gross = Math.floor((endMs - startMs) / 60000);
  if (gross > WORK_DURATION_HARD_MAX_MINUTES) return null;
  const br = Math.max(0, Math.floor(breakMinutes));
  const durationMinutes = Math.max(0, gross - br);
  if (durationMinutes <= 0) return null;
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();
  return {
    id: id ?? crypto.randomUUID(),
    userId,
    startRaw: startIso,
    startRounded: startIso,
    endRaw: endIso,
    endRounded: endIso,
    durationMinutes,
    date: dateYmd,
  };
}

export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function formatDuration(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}分`;
  if (m === 0) return `${h}時間`;
  return `${h}時間${m}分`;
}

export function loadRecords(): WorkRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const s = localStorage.getItem(KEY_RECORDS);
    const raw: unknown[] = s ? JSON.parse(s) : [];
    const needsMigration = raw.some((r: unknown) => !(r as { userId?: string }).userId);
    const list = dedupeWorkRecordsByUserDateStart(raw.map((r) => ensureUserId(r as WorkRecord)) as WorkRecord[]);
    if (needsMigration && list.length > 0) saveRecords(list);
    return list;
  } catch {
    return [];
  }
}

export function saveRecords(records: WorkRecord[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY_RECORDS, JSON.stringify(records));
}

/** 同一ユーザー・同一稼働日・同一開始（JST・分単位）の重複行を1件にまとめる（辞書順で最小の id を残す）。ISO 表記ゆれでも同一開始は1件に */
export function dedupeWorkRecordsByUserDateStart(records: WorkRecord[]): WorkRecord[] {
  const m = new Map<string, WorkRecord>();
  for (const r of records) {
    const k = workRecordAggregationKey(r);
    const ex = m.get(k);
    if (!ex || r.id.localeCompare(ex.id) < 0) m.set(k, r);
  }
  return Array.from(m.values());
}

/** 同一ユーザー・同一日・同一 KPI 開始時刻の重複を1件にまとめる（辞書順で最小の id を残す） */
export function dedupeKpiRecordsByUserDate(records: KpiRecord[]): KpiRecord[] {
  const m = new Map<string, KpiRecord>();
  for (const r of records) {
    const k = kpiAggregationKey(r);
    const ex = m.get(k);
    if (!ex || r.id.localeCompare(ex.id) < 0) m.set(k, r);
  }
  return Array.from(m.values());
}

/** 同一ユーザー・同一日の稼働予定の重複を1件にまとめる（辞書順で最小の id を残す） */
export function dedupeShiftsByUserDate(shifts: Shift[]): Shift[] {
  const m = new Map<string, Shift>();
  for (const s of shifts) {
    const k = `${s.userId}\t${s.date}`;
    const ex = m.get(k);
    if (!ex || s.id.localeCompare(ex.id) < 0) m.set(k, s);
  }
  return Array.from(m.values());
}

/** 指定ユーザーの記録のみ取得 */
export function getRecordsForUser(records: WorkRecord[], userId: string): WorkRecord[] {
  return dedupeWorkRecordsByUserDateStart(records.filter((r) => r.userId === userId));
}

/** 指定ユーザー・指定日の活動記録 */
export function getRecordsForUserAndDate(records: WorkRecord[], userId: string, dateStr: string): WorkRecord[] {
  return dedupeWorkRecordsByUserDateStart(records.filter((r) => r.userId === userId && r.date === dateStr));
}

/** 全件のうち指定ユーザー分を差し替えて保存 */
export function saveRecordsForUser(userId: string, userRecords: WorkRecord[]): void {
  const all = loadRecords();
  const rest = all.filter((r) => r.userId !== userId);
  const withUserId = userRecords.map((r) => ({ ...r, userId }));
  saveRecords(dedupeWorkRecordsByUserDateStart([...rest, ...withUserId]));
}

/** 未終了稼働はユーザーごとに1件ずつ（配列で保存） */
export function loadOpenRecords(): OpenRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const s = localStorage.getItem(KEY_OPEN);
    if (!s) return [];
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) {
      const needsMigration = parsed.some((r: OpenRecord & { userId?: string }) => !r.userId);
      const list = parsed.map((r: OpenRecord) => ensureUserId(r)) as OpenRecord[];
      if (needsMigration && list.length > 0) saveOpenRecords(list);
      return list;
    }
    const single = ensureUserId(parsed as OpenRecord) as OpenRecord;
    if (!(parsed as OpenRecord & { userId?: string }).userId) saveOpenRecords([single]);
    return [single];
  } catch {
    return [];
  }
}

export function saveOpenRecords(records: OpenRecord[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY_OPEN, JSON.stringify(records));
}

/** 指定ユーザーの未終了稼働 */
export function getOpenRecordForUser(openRecords: OpenRecord[], userId: string): OpenRecord | null {
  return openRecords.find((r) => r.userId === userId) ?? null;
}

/** 指定ユーザーの未終了稼働を設定（nullで解除） */
export function setOpenRecordForUser(userId: string, record: OpenRecord | null): void {
  const all = loadOpenRecords();
  const rest = all.filter((r) => r.userId !== userId);
  const next = record ? [...rest, { ...record, userId }] : rest;
  saveOpenRecords(next);
}

export function loadShifts(): Shift[] {
  if (typeof window === "undefined") return [];
  try {
    const s = localStorage.getItem(KEY_SHIFTS);
    const raw: unknown[] = s ? JSON.parse(s) : [];
    const needsMigration = raw.some((r: unknown) => !(r as Shift & { userId?: string }).userId);
    const list = dedupeShiftsByUserDate(raw.map((r) => ensureUserId(r as Shift)) as Shift[]);
    if (needsMigration && list.length > 0) saveShifts(list);
    return list;
  } catch {
    return [];
  }
}

export function saveShifts(shifts: Shift[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY_SHIFTS, JSON.stringify(shifts));
}

/** 指定ユーザーの稼働予定のみ取得 */
export function getShiftsForUser(shifts: Shift[], userId: string): Shift[] {
  return shifts.filter((s) => s.userId === userId);
}

/** 予定1が「なし」・空以外の実時間か（マージ・UI の削除制限で使用） */
export function shiftHasConcretePrimaryPlanned(s: Shift): boolean {
  const sp = (s.startPlanned ?? "").trim();
  const ep = (s.endPlanned ?? "").trim();
  if (sp === "" || sp === "なし") return false;
  if (ep === "" || ep === "なし") return false;
  return true;
}

function shiftPrimarySlotIsConcrete(s: Shift): boolean {
  return shiftHasConcretePrimaryPlanned(s);
}

function shiftSecondarySlotIsConcrete(s: Shift): boolean {
  const sp = (s.startPlanned2 ?? "").trim();
  const ep = (s.endPlanned2 ?? "").trim();
  if (sp === "" || sp === "なし") return false;
  if (ep === "" || ep === "なし") return false;
  return true;
}

/** 予定1が「稼働なし」として明示送信されているか（UI の「この日の稼働予定なし」等）。空文字だけの欠損とは区別する */
export function shiftPrimarySlotIsExplicitNoneEntry(s: Shift): boolean {
  const sp = (s.startPlanned ?? "").trim();
  const ep = (s.endPlanned ?? "").trim();
  const isNoneVal = (v: string) => v === SHIFT_ENTRY_NONE || v === "なし";
  return isNoneVal(sp) && isNoneVal(ep);
}

/** 予定2を「なし」で明示クリアしているか（枠2を意図的に消す保存） */
export function shiftSecondarySlotIsExplicitNoneEntry(s: Shift): boolean {
  const sp = (s.startPlanned2 ?? "").trim();
  const ep = (s.endPlanned2 ?? "").trim();
  const isNoneVal = (v: string) => v === SHIFT_ENTRY_NONE || v === "なし";
  return isNoneVal(sp) && isNoneVal(ep);
}

/**
 * 枠ごとに「既存が実時間・送信が空や未入力」のとき既存枠を維持する（事故防止）。
 * ただし送信が **明示的に「なし／なし」** のときは意図的な稼働なしとみなし、DB を上書きする。
 */
function mergeShiftRowPreserveEmptySlots(dbRow: Shift, inc: Shift): Shift {
  const { isManualDelete, ...incNoFlag } = inc;
  if (isManualDelete === true) {
    return { ...incNoFlag, userId: inc.userId };
  }
  const explicitPrimaryNone = shiftPrimarySlotIsExplicitNoneEntry(inc);
  const explicitSecondaryNone = shiftSecondarySlotIsExplicitNoneEntry(inc);
  const usePrimaryDb =
    shiftPrimarySlotIsConcrete(dbRow) && !shiftPrimarySlotIsConcrete(inc) && !explicitPrimaryNone;
  const useSecondaryDb =
    shiftSecondarySlotIsConcrete(dbRow) && !shiftSecondarySlotIsConcrete(inc) && !explicitSecondaryNone;
  return {
    ...incNoFlag,
    userId: inc.userId,
    startPlanned: usePrimaryDb ? dbRow.startPlanned : inc.startPlanned,
    endPlanned: usePrimaryDb ? dbRow.endPlanned : inc.endPlanned,
    startPlanned2: useSecondaryDb ? dbRow.startPlanned2 : inc.startPlanned2,
    endPlanned2: useSecondaryDb ? dbRow.endPlanned2 : inc.endPlanned2,
  };
}

function kpiRowIsEffectivelyEmpty(r: KpiRecord): boolean {
  return (
    r.totalCalls === 0 &&
    r.validCalls === 0 &&
    r.kcCount === 0 &&
    r.followUpCreated === 0 &&
    r.decisionMakerApo === 0 &&
    r.nonDecisionMakerApo === 0
  );
}

function kpiRowHasAnyMetric(r: KpiRecord): boolean {
  return !kpiRowIsEffectivelyEmpty(r);
}

/**
 * incoming にある日付はクライアント値で上書きし、ない日付は既存行を維持する。
 * 部分ペイロード・古いクライアント状態で他日付の行が消えるのを防ぐ。
 * 枠ごとに DB に実時間があるのに送信が **空・未入力** のときだけ既存枠を維持する。
 * 送信が **明示的に「なし／なし」** のときは意図的な稼働なしとして DB を上書きする。
 */
export function mergeUserShiftsPreserveExistingByDate(all: Shift[], userId: string, incoming: Shift[]): Shift[] {
  const incomingByDate = new Map<string, Shift>();
  for (const s of incoming) {
    incomingByDate.set(s.date, { ...s, userId });
  }
  const rest = all.filter((s) => s.userId !== userId);
  const dbForUser = all.filter((s) => s.userId === userId);
  const canonicalByDate = new Map<string, Shift>();
  for (const s of dbForUser) {
    const cur = canonicalByDate.get(s.date);
    if (!cur || s.id.localeCompare(cur.id) < 0) canonicalByDate.set(s.date, s);
  }
  const mergedUser: Shift[] = [];
  Array.from(canonicalByDate.entries()).forEach(([date, dbRow]) => {
    const inc = incomingByDate.get(date);
    if (inc === undefined) {
      mergedUser.push(dbRow);
    } else {
      mergedUser.push(mergeShiftRowPreserveEmptySlots(dbRow, { ...inc, userId }));
    }
  });
  Array.from(incomingByDate.values()).forEach((inc) => {
    if (!canonicalByDate.has(inc.date)) mergedUser.push(inc);
  });
  return [...rest, ...mergedUser];
}

/** 全件のうち指定ユーザー分を差し替えて保存 */
export function saveShiftsForUser(userId: string, userShifts: Shift[]): void {
  const all = loadShifts();
  saveShifts(mergeUserShiftsPreserveExistingByDate(all, userId, userShifts));
}

/** 指定日の記録のみ */
export function getRecordsForDate(records: WorkRecord[], dateStr: string): WorkRecord[] {
  return dedupeWorkRecordsByUserDateStart(records.filter((r) => r.date === dateStr));
}

/** 指定日の合計稼働分数 */
export function getTotalMinutesForDate(records: WorkRecord[], dateStr: string): number {
  return getRecordsForDate(records, dateStr).reduce((sum, r) => sum + r.durationMinutes, 0);
}

/**
 * 1日の活動記録から最早開始・最遅終了・休憩等（勤務窓 − 実働合計）・実働合計を求める。
 * 実働が0分の記録だけの日は null。
 */
export function aggregateUserWorkDaySpan(
  records: WorkRecord[],
  userId: string,
  dateStr: string
): {
  totalWorkMinutes: number;
  earliestStartIso: string;
  latestEndIso: string;
  breakOrGapMinutes: number;
} | null {
  const dayRecs = getRecordsForUserAndDate(records, userId, dateStr).filter((r) => r.durationMinutes > 0);
  if (dayRecs.length === 0) return null;
  const totalWorkMinutes = dayRecs.reduce((s, r) => s + r.durationMinutes, 0);
  let minStart = dayRecs[0].startRounded;
  let maxEnd = dayRecs[0].endRounded;
  for (let i = 1; i < dayRecs.length; i++) {
    const r = dayRecs[i];
    if (new Date(r.startRounded).getTime() < new Date(minStart).getTime()) minStart = r.startRounded;
    if (new Date(r.endRounded).getTime() > new Date(maxEnd).getTime()) maxEnd = r.endRounded;
  }
  const spanMinutes = calcDurationMinutes(new Date(minStart), new Date(maxEnd));
  const breakOrGapMinutes = Math.max(0, spanMinutes - totalWorkMinutes);
  return { totalWorkMinutes, earliestStartIso: minStart, latestEndIso: maxEnd, breakOrGapMinutes };
}

/** 指定月の記録 */
export function getRecordsForMonth(records: WorkRecord[], yearMonth: string): WorkRecord[] {
  return dedupeWorkRecordsByUserDateStart(records.filter((r) => r.date.startsWith(yearMonth)));
}

/** 指定月の合計稼働分数 */
export function getTotalMinutesForMonth(records: WorkRecord[], yearMonth: string): number {
  return getRecordsForMonth(records, yearMonth).reduce((sum, r) => sum + r.durationMinutes, 0);
}

/** 記録・稼働予定・KPIから選択可能な年月リスト */
export function getSelectableMonths(
  records: WorkRecord[],
  shifts: Shift[],
  kpiRecords: KpiRecord[] = []
): string[] {
  const set = new Set<string>();
  const now = new Date();
  set.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  records.forEach((r) => {
    const [y, m] = r.date.split("-");
    set.add(`${y}-${m}`);
  });
  shifts.forEach((s) => {
    const [y, m] = s.date.split("-");
    set.add(`${y}-${m}`);
  });
  kpiRecords.forEach((k) => {
    const [y, m] = k.date.split("-");
    set.add(`${y}-${m}`);
  });
  return Array.from(set).sort().reverse();
}

/** 15分刻みの時刻オプション（HH:mm） */
export function get15MinOptions(): string[] {
  const opts: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      opts.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return opts;
}

/** HH:mm を分数に変換 */
export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** 「稼働予定なし」の値。このときは時間 0 として扱う */
export const SHIFT_ENTRY_NONE = "なし";

/** 稼働予定の時刻は 10:00〜22:00（業務委託個別契約書）。分数（0:00 起点） */
export const SHIFT_PLANNED_OPERATING_WINDOW_START_MINUTES = 10 * 60;
/** 22:00 を含む（22:15 は不可） */
export const SHIFT_PLANNED_OPERATING_WINDOW_END_MINUTES = 22 * 60;

/** @deprecated 互換用。`SHIFT_PLANNED_OPERATING_WINDOW_START_MINUTES` と同じ */
export const SHIFT_PLANNED_EARLIEST_START_MINUTES = SHIFT_PLANNED_OPERATING_WINDOW_START_MINUTES;

/** UI・API 共通（10:00 未満） */
export const SHIFT_PLANNED_START_BUSINESS_RULE_MESSAGE = "稼働予定は10:00以降で入力してください";

/** UI・API 共通（22:00 超過） */
export const SHIFT_PLANNED_LATEST_BUSINESS_RULE_MESSAGE = "稼働予定は22:00までです";

/** 各枠で開始と終了が同じ */
export const SHIFT_PLANNED_SAME_START_END_MESSAGE = "開始と終了を同じ時間に設定できません";
/** 終了が開始より前＝日跨ぎ（同日の時刻として無効） */
export const SHIFT_PLANNED_OVERNIGHT_NOT_ALLOWED_MESSAGE =
  "稼働予定は日を跨いで設定できません（終了は開始より後の同日時刻にしてください）";

/** フォーム新規日の既定開始・終了 */
export const SHIFT_WEEKDAY_DEFAULT_START = "10:00";
export const SHIFT_WEEKDAY_DEFAULT_END = "18:00";

/** 稼働予定の HH:mm が 10:00〜22:00（両端含む）に収まるか */
export function shiftPlannedHhmmInOperatingWindow(hhmm: string): boolean {
  const m = timeToMinutes(hhmm);
  return (
    !Number.isNaN(m) &&
    m >= SHIFT_PLANNED_OPERATING_WINDOW_START_MINUTES &&
    m <= SHIFT_PLANNED_OPERATING_WINDOW_END_MINUTES
  );
}

/** 窓外のときのみ「早すぎ / 遅すぎ」。窓内・不正形式は null（不正形式は別途バリデーション） */
export function shiftPlannedHhmmWindowViolation(hhmm: string): "early" | "late" | null {
  const m = timeToMinutes(hhmm);
  if (Number.isNaN(m)) return "early";
  if (m < SHIFT_PLANNED_OPERATING_WINDOW_START_MINUTES) return "early";
  if (m > SHIFT_PLANNED_OPERATING_WINDOW_END_MINUTES) return "late";
  return null;
}

/** @deprecated `shiftPlannedHhmmInOperatingWindow` を使用 */
export function shiftPlannedStartMeetsSiteRule(hhmm: string): boolean {
  return shiftPlannedHhmmInOperatingWindow(hhmm);
}

/** 新人制限: 予定開始は 14:00 以降のみ（分・0:00 起点） */
export const SHIFT_PLANNED_NEW_MEMBER_EARLIEST_START_MINUTES = 14 * 60;

/** 保存・API 用（シフトの開始が早すぎるとき） */
export const SHIFT_MORNING_RESTRICT_SAVE_MESSAGE = "14時以降を選択してください";

/** 新規登録（外部フォーム・管理画面の追加）時の can_work_morning 初期値。午前は管理者が許可するまで不可 */
export const DEFAULT_CAN_WORK_MORNING_FOR_NEW_MEMBER = false;

/** 10:00〜22:00 のうち、下限分以上を 15 分刻みで列挙（新人は min を 14:00 に） */
export function get15MinShiftPlannedOperatingWindowOptions(
  minMinutesFloor: number = SHIFT_PLANNED_OPERATING_WINDOW_START_MINUTES
): string[] {
  const lo = Math.max(SHIFT_PLANNED_OPERATING_WINDOW_START_MINUTES, minMinutesFloor);
  const hi = SHIFT_PLANNED_OPERATING_WINDOW_END_MINUTES;
  const out: string[] = [];
  for (let M = lo; M <= hi; M += 15) {
    const h = Math.floor(M / 60);
    const min = M % 60;
    out.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }
  return out;
}

export type ShiftPlannedTimeSelectOption = {
  value: string;
  disabled?: boolean;
  /** 表示ラベル（未指定なら value） */
  label?: string;
};

/** @deprecated `ShiftPlannedTimeSelectOption` */
export type ShiftPlannedStartSelectOption = ShiftPlannedTimeSelectOption;

function pushOutOfWindowOrphan(
  out: ShiftPlannedTimeSelectOption[],
  cur: string,
  noneLike: boolean,
  floorMinutes: number = SHIFT_PLANNED_OPERATING_WINDOW_START_MINUTES
): void {
  if (noneLike) return;
  const m = timeToMinutes(cur);
  const lo = Math.max(SHIFT_PLANNED_OPERATING_WINDOW_START_MINUTES, floorMinutes);
  if (Number.isNaN(m)) {
    out.push({ value: cur, disabled: true, label: `${cur}（10:00〜22:00に変更してください）` });
    return;
  }
  if (m < lo) {
    out.push({
      value: cur,
      disabled: true,
      label:
        lo > SHIFT_PLANNED_OPERATING_WINDOW_START_MINUTES
          ? `${cur}（${SHIFT_MORNING_RESTRICT_SAVE_MESSAGE}）`
          : `${cur}（10:00以降に変更してください）`,
    });
    return;
  }
  if (m > SHIFT_PLANNED_OPERATING_WINDOW_END_MINUTES) {
    out.push({
      value: cur,
      disabled: true,
      label: `${cur}（22:00までに変更してください）`,
    });
  }
}

/**
 * 予定1の開始用 select。「なし」＋10:00〜22:00（新人は opts で 14:00 から）。窓外の既存値のみ disabled で表示。
 */
export function buildShiftPrimaryPlannedStartSelectOptions(
  currentS1: string,
  opts?: { minimumStartMinutes?: number }
): ShiftPlannedTimeSelectOption[] {
  const floor =
    opts?.minimumStartMinutes != null
      ? Math.max(SHIFT_PLANNED_OPERATING_WINDOW_START_MINUTES, opts.minimumStartMinutes)
      : SHIFT_PLANNED_OPERATING_WINDOW_START_MINUTES;
  const out: ShiftPlannedTimeSelectOption[] = [{ value: SHIFT_ENTRY_NONE }];
  const cur = currentS1;
  const noneLike = cur === SHIFT_ENTRY_NONE || cur === "なし" || cur.trim() === "";
  pushOutOfWindowOrphan(out, cur, noneLike, floor);
  for (const t of get15MinShiftPlannedOperatingWindowOptions(floor)) {
    out.push({ value: t });
  }
  return out;
}

/**
 * 予定1の終了用 select。「なし」＋10:00〜22:00。開始より後の時刻のみ選択可能（同日・日跨ぎ防止）。
 */
export function buildShiftPrimaryPlannedEndSelectOptions(currentE1: string, primaryStart?: string): ShiftPlannedTimeSelectOption[] {
  const out: ShiftPlannedTimeSelectOption[] = [{ value: SHIFT_ENTRY_NONE }];
  const cur = currentE1;
  const noneLike = cur === SHIFT_ENTRY_NONE || cur === "なし" || cur.trim() === "";
  pushOutOfWindowOrphan(out, cur, noneLike);
  const startM =
    primaryStart != null &&
    primaryStart !== SHIFT_ENTRY_NONE &&
    primaryStart !== "なし" &&
    primaryStart.trim() !== ""
      ? timeToMinutes(primaryStart)
      : null;
  for (const t of get15MinShiftPlannedOperatingWindowOptions()) {
    const tm = timeToMinutes(t);
    if (startM != null && !Number.isNaN(startM) && !Number.isNaN(tm) && tm <= startM) continue;
    out.push({ value: t });
  }
  return out;
}

/**
 * 予定2の開始用。先頭は空（「—」）＋10:00〜22:00（新人は opts で 14:00 から）。
 */
export function buildShiftSecondaryPlannedStartSelectOptions(
  currentS2: string,
  opts?: { minimumStartMinutes?: number }
): ShiftPlannedTimeSelectOption[] {
  const floor =
    opts?.minimumStartMinutes != null
      ? Math.max(SHIFT_PLANNED_OPERATING_WINDOW_START_MINUTES, opts.minimumStartMinutes)
      : SHIFT_PLANNED_OPERATING_WINDOW_START_MINUTES;
  const out: ShiftPlannedTimeSelectOption[] = [{ value: "" }];
  const cur = (currentS2 ?? "").trim();
  pushOutOfWindowOrphan(out, cur, cur === "", floor);
  for (const t of get15MinShiftPlannedOperatingWindowOptions(floor)) {
    out.push({ value: t });
  }
  return out;
}

/**
 * 予定2の終了用。先頭は空（「—」）＋10:00〜22:00。予定2の開始より後のみ選択可能。
 */
export function buildShiftSecondaryPlannedEndSelectOptions(currentE2: string, secondaryStart?: string): ShiftPlannedTimeSelectOption[] {
  const out: ShiftPlannedTimeSelectOption[] = [{ value: "" }];
  const cur = (currentE2 ?? "").trim();
  pushOutOfWindowOrphan(out, cur, cur === "");
  const startM =
    secondaryStart != null && secondaryStart.trim() !== "" && secondaryStart !== SHIFT_ENTRY_NONE && secondaryStart !== "なし"
      ? timeToMinutes(secondaryStart)
      : null;
  for (const t of get15MinShiftPlannedOperatingWindowOptions()) {
    const tm = timeToMinutes(t);
    if (startM != null && !Number.isNaN(startM) && !Number.isNaN(tm) && tm <= startM) continue;
    out.push({ value: t });
  }
  return out;
}

function plannedHhmmViolationMessage(hhmm: string): string | null {
  const m = timeToMinutes(hhmm);
  if (Number.isNaN(m)) return SHIFT_PLANNED_START_BUSINESS_RULE_MESSAGE;
  if (m < SHIFT_PLANNED_OPERATING_WINDOW_START_MINUTES) return SHIFT_PLANNED_START_BUSINESS_RULE_MESSAGE;
  if (m > SHIFT_PLANNED_OPERATING_WINDOW_END_MINUTES) return SHIFT_PLANNED_LATEST_BUSINESS_RULE_MESSAGE;
  return null;
}

/** 各枠内: 同一時刻・日跨ぎ（終了≦開始）を契約上禁止 */
function plannedSlotSameTimeOrOvernightViolation(start: string, end: string): string | null {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (Number.isNaN(s) || Number.isNaN(e)) return null;
  if (e === s) return SHIFT_PLANNED_SAME_START_END_MESSAGE;
  if (e < s) return SHIFT_PLANNED_OVERNIGHT_NOT_ALLOWED_MESSAGE;
  return null;
}

/** 1 行のシフトについて、予定時刻が 10:00〜22:00 外、または枠内の前後関係が不正ならメッセージ、なければ null */
export function validateShiftRowPlannedOperatingWindow(shift: Shift): string | null {
  if (shift.startPlanned !== SHIFT_ENTRY_NONE && shift.startPlanned !== "なし") {
    const a = plannedHhmmViolationMessage(shift.startPlanned);
    if (a) return a;
    const b = plannedHhmmViolationMessage(shift.endPlanned);
    if (b) return b;
    const o1 = plannedSlotSameTimeOrOvernightViolation(shift.startPlanned, shift.endPlanned);
    if (o1) return o1;
  }
  const sp2 = (shift.startPlanned2 ?? "").trim();
  const ep2 = (shift.endPlanned2 ?? "").trim();
  if (sp2 && ep2 && sp2 !== SHIFT_ENTRY_NONE && sp2 !== "なし") {
    const c = plannedHhmmViolationMessage(sp2);
    if (c) return c;
    const d = plannedHhmmViolationMessage(ep2);
    if (d) return d;
    const o2 = plannedSlotSameTimeOrOvernightViolation(sp2, ep2);
    if (o2) return o2;
  }
  return null;
}

/** @deprecated `validateShiftRowPlannedOperatingWindow` */
export function validateShiftRowPlannedStartTimes(shift: Shift): string | null {
  return validateShiftRowPlannedOperatingWindow(shift);
}

export function validateShiftsPlannedOperatingWindow(shifts: Shift[]): string | null {
  for (const s of shifts) {
    const msg = validateShiftRowPlannedOperatingWindow(s);
    if (msg) return msg;
  }
  return null;
}

/** canWorkMorning が false のユーザーは、稼働予定の開始（枠1・枠2）が 14:00 未満なら不可 */
export function validateShiftsPlannedMorningStartRestriction(
  shifts: Shift[],
  canWorkMorning: boolean
): string | null {
  if (canWorkMorning) return null;
  for (const s of shifts) {
    if (s.startPlanned !== SHIFT_ENTRY_NONE && s.startPlanned !== "なし") {
      const m1 = timeToMinutes(s.startPlanned);
      if (!Number.isNaN(m1) && m1 < SHIFT_PLANNED_NEW_MEMBER_EARLIEST_START_MINUTES) {
        return SHIFT_MORNING_RESTRICT_SAVE_MESSAGE;
      }
    }
    const sp2 = (s.startPlanned2 ?? "").trim();
    if (sp2 && sp2 !== SHIFT_ENTRY_NONE && sp2 !== "なし") {
      const m2 = timeToMinutes(sp2);
      if (!Number.isNaN(m2) && m2 < SHIFT_PLANNED_NEW_MEMBER_EARLIEST_START_MINUTES) {
        return SHIFT_MORNING_RESTRICT_SAVE_MESSAGE;
      }
    }
  }
  return null;
}

/** @deprecated `validateShiftsPlannedOperatingWindow` */
export function validateShiftsPlannedStartTimes(shifts: Shift[]): string | null {
  return validateShiftsPlannedOperatingWindow(shifts);
}

/** 稼働予定の時間（分）を計算（予定1+2）。稼働予定なしの場合は 0 */
export function getShiftPlannedMinutes(shift: Shift): number {
  if (shift.startPlanned === SHIFT_ENTRY_NONE || shift.startPlanned === "なし") return 0;
  const start = timeToMinutes(shift.startPlanned);
  const end = timeToMinutes(shift.endPlanned);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  let mins = Math.max(0, end - start);
  if (shift.startPlanned2 != null && shift.endPlanned2 != null && shift.startPlanned2 !== "なし" && shift.endPlanned2 !== "なし") {
    const s2 = timeToMinutes(shift.startPlanned2);
    const e2 = timeToMinutes(shift.endPlanned2);
    if (!Number.isNaN(s2) && !Number.isNaN(e2)) mins += Math.max(0, e2 - s2);
  }
  return mins;
}

/** 同一 userId+date の複数行があるとき id 昇順で先頭を代表とする（予実・日別実績の結合キー用） */
export function canonicalShiftForUserDate(shifts: Shift[], userId: string, date: string): Shift | undefined {
  const candidates = shifts.filter((s) => s.userId === userId && s.date === date);
  if (candidates.length === 0) return undefined;
  return candidates.reduce((a, b) => (a.id <= b.id ? a : b));
}

/** 表示用：稼働予定の時間帯テキスト（枠1・枠2）。実予定がなければ null */
export function formatShiftPlannedTimeRanges(shift: Shift): string | null {
  const segs: string[] = [];
  if (shiftHasConcretePrimaryPlanned(shift)) {
    segs.push(`${shift.startPlanned} - ${shift.endPlanned}`);
  }
  const sp2 = (shift.startPlanned2 ?? "").trim();
  const ep2 = (shift.endPlanned2 ?? "").trim();
  const slot2Empty =
    sp2 === "" ||
    sp2 === SHIFT_ENTRY_NONE ||
    sp2 === "なし" ||
    ep2 === "" ||
    ep2 === SHIFT_ENTRY_NONE ||
    ep2 === "なし";
  if (!slot2Empty) {
    segs.push(`${shift.startPlanned2} - ${shift.endPlanned2}`);
  }
  return segs.length ? segs.join(" / ") : null;
}

/**
 * 日別実績テーブル用：枠1・枠2のうち実時間の枠を、稼働開始予定が早い順に返す。
 * （枠1が 14:00〜、枠2が 10:00〜 のときは枠2を先に並べる）
 */
export function getShiftPlannedSegmentsChronological(
  shift: Shift | null | undefined
): { startHhmm: string; endHhmm: string; startMin: number }[] {
  if (!shift) return [];
  const segs: { startHhmm: string; endHhmm: string; startMin: number }[] = [];
  if (shiftHasConcretePrimaryPlanned(shift)) {
    const sm = timeToMinutes(shift.startPlanned);
    if (!Number.isNaN(sm)) segs.push({ startHhmm: shift.startPlanned, endHhmm: shift.endPlanned, startMin: sm });
  }
  if (shiftSecondarySlotIsConcrete(shift)) {
    const sm = timeToMinutes(shift.startPlanned2!);
    if (!Number.isNaN(sm)) segs.push({ startHhmm: shift.startPlanned2!, endHhmm: shift.endPlanned2!, startMin: sm });
  }
  segs.sort((a, b) => a.startMin - b.startMin);
  return segs;
}

/** ソート用：その日の「最も早い稼働開始予定」の分（0 時からの経過分）。予定が無ければ null */
export function earliestPlannedShiftStartMinutes(shift: Shift | null | undefined): number | null {
  const segs = getShiftPlannedSegmentsChronological(shift);
  if (segs.length === 0) return null;
  return segs[0]!.startMin;
}

/** その日の「最も遅い稼働終了予定」の分（0 時からの経過分）。予定が無ければ null */
export function latestPlannedShiftEndMinutes(shift: Shift | null | undefined): number | null {
  const segs = getShiftPlannedSegmentsChronological(shift);
  if (segs.length === 0) return null;
  let maxEnd = -1;
  for (const seg of segs) {
    const em = timeToMinutes(seg.endHhmm);
    if (!Number.isNaN(em)) maxEnd = Math.max(maxEnd, em);
  }
  return maxEnd >= 0 ? maxEnd : null;
}

/** 日別実績「稼働予定」列：10:00〜12:00 を改行で連結。予定なしは "—" */
export function formatShiftPlannedForDailyActualCell(shift: Shift | null | undefined): string {
  const segs = getShiftPlannedSegmentsChronological(shift);
  if (segs.length === 0) return "—";
  return segs.map((s) => `${s.startHhmm}〜${s.endHhmm}`).join("\n");
}

export type PlannedShiftListEntry = {
  userId: string;
  name: string;
  plannedLabel: string;
  /** インターン生（成果報酬制）の場合に true。Slack 通知のセクション分けに使用 */
  isIntern?: boolean;
};

/** 指定日に実稼働予定があるメンバーを名前順で返す（Slack 朝通知・管理画面用） */
export function buildPlannedShiftListForDate(
  shifts: Shift[],
  dateStr: string,
  members: Pick<Member, "id" | "name" | "isActive" | "isIntern">[]
): PlannedShiftListEntry[] {
  const activeIds = new Set(members.filter((m) => m.isActive !== false).map((m) => m.id));
  const byUser = new Map<string, Shift>();
  for (const s of shifts) {
    if (s.date !== dateStr || !activeIds.has(s.userId)) continue;
    if (!formatShiftPlannedTimeRanges(s)) continue;
    if (!byUser.has(s.userId)) byUser.set(s.userId, s);
  }
  const entries: PlannedShiftListEntry[] = [];
  Array.from(byUser.entries()).forEach(([userId, shift]) => {
    const plannedLabel = formatShiftPlannedTimeRanges(shift);
    if (!plannedLabel) return;
    const member = members.find((m) => m.id === userId);
    const name = member?.name?.trim() ?? "";
    if (!name) return;
    entries.push({
      userId,
      name,
      plannedLabel,
      isIntern: member?.isIntern === true,
    });
  });
  entries.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  return entries;
}

/** 指定日が属する週の月曜日（YYYY-MM-DD） */
export function getWeekStart(d: Date): string {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return toLocalDateString(date);
}

/** 月曜日から日曜日まで7日分の日付配列（ローカル暦・ISO週と一致） */
export function getWeekDates(weekStart: string): string[] {
  const [y, m, d] = weekStart.split("-").map(Number);
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(y, m - 1, d + i);
    dates.push(toLocalDateString(date));
  }
  return dates;
}

/** ローカル暦の YYYY-MM-DD（`<input type="date">` と一致。toISOString ベースだとタイムゾーンで日付がずれる） */
export function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 暦日ベースの日数差（終了−開始、同日なら0）。無効な日付は null */
function diffInclusiveCalendarDays(startYmd: string, endYmd: string): number | null {
  if (!YMD_RE.test(startYmd) || !YMD_RE.test(endYmd)) return null;
  const [ys, ms, ds] = startYmd.split("-").map(Number);
  const [ye, me, de] = endYmd.split("-").map(Number);
  const s = new Date(ys, ms - 1, ds);
  const e = new Date(ye, me - 1, de);
  if (s.getFullYear() !== ys || s.getMonth() !== ms - 1 || s.getDate() !== ds) return null;
  if (e.getFullYear() !== ye || e.getMonth() !== me - 1 || e.getDate() !== de) return null;
  const startUtc = Date.UTC(ys, ms - 1, ds);
  const endUtc = Date.UTC(ye, me - 1, de);
  return Math.floor((endUtc - startUtc) / (24 * 60 * 60 * 1000));
}

/**
 * 開始日・終了日を含む連続日付（昇順）。
 * - 引数の開始が終了より後なら []（入れ替えない）
 * - ループは「含む日数」＝差分+1 回のみ（最大 ABS_MAX 日で打ち切り）
 * - 1 日ずつ進めるのは setDate（ミリ秒加算は使わない）
 */
const DATE_RANGE_ABS_MAX = 400;

export function getDateStringsInclusive(startDate: string, endDate: string): string[] {
  if (!YMD_RE.test(startDate) || !YMD_RE.test(endDate)) return [];
  if (startDate > endDate) return [];

  const diff = diffInclusiveCalendarDays(startDate, endDate);
  if (diff === null) return [];
  const inclusiveCount = diff + 1;
  if (inclusiveCount < 1 || inclusiveCount > DATE_RANGE_ABS_MAX) return [];

  const [ys, ms, ds] = startDate.split("-").map(Number);
  const current = new Date(ys, ms - 1, ds);
  if (current.getFullYear() !== ys || current.getMonth() !== ms - 1 || current.getDate() !== ds) {
    return [];
  }

  const out: string[] = [];
  for (let i = 0; i < inclusiveCount; i++) {
    out.push(toLocalDateString(current));
    if (i === inclusiveCount - 1) break;
    current.setDate(current.getDate() + 1);
  }
  return out;
}

/**
 * 「来週」の月曜（提出リマインド・未登録判定の基準）。
 * 今日を含む週の月曜から 1 週後（ISO 週・月曜始まり）。
 */
export function getTargetWeekStart(): string {
  return addWeeksToWeekStart(getWeekStart(new Date()), 1);
}

/** YYYY-MM-DD が属する週の月曜（日付のみの暦演算） */
export function getMondayOfCalendarWeekForYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const wd = new Date(y, m - 1, d).getDay();
  const diff = wd === 0 ? -6 : 1 - wd;
  const mon = new Date(y, m - 1, d + diff);
  return toLocalDateString(mon);
}

/** YYYY-MM-DD の暦上が土曜・日曜か（getMondayOfCalendarWeekForYmd と同じ日付解釈） */
export function isWeekendYmd(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  const wd = new Date(y, m - 1, d).getDay();
  return wd === 0 || wd === 6;
}

/**
 * その週（weekStart = 月曜）のシフト提出締切: 直前の日曜 23:59:59.999（JST）を表す瞬間。
 * 比較は getTime() で行う（日本は夏時間なしのため UTC 14:59:59.999 当日 = JST 23:59:59.999）。
 */
export function getDeadlineForWeek(weekStartMondayYmd: string): Date {
  const [y0, m0, d0] = weekStartMondayYmd.split("-").map(Number);
  const prevSun = new Date(y0, m0 - 1, d0 - 1);
  const y = prevSun.getFullYear();
  const mo = prevSun.getMonth();
  const d = prevSun.getDate();
  return new Date(Date.UTC(y, mo, d, 14, 59, 59, 999));
}

/** 週開始日（YYYY-MM-DD）に 7n 日を加算した週開始を返す */
export function addWeeksToWeekStart(weekStart: string, weeks: number): string {
  const [y, m, d] = weekStart.split("-").map(Number);
  const date = new Date(y, m - 1, d + 7 * weeks);
  return toLocalDateString(date);
}

/** この週の月曜を基準に「来週」「再来週」の月曜 */
export function getSubmittableShiftWeekMondays(thisWeekMondayYmd: string): [string, string] {
  return [addWeeksToWeekStart(thisWeekMondayYmd, 1), addWeeksToWeekStart(thisWeekMondayYmd, 2)];
}

/**
 * 提出用に選べる週の月曜一覧（上から順に UI 表示）。
 * 先頭は常に「今週」（締切ロジックなし）。続けて来週・再来週のうち締切前のもの。
 */
export function getOrderedSubmittableShiftWeeks(thisWeekMondayYmd: string): string[] {
  const w0 = thisWeekMondayYmd;
  const [w1, w2] = getSubmittableShiftWeekMondays(thisWeekMondayYmd);
  const out: string[] = [w0];
  if (isWeekOpenForEntry(w1, thisWeekMondayYmd)) out.push(w1);
  if (isWeekOpenForEntry(w2, thisWeekMondayYmd)) out.push(w2);
  return out;
}

/** 提出を受け付ける週のうち、いま編集可能な最初の週（今週を最優先） */
export function getFirstOpenShiftWeekStart(thisWeekMondayYmd: string): string | null {
  const weeks = getOrderedSubmittableShiftWeeks(thisWeekMondayYmd);
  return weeks[0] ?? null;
}

/**
 * 指定週がまだ登録可能か。
 * - 今週（currentWeekMondayYmd と同一の週開始日）: 締切なしで常に true
 * - それ以外: 前週の日曜 23:59 JST まで
 */
export function isWeekOpenForEntry(weekStart: string, currentWeekMondayYmd?: string): boolean {
  if (currentWeekMondayYmd !== undefined && weekStart === currentWeekMondayYmd) return true;
  return Date.now() <= getDeadlineForWeek(weekStart).getTime();
}

/** 指定週の稼働予定を日付でマップ。同一日付が複数ある場合は id が最小の1件に寄せる（重複行の表示・保存ずれ防止） */
export function getShiftsByDateForWeek(shifts: Shift[], weekStart: string, userId?: string): Map<string, Shift> {
  const dates = getWeekDates(weekStart);
  const map = new Map<string, Shift>();
  const pool = userId ? shifts.filter((sh) => sh.userId === userId) : shifts;
  dates.forEach((dateStr) => {
    const candidates = pool.filter((sh) => sh.date === dateStr);
    if (candidates.length === 0) return;
    const s = candidates.reduce((a, b) => (a.id <= b.id ? a : b));
    map.set(dateStr, s);
  });
  return map;
}

export function loadKpi(): KpiRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const s = localStorage.getItem(KEY_KPI);
    const raw: unknown[] = s ? JSON.parse(s) : [];
    const needsMigration = raw.some((r: unknown) => !(r as KpiRecord & { userId?: string }).userId);
    const list = dedupeKpiRecordsByUserDate(raw.map((r) => ensureUserId(r as KpiRecord)) as KpiRecord[]);
    if (needsMigration && list.length > 0) saveKpi(list);
    return list;
  } catch {
    return [];
  }
}

export function saveKpi(records: KpiRecord[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY_KPI, JSON.stringify(records));
}

/** 指定ユーザーのKPIのみ取得 */
export function getKpiForUser(records: KpiRecord[], userId: string): KpiRecord[] {
  return records.filter((r) => r.userId === userId);
}

export type MergeUserKpiOptions = {
  /**
   * このキー（`kpiAggregationKey`）に一致するスロットは、送信が全指標0でも既存行を残さず上書きする。
   * メンバー画面の「保存する」など、ユーザーが明示的に保存した行に使う。
   */
  explicitSlotKeys?: Set<string>;
};

/** 日付＋KPI 開始スロットでマージ（部分保存で他日の KPI が消えないようにする）。全指標0の送信で既存の数値を潰さない。 */
export function mergeUserKpiPreserveExistingByDate(
  all: KpiRecord[],
  userId: string,
  incoming: KpiRecord[],
  opts?: MergeUserKpiOptions
): KpiRecord[] {
  const incomingBySlot = new Map<string, KpiRecord>();
  for (const r of incoming) {
    const row = { ...r, userId };
    incomingBySlot.set(kpiAggregationKey(row), row);
  }
  const rest = all.filter((r) => r.userId !== userId);
  const dbForUser = all.filter((r) => r.userId === userId);
  const canonicalBySlot = new Map<string, KpiRecord>();
  for (const r of dbForUser) {
    const key = kpiAggregationKey(r);
    const cur = canonicalBySlot.get(key);
    if (!cur || r.id.localeCompare(cur.id) < 0) canonicalBySlot.set(key, r);
  }
  const mergedUser: KpiRecord[] = [];
  Array.from(canonicalBySlot.values()).forEach((dbRow) => {
    const inc = incomingBySlot.get(kpiAggregationKey(dbRow));
    if (inc === undefined) {
      mergedUser.push(dbRow);
    } else if (
      !opts?.explicitSlotKeys?.has(kpiAggregationKey(dbRow)) &&
      kpiRowHasAnyMetric(dbRow) &&
      kpiRowIsEffectivelyEmpty(inc)
    ) {
      mergedUser.push(dbRow);
    } else {
      const preservedFlag =
        kpiRowIsEffectivelyEmpty(dbRow) && kpiRowIsEffectivelyEmpty(inc) && dbRow.kpiMissingSlackNotifiedAt
          ? { kpiMissingSlackNotifiedAt: dbRow.kpiMissingSlackNotifiedAt }
          : {};
      mergedUser.push({ ...inc, userId, ...preservedFlag });
    }
  });
  Array.from(incomingBySlot.values()).forEach((inc) => {
    if (!canonicalBySlot.has(kpiAggregationKey(inc))) mergedUser.push(inc);
  });
  return [...rest, ...mergedUser];
}

/** 全件のうち指定ユーザー分を差し替えて保存 */
export function saveKpiForUser(userId: string, userRecords: KpiRecord[]): void {
  const all = loadKpi();
  saveKpi(mergeUserKpiPreserveExistingByDate(all, userId, userRecords));
}

function ensureMemberDefaults(m: Member): Member {
  return {
    ...m,
    loginAccount: m.loginAccount ?? "",
    password: m.password ?? "",
    hourlyRate: typeof m.hourlyRate === "number" && m.hourlyRate >= 0 ? m.hourlyRate : DEFAULT_HOURLY_RATE,
    isIntern: m.isIntern === true,
    memberCategory: normalizeMemberContractorCategory(m.memberCategory),
  };
}

/** メンバー一覧（未登録ならデフォルト1件を返して保存） */
export function loadMembers(): Member[] {
  if (typeof window === "undefined") return [{ id: DEFAULT_USER_ID, name: "ユーザー1", loginAccount: "", password: "", hourlyRate: DEFAULT_HOURLY_RATE }];
  try {
    const s = localStorage.getItem(KEY_MEMBERS);
    if (s) {
      const list = JSON.parse(s) as Member[];
      if (Array.isArray(list) && list.length > 0) {
        const normalized = list.map(ensureMemberDefaults);
        const needsMigration = list.some((m: Member) => m.hourlyRate == null);
        if (needsMigration) saveMembers(normalized);
        return normalized;
      }
    }
    const defaultList: Member[] = [{ id: DEFAULT_USER_ID, name: "ユーザー1", loginAccount: "", password: "", hourlyRate: DEFAULT_HOURLY_RATE }];
    localStorage.setItem(KEY_MEMBERS, JSON.stringify(defaultList));
    return defaultList;
  } catch {
    const defaultList: Member[] = [{ id: DEFAULT_USER_ID, name: "ユーザー1", loginAccount: "", password: "", hourlyRate: DEFAULT_HOURLY_RATE }];
    try {
      localStorage.setItem(KEY_MEMBERS, JSON.stringify(defaultList));
    } catch {
      /* ignore */
    }
    return defaultList;
  }
}

export function saveMembers(members: Member[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY_MEMBERS, JSON.stringify(members));
}

export function addMember(
  name: string,
  options?: { loginAccount?: string; password?: string; hourlyRate?: number }
): Member {
  const members = loadMembers();
  const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const newMember: Member = {
    id,
    name: name.trim() || id,
    loginAccount: options?.loginAccount?.trim() ?? "",
    password: options?.password ?? "",
    hourlyRate:
      typeof options?.hourlyRate === "number" && options.hourlyRate >= 0 ? options.hourlyRate : DEFAULT_HOURLY_RATE,
  };
  saveMembers([...members, ensureMemberDefaults(newMember)]);
  return newMember;
}

/** メンバー情報を更新（名前・ログイン・パスワード・委託料単価） */
export function updateMember(memberId: string, updates: Partial<Pick<Member, "name" | "loginAccount" | "password" | "hourlyRate">>): void {
  const members = loadMembers();
  const next = members.map((m) => (m.id === memberId ? ensureMemberDefaults({ ...m, ...updates }) : m));
  saveMembers(next);
}

/** メンバーを削除（一覧から除外。稼働・稼働予定・KPIデータは残る） */
export function deleteMember(memberId: string): void {
  const members = loadMembers().filter((m) => m.id !== memberId);
  saveMembers(members.length > 0 ? members : [{ id: DEFAULT_USER_ID, name: "ユーザー1", loginAccount: "", password: "", hourlyRate: DEFAULT_HOURLY_RATE }]);
}

/** 指定ユーザーの指定月の稼働分数合計（15分刻み実績） */
export function getTotalMinutesForMonthByUser(records: WorkRecord[], userId: string, yearMonth: string): number {
  return getTotalMinutesForMonth(getRecordsForUser(records, userId), yearMonth);
}

/** 指定ユーザーの指定期間（開始日・終了日を含む）の稼働分数合計 */
export function getTotalMinutesForUserInDateRange(
  records: WorkRecord[],
  userId: string,
  startDate: string,
  endDate: string
): number {
  return dedupeWorkRecordsByUserDateStart(
    records.filter((r) => r.userId === userId && r.date >= startDate && r.date <= endDate)
  ).reduce((sum, r) => sum + r.durationMinutes, 0);
}

/** 月間概算委託料（分・委託料単価 → 円） */
export function calcMonthlyPay(totalMinutes: number, hourlyRate: number): number {
  if (!Number.isFinite(totalMinutes) || !Number.isFinite(hourlyRate) || hourlyRate < 0) return 0;
  return Math.floor((totalMinutes / 60) * hourlyRate);
}

/** 指定日の KPI（既定スロット 00:00 を優先） */
export function getKpiForDate(records: KpiRecord[], dateStr: string): KpiRecord | undefined {
  const day = records.filter((r) => r.date === dateStr);
  if (day.length === 0) return undefined;
  const def = day.find((r) => normalizeKpiStartTime(r) === KPI_DAY_DEFAULT_START_TIME);
  return def ?? day[0];
}

/**
 * 日別実績ビュー: その日に稼働予定（shifts の分数）がある、または実稼働が 1 分でもある、
 * または当日の未終了打刻（open_records）があるメンバーを表示対象とする。
 */
export function userQualifiesForDailyActualView(
  records: WorkRecord[],
  shifts: Shift[],
  userId: string,
  dateStr: string,
  openRecords?: OpenRecord[]
): boolean {
  const shift = canonicalShiftForUserDate(shifts, userId, dateStr);
  const plannedMins = shift != null ? getShiftPlannedMinutes(shift) : 0;
  const actualMins = getRecordsForUserAndDate(records, userId, dateStr).reduce((s, r) => s + r.durationMinutes, 0);
  if (openRecords?.some((o) => o.userId === userId && o.date === dateStr)) return true;
  return plannedMins > 0 || actualMins > 0;
}

/** 指定月のKPI */
export function getKpiForMonth(records: KpiRecord[], yearMonth: string): KpiRecord[] {
  return records.filter((r) => r.date.startsWith(yearMonth));
}

/** 割合を安全に計算（分母0ならnull） */
export function safeRatePercent(num: number, denom: number): number | null {
  if (denom === 0 || !Number.isFinite(denom)) return null;
  return Math.round((num / denom) * 1000) / 10;
}

/** 1件のKPIから生産性指標（有効率・KC率・アポ率） */
export function getKpiRates(k: KpiRecord): {
  validRate: number | null;
  kcRate: number | null;
  apoRate: number | null;
} {
  return {
    validRate: safeRatePercent(k.validCalls, k.totalCalls),
    kcRate: safeRatePercent(k.kcCount, k.validCalls),
    apoRate: safeRatePercent(k.decisionMakerApo, k.kcCount),
  };
}

/** 全データを1つのオブジェクトにまとめてエクスポート用に返す */
export function exportAllData(): {
  version: number;
  exportedAt: string;
  records: WorkRecord[];
  openRecords: OpenRecord[];
  shifts: Shift[];
  kpi: KpiRecord[];
  members: Member[];
} {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    records: loadRecords(),
    openRecords: loadOpenRecords(),
    shifts: loadShifts(),
    kpi: loadKpi(),
    members: loadMembers(),
  };
}

/** エクスポートしたJSONから全データを復元する */
export function importAllData(data: {
  version?: number;
  records?: WorkRecord[];
  openRecords?: OpenRecord[];
  shifts?: Shift[];
  kpi?: KpiRecord[];
  members?: Member[];
}): void {
  if (typeof window === "undefined") return;
  if (data.records && Array.isArray(data.records)) saveRecords(data.records);
  if (data.openRecords && Array.isArray(data.openRecords)) saveOpenRecords(data.openRecords);
  if (data.shifts && Array.isArray(data.shifts)) saveShifts(data.shifts);
  if (data.kpi && Array.isArray(data.kpi)) saveKpi(data.kpi);
  if (data.members && Array.isArray(data.members) && data.members.length > 0) saveMembers(data.members);
}

/** 自動バックアップ用: 現在の全データを localStorage のバックアップスロットに上書き保存 */
export function saveAutoBackup(): void {
  if (typeof window === "undefined") return;
  const data = exportAllData();
  try {
    localStorage.setItem(KEY_AUTO_BACKUP, JSON.stringify(data));
    localStorage.setItem(KEY_AUTO_BACKUP_AT, new Date().toISOString());
  } catch (_) {
    // localStorage 容量超過など
  }
}

/** 自動バックアップの有無と最終保存日時 */
export function getAutoBackupInfo(): { savedAt: string | null; hasBackup: boolean } {
  if (typeof window === "undefined") return { savedAt: null, hasBackup: false };
  const at = localStorage.getItem(KEY_AUTO_BACKUP_AT);
  const raw = localStorage.getItem(KEY_AUTO_BACKUP);
  return { savedAt: at, hasBackup: !!raw };
}

/** 自動バックアップから復元（localStorage のバックアップスロットを現在データに上書き） */
export function restoreFromAutoBackup(): boolean {
  if (typeof window === "undefined") return false;
  const raw = localStorage.getItem(KEY_AUTO_BACKUP);
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === "object") {
      importAllData(data);
      return true;
    }
  } catch (_) {}
  return false;
}

/** 指定月のKPI累計 */
export function getMonthlyKpiTotals(
  records: KpiRecord[],
  yearMonth: string
): {
  totalCalls: number;
  validCalls: number;
  kcCount: number;
  followUpCreated: number;
  decisionMakerApo: number;
  nonDecisionMakerApo: number;
  totalApo: number;
} {
  const monthRecords = getKpiForMonth(records, yearMonth);
  return getKpiTotalsFromRecords(monthRecords);
}

/** 今週の月曜日（YYYY-MM-DD）。日本時間の「今」に対する週の月曜日 */
export function getThisWeekMondayDateString(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const dayNum = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${dayNum}`;
}

/** 指定期間内のKPIレコード（開始日・終了日を含む） */
export function getKpiInDateRange(
  records: KpiRecord[],
  startDate: string,
  endDate: string
): KpiRecord[] {
  return records.filter((r) => r.date >= startDate && r.date <= endDate);
}

/** KPIレコード配列から合計を集計（有効率・KC率・アポ率は別計算） */
export function getKpiTotalsFromRecords(records: KpiRecord[]): {
  totalCalls: number;
  validCalls: number;
  kcCount: number;
  followUpCreated: number;
  decisionMakerApo: number;
  nonDecisionMakerApo: number;
  totalApo: number;
} {
  return {
    totalCalls: records.reduce((s, r) => s + r.totalCalls, 0),
    validCalls: records.reduce((s, r) => s + r.validCalls, 0),
    kcCount: records.reduce((s, r) => s + r.kcCount, 0),
    followUpCreated: records.reduce((s, r) => s + r.followUpCreated, 0),
    decisionMakerApo: records.reduce((s, r) => s + r.decisionMakerApo, 0),
    nonDecisionMakerApo: records.reduce((s, r) => s + r.nonDecisionMakerApo, 0),
    totalApo: records.reduce(
      (s, r) => s + r.decisionMakerApo + r.nonDecisionMakerApo,
      0
    ),
  };
}

/**
 * 決裁者アポ1件あたりのコスト（円）＝総支払額 ÷ 決裁者アポ数。
 * 決裁者アポが 0、または総支払が有限でないときは null（画面では「—」等）。
 */
export function decisionMakerApoUnitYenFromPay(totalPayYen: number, decisionMakerApo: number): number | null {
  if (!Number.isFinite(totalPayYen) || decisionMakerApo <= 0) return null;
  const u = totalPayYen / decisionMakerApo;
  return Number.isFinite(u) ? u : null;
}
