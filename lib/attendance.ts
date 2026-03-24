/** メンバー（表示名・ログイン・委託料単価・振込先付き） */
export interface Member {
  id: string;
  name: string;
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
  /** インボイス番号（空の場合は未登録） */
  invoiceNumber?: string | null;
  /** 電話番号 */
  phoneNumber?: string;
  /** 有効フラグ。false の場合は論理削除（一覧非表示・ログイン不可）。未設定は true 扱い */
  isActive?: boolean;
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
}

/** KPI（テレアポ成果・1日1件） */
export interface KpiRecord {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  totalCalls: number; // 総コール数
  validCalls: number; // 総有効コール数
  kcCount: number; // KC（担当者接続）数
  followUpCreated: number; // 追いかけ作成数
  decisionMakerApo: number; // 決裁者アポ数
  nonDecisionMakerApo: number; // 非決裁者アポ数
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

export function calcDurationMinutes(startRounded: Date, endRounded: Date): number {
  return Math.max(0, Math.floor((endRounded.getTime() - startRounded.getTime()) / (1000 * 60)));
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
    const list = raw.map((r) => ensureUserId(r as WorkRecord)) as WorkRecord[];
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

/** 指定ユーザーの記録のみ取得 */
export function getRecordsForUser(records: WorkRecord[], userId: string): WorkRecord[] {
  return records.filter((r) => r.userId === userId);
}

/** 全件のうち指定ユーザー分を差し替えて保存 */
export function saveRecordsForUser(userId: string, userRecords: WorkRecord[]): void {
  const all = loadRecords();
  const rest = all.filter((r) => r.userId !== userId);
  const withUserId = userRecords.map((r) => ({ ...r, userId }));
  saveRecords([...rest, ...withUserId]);
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
    const list = raw.map((r) => ensureUserId(r as Shift)) as Shift[];
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

/** 全件のうち指定ユーザー分を差し替えて保存 */
export function saveShiftsForUser(userId: string, userShifts: Shift[]): void {
  const all = loadShifts();
  const rest = all.filter((s) => s.userId !== userId);
  const withUserId = userShifts.map((s) => ({ ...s, userId }));
  saveShifts([...rest, ...withUserId]);
}

/** 指定日の記録のみ */
export function getRecordsForDate(records: WorkRecord[], dateStr: string): WorkRecord[] {
  return records.filter((r) => r.date === dateStr);
}

/** 指定日の合計稼働分数 */
export function getTotalMinutesForDate(records: WorkRecord[], dateStr: string): number {
  return getRecordsForDate(records, dateStr).reduce((sum, r) => sum + r.durationMinutes, 0);
}

/** 指定月の記録 */
export function getRecordsForMonth(records: WorkRecord[], yearMonth: string): WorkRecord[] {
  return records.filter((r) => r.date.startsWith(yearMonth));
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

/** 指定日が属する週の月曜日（YYYY-MM-DD） */
export function getWeekStart(d: Date): string {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return toDateString(date);
}

/** 月曜日から日曜日まで7日分の日付配列 */
export function getWeekDates(weekStart: string): string[] {
  const [y, m, d] = weekStart.split("-").map(Number);
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(y, m - 1, d + i);
    dates.push(toDateString(date));
  }
  return dates;
}

/** 開始日・終了日を含む連続日付（入れ替えて正規化）。最長約2年で打ち切り */
export function getDateStringsInclusive(startDate: string, endDate: string): string[] {
  const start = startDate <= endDate ? startDate : endDate;
  const end = startDate <= endDate ? endDate : startDate;
  const out: string[] = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard < 800) {
    out.push(cur);
    guard++;
    const [y, m, d] = cur.split("-").map(Number);
    const next = new Date(y, m - 1, d + 1);
    cur = toDateString(next);
  }
  return out;
}

/** 提出対象週の月曜日：土日なら来週月曜、それ以外は今週月曜 */
export function getTargetWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) {
    const nextMon = new Date(now);
    nextMon.setDate(now.getDate() + (day === 0 ? 1 : 2));
    return getWeekStart(nextMon);
  }
  return getWeekStart(now);
}

/** 稼働可能日時登録の案内用（前週金曜 23:59）の日付 */
export function getDeadlineForWeek(weekStart: string): Date {
  const [y, m, d] = weekStart.split("-").map(Number);
  const friday = new Date(y, m - 1, d - 3);
  friday.setHours(23, 59, 0, 0);
  return friday;
}

/** 週開始日（YYYY-MM-DD）に 7n 日を加算した週開始を返す */
export function addWeeksToWeekStart(weekStart: string, weeks: number): string {
  const [y, m, d] = weekStart.split("-").map(Number);
  const date = new Date(y, m - 1, d + 7 * weeks);
  return toDateString(date);
}

/** 締め切り前の最初の週（登録可能な週）の月曜日。次週分は前週金曜23:59締めのため、締め切り過ぎなら次々週以降を返す */
export function getFirstOpenWeekStart(): string {
  let w = getTargetWeekStart();
  const now = new Date();
  while (now > getDeadlineForWeek(w)) {
    w = addWeeksToWeekStart(w, 1);
  }
  return w;
}

/** 指定週がまだ登録可能か（前週金曜23:59より前か） */
export function isWeekOpenForEntry(weekStart: string): boolean {
  return new Date() <= getDeadlineForWeek(weekStart);
}

/** 指定週の稼働予定を日付でマップ */
export function getShiftsByDateForWeek(shifts: Shift[], weekStart: string): Map<string, Shift> {
  const dates = getWeekDates(weekStart);
  const map = new Map<string, Shift>();
  dates.forEach((dateStr) => {
    const s = shifts.find((sh) => sh.date === dateStr);
    if (s) map.set(dateStr, s);
  });
  return map;
}

export function loadKpi(): KpiRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const s = localStorage.getItem(KEY_KPI);
    const raw: unknown[] = s ? JSON.parse(s) : [];
    const needsMigration = raw.some((r: unknown) => !(r as KpiRecord & { userId?: string }).userId);
    const list = raw.map((r) => ensureUserId(r as KpiRecord)) as KpiRecord[];
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

/** 全件のうち指定ユーザー分を差し替えて保存 */
export function saveKpiForUser(userId: string, userRecords: KpiRecord[]): void {
  const all = loadKpi();
  const rest = all.filter((r) => r.userId !== userId);
  const withUserId = userRecords.map((r) => ({ ...r, userId }));
  saveKpi([...rest, ...withUserId]);
}

function ensureMemberDefaults(m: Member): Member {
  return {
    ...m,
    loginAccount: m.loginAccount ?? "",
    password: m.password ?? "",
    hourlyRate: typeof m.hourlyRate === "number" && m.hourlyRate >= 0 ? m.hourlyRate : DEFAULT_HOURLY_RATE,
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

/** 月間概算委託料（分・委託料単価 → 円） */
export function calcMonthlyPay(totalMinutes: number, hourlyRate: number): number {
  if (!Number.isFinite(totalMinutes) || !Number.isFinite(hourlyRate) || hourlyRate < 0) return 0;
  return Math.floor((totalMinutes / 60) * hourlyRate);
}

/** 指定日のKPI（1日1件の想定） */
export function getKpiForDate(records: KpiRecord[], dateStr: string): KpiRecord | undefined {
  return records.find((r) => r.date === dateStr);
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
