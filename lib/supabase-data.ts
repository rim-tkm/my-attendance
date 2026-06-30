import bcrypt from "bcryptjs";
import type { Member, WorkRecord, OpenRecord, Shift, KpiRecord } from "@/lib/attendance";
import {
  assertWorkRecordsDurationWithinHardCap,
  canonicalShiftForUserDate,
  coerceKpiTimestamptzField,
  coerceKpiWorkDateYmd,
  DEFAULT_CAN_WORK_MORNING_FOR_NEW_MEMBER,
  DEFAULT_HOURLY_RATE,
  dedupeKpiRecordsByUserDate,
  dedupeShiftsByUserDate,
  dedupeWorkRecordsByUserDateStart,
  kpiAggregationKey,
  kpiStartTimeToSqlTime,
  mergeUserKpiPreserveExistingByDate,
  mergeUserShiftsPreserveExistingByDate,
  normalizeKpiStartTime,
} from "@/lib/attendance";
import {
  appendKpiChangeHistoryForSlots,
  fetchKpiUpsertPayloadsBySlots,
  logShiftUpsertHistory,
  type KpiSlot,
} from "@/lib/data-change-history";
import {
  MEMBER_CONTRACTOR_CATEGORY_DEFAULT,
  normalizeMemberContractorCategory,
} from "@/lib/member-category";
import { shiftHasPlannedWorkHours } from "@/lib/shift-planned-work";
import { getSupabase } from "@/lib/supabase";
import { isWeekendYmdJst, JST_WEEKEND_WORK_REJECTED_MESSAGE } from "@/lib/export-schedule";
import {
  assertMemberOpenRecordPunchAllowed,
  assertMemberWorkRecordsForTodayPunch,
} from "@/lib/punch-time-guard";
import { computeNextManagementNumber } from "@/lib/member-management-number";

export { JST_WEEKEND_WORK_REJECTED_MESSAGE } from "@/lib/export-schedule";

export type SaveDataOptions = {
  /** 変更履歴 data_change_history.source に記録（例: api/schedule） */
  changeSource?: string | null;
  /** 一括インポート等で履歴行を増やしたくないとき true */
  skipChangeHistory?: boolean;
  /** 管理者の代行入力・自動補完・予実解消など、打刻時間帯チェックをスキップ */
  bypassPunchTimeRestrictions?: boolean;
  /** データ修復・一括インポートのみ。通常は 0〜24 時間の稼働分数検証を行う */
  bypassWorkDurationSanity?: boolean;
};

export { loadEntityChangeHistory } from "@/lib/data-change-history";

async function passwordMatchesStored(stored: string, plain: string): Promise<boolean> {
  const s = stored ?? "";
  if (/^\$2[aby]\$/.test(s)) {
    try {
      return await bcrypt.compare(plain, s);
    } catch {
      return false;
    }
  }
  return s === plain;
}

type DbUser = {
  id: string;
  name: string;
  furigana?: string | null;
  login_account: string | null;
  password: string | null;
  hourly_rate: number | null;
  zip_code?: string | number | null;
  postal_code?: string | null;
  address?: string | null;
  bank_name?: string | null;
  branch_name?: string | null;
  account_type?: string | null;
  account_number?: string | null;
  account_holder?: string | null;
  invoice_number?: string | number | null;
  invoice_registration_number?: string | null;
  phone_number?: string | null;
  slack_id?: string | null;
  is_active?: boolean | null;
  first_work_date?: string | null;
  slack_first_shift_hours_notified_at?: string | null;
  can_work_morning?: boolean | null;
  is_intern?: boolean | null;
  intern_rate_decision_maker_apps?: number | null;
  intern_rate_non_decision_maker_apps?: number | null;
  member_category?: string | null;
};

type DbAttendance = {
  id: string;
  user_id: string;
  start_raw: string;
  start_rounded: string;
  end_raw: string;
  end_rounded: string;
  duration_minutes: number;
  date: string;
  is_auto_completed?: boolean;
};

type DbOpenRecord = {
  id: string;
  user_id: string;
  start_raw: string;
  start_rounded: string;
  date: string;
};

type DbShift = {
  id: string;
  user_id: string;
  date: string;
  start_planned: string;
  end_planned: string;
  start_planned2: string | null;
  end_planned2: string | null;
};

type DbKpi = {
  id: string;
  user_id: string;
  date: string;
  start_time?: string | null;
  total_calls: number;
  valid_calls: number;
  kc_count: number;
  follow_up_created: number;
  decision_maker_apo: number;
  non_decision_maker_apo: number;
  confirmed_dm?: number;
  confirmed_non_dm?: number;
  kpi_missing_slack_notified_at?: string | null;
};

function kpiStartTimeFromDb(v: string | null | undefined): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (s === "" || s === "00:00:00") return undefined;
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (!m) return undefined;
  return `${m[1].padStart(2, "0")}:${m[2].padStart(2, "0")}`;
}

/** DBの値をトリムした文字列に正規化（数値型で返ってきても文字列で扱う） */
function normStr(v: string | number | null | undefined): string {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function toMember(r: DbUser): Member {
  const zip = normStr(r.zip_code ?? r.postal_code ?? "");
  const addr = normStr(r.address ?? "");
  const bank = normStr(r.bank_name ?? "");
  const branch = normStr(r.branch_name ?? "");
  const accNum = normStr(r.account_number ?? "");
  const accHolder = normStr(r.account_holder ?? "");
  const invNum = normStr(r.invoice_number ?? "");
  const invReg = normStr(r.invoice_registration_number ?? "");
  const phone = normStr(r.phone_number ?? "");
  const furigana = normStr(r.furigana ?? "");
  return {
    id: r.id,
    name: (r.name ?? "").trim(),
    furigana: furigana !== "" ? furigana : undefined,
    loginAccount: (r.login_account ?? "").trim(),
    password: r.password ?? "",
    hourlyRate: typeof r.hourly_rate === "number" && r.hourly_rate >= 0 ? r.hourly_rate : DEFAULT_HOURLY_RATE,
    postalCode: zip !== "" ? zip : undefined,
    address: addr !== "" ? addr : undefined,
    bankName: bank !== "" ? bank : undefined,
    branchName: branch !== "" ? branch : undefined,
    accountType: normStr(r.account_type ?? "") !== "" ? normStr(r.account_type ?? "") : undefined,
    accountNumber: accNum !== "" ? accNum : undefined,
    accountHolder: accHolder !== "" ? accHolder : undefined,
    invoiceNumber: invNum !== "" ? invNum : undefined,
    invoiceRegistrationNumber: invReg !== "" ? invReg : undefined,
    phoneNumber: phone !== "" ? phone : undefined,
    slackId: normStr(r.slack_id ?? "") !== "" ? normStr(r.slack_id ?? "") : undefined,
    isActive: r.is_active === undefined || r.is_active === null ? true : !!r.is_active,
    firstWorkDate:
      r.first_work_date != null && String(r.first_work_date).trim() !== ""
        ? String(r.first_work_date).slice(0, 10)
        : undefined,
    canWorkMorning: r.can_work_morning === true,
    isIntern: r.is_intern === true,
    internRateDecisionMakerApps:
      typeof r.intern_rate_decision_maker_apps === "number" && r.intern_rate_decision_maker_apps >= 0
        ? r.intern_rate_decision_maker_apps
        : undefined,
    internRateNonDecisionMakerApps:
      typeof r.intern_rate_non_decision_maker_apps === "number" && r.intern_rate_non_decision_maker_apps >= 0
        ? r.intern_rate_non_decision_maker_apps
        : undefined,
    memberCategory: normalizeMemberContractorCategory(r.member_category),
  };
}

function toWorkRecord(r: DbAttendance): WorkRecord {
  return {
    id: r.id,
    userId: r.user_id,
    startRaw: r.start_raw,
    startRounded: r.start_rounded,
    endRaw: r.end_raw,
    endRounded: r.end_rounded,
    durationMinutes: r.duration_minutes,
    date: r.date,
    isAutoCompleted: r.is_auto_completed === true,
  };
}

function toOpenRecord(r: DbOpenRecord): OpenRecord {
  return {
    id: r.id,
    userId: r.user_id,
    startRaw: r.start_raw,
    startRounded: r.start_rounded,
    date: r.date,
  };
}

function toShift(r: DbShift): Shift {
  const s: Shift = {
    id: r.id,
    userId: r.user_id,
    date: r.date,
    startPlanned: r.start_planned,
    endPlanned: r.end_planned,
  };
  if (r.start_planned2 && r.end_planned2) {
    s.startPlanned2 = r.start_planned2;
    s.endPlanned2 = r.end_planned2;
  }
  return s;
}

function toKpiRecord(r: DbKpi): KpiRecord {
  const notified = coerceKpiTimestamptzField(r.kpi_missing_slack_notified_at);
  const st = kpiStartTimeFromDb(r.start_time ?? null);
  return {
    id: r.id,
    userId: r.user_id,
    date: r.date,
    ...(st ? { startTime: st } : {}),
    totalCalls: r.total_calls,
    validCalls: r.valid_calls,
    kcCount: r.kc_count,
    followUpCreated: r.follow_up_created,
    decisionMakerApo: r.decision_maker_apo,
    nonDecisionMakerApo: r.non_decision_maker_apo,
    confirmedDecisionMakerApps: Math.max(0, r.confirmed_dm ?? 0),
    confirmedNonDecisionMakerApps: Math.max(0, r.confirmed_non_dm ?? 0),
    ...(notified ? { kpiMissingSlackNotifiedAt: notified } : {}),
  };
}

/** 保存直前: 日付・TIMESTAMPTZ 系の不正値を除き、startTime を正規化 */
function sanitizeKpiRecordForPersistence(r: KpiRecord): KpiRecord | null {
  const date = coerceKpiWorkDateYmd(r.date);
  if (!date) {
    console.warn("[saveKpi] invalid date, row skipped:", r.date);
    return null;
  }
  const userId = (r.userId ?? "").trim();
  if (!userId) {
    console.warn("[saveKpi] invalid userId, row skipped");
    return null;
  }
  const slot = normalizeKpiStartTime(r);
  const notified = coerceKpiTimestamptzField(r.kpiMissingSlackNotifiedAt);
  const base: KpiRecord = {
    ...r,
    date,
    userId,
    startTime: slot,
  };
  if (notified) {
    return { ...base, kpiMissingSlackNotifiedAt: notified };
  }
  const { kpiMissingSlackNotifiedAt: _drop, ...rest } = base;
  return rest;
}

type QueryResult<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

async function safeQuery<T>(builder: QueryResult<T>): Promise<T[]> {
  try {
    const { data, error } = await builder;
    if (error) {
      console.warn("Supabase query error:", error);
      return [];
    }
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn("Supabase error:", e);
    return [];
  }
}

/** メンバー一覧。接続失敗やテーブルなしの場合は []。Supabase 未設定の場合は null（呼び出し元で loadError 表示用） */
export async function loadMembers(): Promise<Member[] | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const rows = await safeQuery<DbUser>(supabase.from("users").select("*").order("name"));
    return rows.map(toMember);
  } catch {
    return [];
  }
}

/** シフト保存時の午前開始可否。管理者ログインアカウントは常に許可。読み取り失敗時は false（午前不可として検証） */
export async function loadUserCanWorkMorning(userId: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { data, error } = await supabase
    .from("users")
    .select("can_work_morning, login_account")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) {
    console.warn("[supabase-data] loadUserCanWorkMorning:", error);
    return false;
  }
  if ((data.login_account ?? "").trim().toLowerCase() === "admin") return true;
  return data.can_work_morning === true;
}

/** DB 上の請求管理番号（invoice_number）の最大値 + 1 を採番（既存メンバーは変更しない） */
export async function allocateNextInvoiceManagementNumber(): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Supabase が設定されていません。");
  }
  const rows = await safeQuery<{ invoice_number: string | number | null }>(
    supabase.from("users").select("invoice_number")
  );
  return computeNextManagementNumber(rows.map((r) => r.invoice_number));
}

function usersUpsertRowFromMember(m: Member): Record<string, unknown> {
  const login = (m.loginAccount ?? "").trim();
  return {
    id: m.id,
    name: m.name,
    furigana: m.furigana ?? "",
    login_account: login === "" ? null : login,
    password: m.password ?? "",
    hourly_rate: m.hourlyRate ?? DEFAULT_HOURLY_RATE,
    zip_code: m.postalCode ?? "",
    address: m.address ?? "",
    bank_name: m.bankName ?? "",
    branch_name: m.branchName ?? "",
    account_type: m.accountType ?? "普通",
    account_number: m.accountNumber ?? "",
    account_holder: m.accountHolder ?? "",
    invoice_number: m.invoiceNumber ?? null,
    invoice_registration_number: m.invoiceRegistrationNumber ?? "",
    phone_number: m.phoneNumber ?? "",
    is_active: m.isActive !== false,
    first_work_date:
      m.firstWorkDate != null && String(m.firstWorkDate).trim() !== ""
        ? String(m.firstWorkDate).trim().slice(0, 10)
        : null,
    can_work_morning: m.canWorkMorning === true,
    is_intern: m.isIntern === true,
    intern_rate_decision_maker_apps:
      typeof m.internRateDecisionMakerApps === "number" && m.internRateDecisionMakerApps >= 0
        ? Math.floor(m.internRateDecisionMakerApps)
        : 2000,
    intern_rate_non_decision_maker_apps:
      typeof m.internRateNonDecisionMakerApps === "number" && m.internRateNonDecisionMakerApps >= 0
        ? Math.floor(m.internRateNonDecisionMakerApps)
        : 500,
    member_category: normalizeMemberContractorCategory(m.memberCategory),
  };
}

function slackIdSchemaErrorMessage(msg: string): boolean {
  return /slack_id/i.test(msg) && (/schema cache/i.test(msg) || /column/i.test(msg) || /Could not find/i.test(msg));
}

export async function saveMembers(members: Member[]): Promise<void> {
  if (members.length === 0) return;
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    const ids = members.map((m) => m.id);
    const existingInv = new Map<string, string>();
    if (ids.length > 0) {
      const { data: invRows, error: invSelErr } = await supabase
        .from("users")
        .select("id, invoice_number")
        .in("id", ids);
      if (invSelErr) {
        console.warn("saveMembers invoice select error:", invSelErr);
      } else {
        for (const r of invRows ?? []) {
          const prev = normStr((r as { invoice_number?: string | number | null }).invoice_number ?? "");
          if (prev !== "") existingInv.set(String(r.id), prev);
        }
      }
    }
    const rowsBase = members.map((m) => {
      const row = usersUpsertRowFromMember(m);
      const incoming = normStr(m.invoiceNumber ?? "");
      if (incoming === "") {
        const prev = existingInv.get(m.id);
        if (prev) row.invoice_number = prev;
      }
      return row;
    });
    const { error } = await supabase.from("users").upsert(rowsBase, { onConflict: "id" });
    if (error) {
      console.warn("saveMembers error:", error);
      return;
    }
    for (const m of members) {
      if (m.slackId !== undefined) {
        await updateMember(m.id, { slackId: m.slackId ?? "" });
      }
    }
  } catch (e) {
    console.warn("saveMembers error:", e);
  }
}

export async function addMember(
  name: string,
  options?: { loginAccount?: string; password?: string; hourlyRate?: number }
): Promise<Member> {
  const id = crypto.randomUUID();
  const newMember: Member = {
    id,
    name: name.trim() || id,
    loginAccount: options?.loginAccount?.trim() ?? "",
    password: options?.password ?? "",
    hourlyRate:
      typeof options?.hourlyRate === "number" && options.hourlyRate >= 0 ? options.hourlyRate : DEFAULT_HOURLY_RATE,
    postalCode: "",
    address: "",
    bankName: "",
    branchName: "",
    accountType: "普通",
    accountNumber: "",
    accountHolder: "",
    invoiceNumber: "",
    phoneNumber: "",
    isActive: true,
    canWorkMorning: DEFAULT_CAN_WORK_MORNING_FOR_NEW_MEMBER,
    memberCategory: MEMBER_CONTRACTOR_CATEGORY_DEFAULT,
  };
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Supabase が設定されていません。");
  }

  const loginNorm = (newMember.loginAccount ?? "").trim().toLowerCase();
  if (loginNorm !== "") {
    const existingLogins = await safeQuery<{ login_account: string | null }>(
      supabase.from("users").select("login_account")
    );
    const taken = existingLogins.some(
      (r) => (r.login_account ?? "").trim().toLowerCase() === loginNorm
    );
    if (taken) {
      throw new Error("このログインIDは既に使用されています");
    }
  }

  const nextInvoiceNumber = await allocateNextInvoiceManagementNumber();
  newMember.invoiceNumber = nextInvoiceNumber;

  const insertRow = {
    id: newMember.id,
    name: newMember.name,
    login_account: loginNorm === "" ? null : (newMember.loginAccount ?? "").trim(),
    password: newMember.password,
    hourly_rate: newMember.hourlyRate,
    zip_code: "",
    address: "",
    bank_name: "",
    branch_name: "",
    account_type: "普通",
    account_number: "",
    account_holder: "",
    invoice_number: nextInvoiceNumber,
    phone_number: "",
    is_active: true,
    first_work_date: null,
    can_work_morning: DEFAULT_CAN_WORK_MORNING_FOR_NEW_MEMBER,
    member_category: MEMBER_CONTRACTOR_CATEGORY_DEFAULT,
  };

  const { error } = await supabase.from("users").insert(insertRow);
  if (error) {
    const message = error.message ?? String(error);
    console.error("addMember error:", error);
    if (/duplicate key|unique constraint|23505/i.test(message)) {
      if (/login/i.test(message)) {
        throw new Error("このログインIDは既に使用されています");
      }
      if (/slack/i.test(message)) {
        throw new Error("この Slack ID は既に別のメンバーで使用されています");
      }
      throw new Error("登録できませんでした（データの重複の可能性があります）。内容を確認して再度お試しください。");
    }
    throw new Error(message);
  }

  return newMember;
}

/** メンバー行の部分更新（Supabase）。失敗時は例外。API や検証後の保存に利用 */
export type MemberUpdatePayload = Partial<
  Pick<
    Member,
    | "name"
    | "furigana"
    | "loginAccount"
    | "password"
    | "hourlyRate"
    | "postalCode"
    | "address"
    | "bankName"
    | "branchName"
    | "accountType"
    | "accountNumber"
    | "accountHolder"
    | "invoiceNumber"
    | "invoiceRegistrationNumber"
    | "phoneNumber"
    | "slackId"
    | "isActive"
    | "firstWorkDate"
    | "canWorkMorning"
    | "isIntern"
    | "internRateDecisionMakerApps"
    | "internRateNonDecisionMakerApps"
    | "memberCategory"
  >
>;

/** `updateMemberOrThrow` のオプション */
export type UpdateMemberOrThrowOptions = {
  /**
   * default: 請求管理番号（invoice_number）に空文字を渡したときも DB を上書きする（管理者画面の明示クリア用）
   * preserveIfBlank: 空・空白のみのときは invoice_number 列を更新しない（既存の管理者設定を保持）
   * never: invoiceNumber がペイロードに含まれていても invoice_number 列を一切更新しない（一般ユーザーの振込先更新用）
   */
  invoiceNumberPolicy?: "default" | "preserveIfBlank" | "never";
};

/** 一般ユーザー本人の振込先・連絡先のみ更新（請求管理番号 invoice_number は対象外） */
export type MemberSelfBankProfilePayload = Pick<
  MemberUpdatePayload,
  | "postalCode"
  | "address"
  | "bankName"
  | "branchName"
  | "accountType"
  | "accountNumber"
  | "accountHolder"
  | "phoneNumber"
  | "invoiceRegistrationNumber"
>;

export async function updateMemberSelfBankProfileOrThrow(
  memberId: string,
  updates: MemberSelfBankProfilePayload
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("データベースに接続できません");
  const body: Record<string, unknown> = {
    zip_code: updates.postalCode,
    address: updates.address,
    bank_name: updates.bankName,
    branch_name: updates.branchName,
    account_type: updates.accountType,
    account_number: updates.accountNumber,
    account_holder: updates.accountHolder,
    phone_number: updates.phoneNumber,
  };
  if (updates.invoiceRegistrationNumber !== undefined) {
    body.invoice_registration_number = updates.invoiceRegistrationNumber;
  }
  const { error } = await supabase.from("users").update(body).eq("id", memberId);
  if (error) {
    const m = error.message ?? String(error);
    throw new Error(m);
  }
}

export async function updateMemberOrThrow(
  memberId: string,
  updates: MemberUpdatePayload,
  options?: UpdateMemberOrThrowOptions
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("データベースに接続できません");
  const body: Record<string, unknown> = {};
  if (updates.name !== undefined) body.name = updates.name;
  if (updates.furigana !== undefined) body.furigana = updates.furigana;
  if (updates.loginAccount !== undefined) {
    const t = updates.loginAccount.trim();
    body.login_account = t === "" ? null : t;
  }
  if (updates.password !== undefined) body.password = updates.password;
  if (updates.hourlyRate !== undefined) body.hourly_rate = updates.hourlyRate;
  if (updates.postalCode !== undefined) body.zip_code = updates.postalCode;
  if (updates.address !== undefined) body.address = updates.address;
  if (updates.bankName !== undefined) body.bank_name = updates.bankName;
  if (updates.branchName !== undefined) body.branch_name = updates.branchName;
  if (updates.accountType !== undefined) body.account_type = updates.accountType;
  if (updates.accountNumber !== undefined) body.account_number = updates.accountNumber;
  if (updates.accountHolder !== undefined) body.account_holder = updates.accountHolder;
  if (updates.invoiceNumber !== undefined) {
    const invTrim = (updates.invoiceNumber ?? "").trim();
    const policy = options?.invoiceNumberPolicy ?? "default";
    if (policy === "never") {
      /* 一般ユーザー経路: 請求管理番号は更新対象外 */
    } else if (policy === "preserveIfBlank" && invTrim === "") {
      /* 請求管理番号を消さない（空ペイロード・未入力ガード） */
    } else {
      body.invoice_number = updates.invoiceNumber;
    }
  }
  if (updates.phoneNumber !== undefined) body.phone_number = updates.phoneNumber;
  if (updates.invoiceRegistrationNumber !== undefined) {
    body.invoice_registration_number = updates.invoiceRegistrationNumber;
  }
  if (updates.slackId !== undefined) {
    const s = (updates.slackId ?? "").trim();
    body.slack_id = s === "" ? null : s;
  }
  if (updates.isActive !== undefined) body.is_active = updates.isActive;
  if (updates.firstWorkDate !== undefined) {
    const v = updates.firstWorkDate == null ? "" : String(updates.firstWorkDate).trim();
    body.first_work_date = v === "" ? null : v.slice(0, 10);
  }
  if (updates.canWorkMorning !== undefined) body.can_work_morning = updates.canWorkMorning === true;
  if (updates.isIntern !== undefined) body.is_intern = updates.isIntern === true;
  if (updates.internRateDecisionMakerApps !== undefined) {
    body.intern_rate_decision_maker_apps =
      typeof updates.internRateDecisionMakerApps === "number" &&
      Number.isFinite(updates.internRateDecisionMakerApps) &&
      updates.internRateDecisionMakerApps >= 0
        ? Math.floor(updates.internRateDecisionMakerApps)
        : 2000;
  }
  if (updates.internRateNonDecisionMakerApps !== undefined) {
    body.intern_rate_non_decision_maker_apps =
      typeof updates.internRateNonDecisionMakerApps === "number" &&
      Number.isFinite(updates.internRateNonDecisionMakerApps) &&
      updates.internRateNonDecisionMakerApps >= 0
        ? Math.floor(updates.internRateNonDecisionMakerApps)
        : 500;
  }
  if (updates.memberCategory !== undefined) {
    body.member_category = normalizeMemberContractorCategory(updates.memberCategory);
  }
  if (Object.keys(body).length === 0) return;
  if (updates.invoiceNumber !== undefined) {
    const invTrim = (updates.invoiceNumber ?? "").trim();
    const policy = options?.invoiceNumberPolicy ?? "default";
    if (policy === "default" && invTrim === "") {
      console.warn("[supabase-data] updateMember: 請求管理番号が空のまま保存", { memberId });
    }
  }
  const { error } = await supabase.from("users").update(body).eq("id", memberId);
  if (error && slackIdSchemaErrorMessage(error.message ?? "") && "slack_id" in body) {
    const { slack_id: _s, ...rest } = body;
    if (Object.keys(rest).length > 0) {
      const { error: e2 } = await supabase.from("users").update(rest).eq("id", memberId);
      if (e2) {
        const m = e2.message ?? String(e2);
        if (/duplicate key|unique constraint|23505/i.test(m) && /login/i.test(m)) {
          throw new Error("このログインIDは既に使用されています");
        }
        throw new Error(m);
      }
    }
  } else if (error) {
    const m = error.message ?? String(error);
    if (/duplicate key|unique constraint|23505/i.test(m) && /login/i.test(m)) {
      throw new Error("このログインIDは既に使用されています");
    }
    if (/duplicate key|unique constraint|23505/i.test(m) && /slack/i.test(m)) {
      throw new Error("この Slack ID は既に別のメンバーで使用されています");
    }
    throw new Error(m);
  }
}

export async function updateMember(
  memberId: string,
  updates: MemberUpdatePayload,
  options?: UpdateMemberOrThrowOptions
): Promise<void> {
  try {
    await updateMemberOrThrow(memberId, updates, options);
  } catch (e) {
    console.warn("updateMember error:", e);
  }
}

/**
 * 無効化済みメンバーを DB から物理削除（関連行は users への FK の ON DELETE CASCADE に従う）。
 * 有効なメンバーや管理者アカウントは削除しない。
 */
export async function deleteMember(memberId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("データベースに接続できません");
  const { data: row, error: selErr } = await supabase
    .from("users")
    .select("id, login_account, is_active")
    .eq("id", memberId)
    .maybeSingle();
  if (selErr) {
    const m = (selErr as { message?: string }).message ?? String(selErr);
    throw new Error(m);
  }
  if (!row) throw new Error("メンバーが見つかりません");
  if ((row.login_account ?? "").trim().toLowerCase() === "admin") {
    throw new Error("管理者アカウントは削除できません");
  }
  if (row.is_active !== false) {
    throw new Error("無効化されたメンバーのみ削除できます。先にメンバーを無効にしてください。");
  }
  const { error: delErr } = await supabase.from("users").delete().eq("id", memberId);
  if (delErr) {
    const m = delErr.message ?? String(delErr);
    throw new Error(m);
  }
}

const SUPABASE_SELECT_PAGE_SIZE = 1000;

async function loadAllAttendanceRows(
  supabase: NonNullable<ReturnType<typeof getSupabase>>
): Promise<DbAttendance[]> {
  const out: DbAttendance[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("attendance")
      .select("*")
      .order("date", { ascending: false })
      .range(from, from + SUPABASE_SELECT_PAGE_SIZE - 1);
    if (error) {
      console.warn("loadRecords pagination error:", error);
      return out.length > 0 ? out : [];
    }
    const chunk = data ?? [];
    if (chunk.length === 0) break;
    out.push(...chunk);
    if (chunk.length < SUPABASE_SELECT_PAGE_SIZE) break;
    from += SUPABASE_SELECT_PAGE_SIZE;
  }
  return out;
}

export async function loadRecords(): Promise<WorkRecord[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const rows = await loadAllAttendanceRows(supabase);
    return dedupeWorkRecordsByUserDateStart(rows.map(toWorkRecord));
  } catch {
    return [];
  }
}

export async function saveRecords(
  records: WorkRecord[],
  opts?: { bypassWorkDurationSanity?: boolean }
): Promise<void> {
  if (records.length === 0) return;
  if (!opts?.bypassWorkDurationSanity) {
    assertWorkRecordsDurationWithinHardCap(records);
  }
  const supabase = getSupabase();
  if (!supabase) throw new Error("データベースに接続できません");
  const merged = dedupeWorkRecordsByUserDateStart(records);
  const rows = merged.map((r) => ({
    id: r.id,
    user_id: r.userId,
    start_raw: r.startRaw,
    start_rounded: r.startRounded,
    end_raw: r.endRaw,
    end_rounded: r.endRounded,
    duration_minutes: r.durationMinutes,
    date: r.date,
    is_auto_completed: r.isAutoCompleted === true,
  }));
  const { error } = await supabase.from("attendance").upsert(rows, { onConflict: "id" });
  if (error) throw new Error(error.message);
}

/** 活動記録 1 件を DB から削除（upsert では消えないため専用） */
export async function deleteAttendanceRecordById(recordId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "データベースに接続できません" };
  try {
    const { error } = await supabase.from("attendance").delete().eq("id", recordId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export async function loadOpenRecords(): Promise<OpenRecord[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const rows = await safeQuery<DbOpenRecord>(supabase.from("open_records").select("*"));
    return rows.map(toOpenRecord);
  } catch {
    return [];
  }
}

export async function saveOpenRecords(records: OpenRecord[]): Promise<void> {
  const sanitized = records.filter((r) => !isWeekendYmdJst(r.date));
  if (records.length > 0 && sanitized.length === 0) {
    throw new Error(JST_WEEKEND_WORK_REJECTED_MESSAGE);
  }
  if (sanitized.length !== records.length) {
    console.warn("[saveOpenRecords] 土日の未終了打刻行は保存対象から除外しました");
  }
  const supabase = getSupabase();
  if (!supabase) throw new Error("データベースに接続できません");
  const { data: existing, error: selErr } = await supabase.from("open_records").select("id");
  if (selErr) throw new Error(selErr.message);
  if (existing?.length) {
    for (const row of existing) {
      const { error: delErr } = await supabase.from("open_records").delete().eq("id", row.id);
      if (delErr) throw new Error(delErr.message);
    }
  }
  if (sanitized.length === 0) return;
  const rows = sanitized.map((r) => ({
    id: r.id,
    user_id: r.userId,
    start_raw: r.startRaw,
    start_rounded: r.startRounded,
    date: r.date,
  }));
  const { error: insErr } = await supabase.from("open_records").insert(rows);
  if (insErr) throw new Error(insErr.message);
}

/** PostgREST の 1 リクエスト行上限を超えないようページングして全件取得 */
async function loadAllShiftRows(supabase: NonNullable<ReturnType<typeof getSupabase>>): Promise<DbShift[]> {
  const out: DbShift[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("shifts")
      .select("*")
      .order("date", { ascending: false })
      .range(from, from + SUPABASE_SELECT_PAGE_SIZE - 1);
    if (error) {
      console.warn("loadShifts pagination error:", error);
      return out.length > 0 ? out : [];
    }
    const chunk = data ?? [];
    if (chunk.length === 0) break;
    out.push(...chunk);
    if (chunk.length < SUPABASE_SELECT_PAGE_SIZE) break;
    from += SUPABASE_SELECT_PAGE_SIZE;
  }
  return out;
}

async function loadAllKpiRows(supabase: NonNullable<ReturnType<typeof getSupabase>>): Promise<DbKpi[]> {
  const out: DbKpi[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("kpis")
      .select("*")
      .order("date", { ascending: false })
      .range(from, from + SUPABASE_SELECT_PAGE_SIZE - 1);
    if (error) {
      console.warn("loadKpi pagination error:", error);
      return out.length > 0 ? out : [];
    }
    const chunk = data ?? [];
    if (chunk.length === 0) break;
    out.push(...chunk);
    if (chunk.length < SUPABASE_SELECT_PAGE_SIZE) break;
    from += SUPABASE_SELECT_PAGE_SIZE;
  }
  return out;
}

export async function loadShifts(): Promise<Shift[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const rows = await loadAllShiftRows(supabase);
    return dedupeShiftsByUserDate(rows.map(toShift));
  } catch {
    return [];
  }
}

/** 指定期間（YYYY-MM-DD 含む）の稼働予定のみ取得 */
export async function loadShiftsInDateRange(start: string, end: string): Promise<Shift[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const a = start <= end ? start : end;
  const b = start <= end ? end : start;
  try {
    const rows = await safeQuery<DbShift>(
      supabase.from("shifts").select("*").gte("date", a).lte("date", b).order("date", { ascending: true })
    );
    return dedupeShiftsByUserDate(rows.map(toShift));
  } catch {
    return [];
  }
}

/** 指定期間（YYYY-MM-DD 含む）の KPI のみ取得 */
export async function loadKpiInDateRange(start: string, end: string): Promise<KpiRecord[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const a = start <= end ? start : end;
  const b = start <= end ? end : start;
  try {
    const rows = await safeQuery<DbKpi>(
      supabase.from("kpis").select("*").gte("date", a).lte("date", b).order("date", { ascending: true })
    );
    return dedupeKpiRecordsByUserDate(rows.map(toKpiRecord));
  } catch {
    return [];
  }
}

/** シフトと KPI を同一期間で並列取得（管理 API・帳票用の論理結合の元データ） */
export async function loadShiftsAndKpiForDateRange(
  start: string,
  end: string
): Promise<{ shifts: Shift[]; kpis: KpiRecord[] }> {
  const [shifts, kpis] = await Promise.all([loadShiftsInDateRange(start, end), loadKpiInDateRange(start, end)]);
  return { shifts, kpis };
}

/** @returns upsert 成功時 true（失敗・Supabase 未設定は false） */
export async function saveShifts(shifts: Shift[], opts?: SaveDataOptions): Promise<boolean> {
  if (shifts.length === 0) return true;
  const supabase = getSupabase();
  if (!supabase) return false;
  try {
    // saveShiftsForUser のマージ結果には「保存していない他ユーザーの行」が含まれる。
    // 当日・過去日を除外・矯正しないこと（意図しない一括「なし」化を防ぐ）。
    const merged = dedupeShiftsByUserDate(shifts);
    const rows = merged.map((s) => ({
      id: s.id,
      user_id: s.userId,
      date: s.date,
      start_planned: s.startPlanned,
      end_planned: s.endPlanned,
      start_planned2: s.startPlanned2 ?? null,
      end_planned2: s.endPlanned2 ?? null,
    }));
    if (!opts?.skipChangeHistory) {
      await logShiftUpsertHistory(rows, opts?.changeSource ?? null);
    }
    const { error } = await supabase.from("shifts").upsert(rows, { onConflict: "id" });
    if (error) {
      console.warn("saveShifts error:", error);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("saveShifts error:", e);
    return false;
  }
}

export async function loadKpi(): Promise<KpiRecord[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const rows = await loadAllKpiRows(supabase);
    return dedupeKpiRecordsByUserDate(rows.map(toKpiRecord));
  } catch {
    return [];
  }
}

export async function saveKpi(records: KpiRecord[], opts?: SaveDataOptions): Promise<void> {
  const merged = dedupeKpiRecordsByUserDate(records)
    .map(sanitizeKpiRecordForPersistence)
    .filter((r): r is KpiRecord => r != null);
  if (merged.length === 0) {
    if (records.length > 0) {
      throw new Error("KPIの内容が無効です。日付（YYYY-MM-DD）と数値を確認してください。");
    }
    return;
  }
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("データベースに接続できません。.env.local の NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を確認してください。");
  }

  const slots: KpiSlot[] = merged.map((r) => ({
    user_id: r.userId,
    date: r.date,
    start_time: kpiStartTimeToSqlTime(r.startTime),
  }));

  const prevByKey = await fetchKpiUpsertPayloadsBySlots(supabase, slots);

  const rows = merged.map((r) => {
    const st = kpiStartTimeToSqlTime(r.startTime);
    const key = `${r.userId}\t${r.date}\t${st}`;
    const prevRow = prevByKey.get(key);
    let notifiedAt: string | undefined;
    const incomingTs = coerceKpiTimestamptzField(r.kpiMissingSlackNotifiedAt);
    const prevTs = coerceKpiTimestamptzField(prevRow?.kpi_missing_slack_notified_at);
    if (incomingTs) {
      notifiedAt = incomingTs;
    } else if (prevTs) {
      notifiedAt = prevTs;
    }

    const row: Record<string, unknown> = {
      user_id: r.userId,
      date: r.date,
      start_time: st,
      total_calls: Number.isFinite(r.totalCalls) ? Math.max(0, Math.floor(r.totalCalls)) : 0,
      valid_calls: Number.isFinite(r.validCalls) ? Math.max(0, Math.floor(r.validCalls)) : 0,
      kc_count: Number.isFinite(r.kcCount) ? Math.max(0, Math.floor(r.kcCount)) : 0,
      follow_up_created: Number.isFinite(r.followUpCreated) ? Math.max(0, Math.floor(r.followUpCreated)) : 0,
      decision_maker_apo: Number.isFinite(r.decisionMakerApo) ? Math.max(0, Math.floor(r.decisionMakerApo)) : 0,
      non_decision_maker_apo: Number.isFinite(r.nonDecisionMakerApo) ? Math.max(0, Math.floor(r.nonDecisionMakerApo)) : 0,
      confirmed_dm: Number.isFinite(r.confirmedDecisionMakerApps ?? 0)
        ? Math.max(0, Math.floor(r.confirmedDecisionMakerApps ?? 0))
        : 0,
      confirmed_non_dm: Number.isFinite(r.confirmedNonDecisionMakerApps ?? 0)
        ? Math.max(0, Math.floor(r.confirmedNonDecisionMakerApps ?? 0))
        : 0,
    };
    /** id は付けない。一部の行だけ id があると bulk upsert で他行に id=NULL が送られ NOT NULL 違反になる。新規は DB の DEFAULT、衝突時は ON CONFLICT で更新。 */
    if (notifiedAt) row.kpi_missing_slack_notified_at = notifiedAt;
    return row;
  });

  /** `kpis_user_date_start_time_uidx` と一致させ、重複時は同一行を UPDATE（upsert） */
  /** defaultToNull: false → Prefer: missing=default。省略した id は NULL ではなく DB の DEFAULT（gen_random_uuid）を使う（既定 true だと id が NULL で NOT NULL 違反になる） */
  const { error } = await supabase.from("kpis").upsert(rows, {
    onConflict: "user_id,date,start_time",
    defaultToNull: false,
  });
  if (error) {
    console.warn("saveKpi error:", error);
    let msg = typeof error.message === "string" ? error.message : "KPIの保存に失敗しました";
    if (/start_time/i.test(msg) && /schema cache/i.test(msg)) {
      msg =
        "Supabase の kpis テーブルに start_time 列がありません（または API がまだ認識していません）。Dashboard の SQL で supabase-migration-kpis-add-start-time.sql を実行し、その後 NOTIFY でスキーマを再読み込みしてください。詳細: " +
        msg;
    }
    throw new Error(msg);
  }

  if (!opts?.skipChangeHistory) {
    const nextByKey = await fetchKpiUpsertPayloadsBySlots(supabase, slots);
    await appendKpiChangeHistoryForSlots(prevByKey, nextByKey, slots, opts?.changeSource ?? null);
  }
}

/** 乖離承認済みの work_record_id 一覧を取得 */
export async function loadDeviationApprovals(): Promise<string[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const rows = await safeQuery<{ work_record_id: string }>(supabase.from("deviation_approvals").select("work_record_id"));
    return rows.map((r) => r.work_record_id);
  } catch {
    return [];
  }
}

/** 指定の活動記録を乖離として承認する */
export async function saveDeviationApproval(workRecordId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase.from("deviation_approvals").upsert(
      { work_record_id: workRecordId, approved_at: new Date().toISOString() },
      { onConflict: "work_record_id" }
    );
  } catch (e) {
    console.warn("saveDeviationApproval error:", e);
  }
}

export type PlanActualGapResolution = "planned" | "actual" | "absent" | "manual";

/** 手動確定などで plan_actual_gap_approvals に残す監査用フィールド（列未作成時は upsert から省略される） */
export type PlanActualGapResolutionAudit = {
  kpiId?: string | null;
  originalStart?: string | null;
  originalEnd?: string | null;
  approvedStart?: string | null;
  approvedEnd?: string | null;
  adminId?: string | null;
};

function planActualGapApprovalsTableMissingMessage(error: unknown): string | null {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : "";
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: string }).message ?? "")
      : String(error);
  const blob = `${code} ${message}`.toLowerCase();
  if (!blob.includes("plan_actual_gap_approvals")) return null;
  if (
    blob.includes("does not exist") ||
    blob.includes("schema cache") ||
    blob.includes("could not find the table") ||
    code === "PGRST205" ||
    code === "42P01"
  ) {
    return message || "plan_actual_gap_approvals が参照できません";
  }
  return null;
}

function isUndefinedColumnError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : "";
  if (code === "42703") return true;
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: string }).message ?? "")
      : String(error);
  const m = message.toLowerCase();
  return m.includes("column") && m.includes("does not exist");
}

/** 予実乖離アーカイブの確定一覧（解決方法つき）。resolution が null はマイグレーション前の行など */
export async function loadPlanActualGapApprovalsDetailed(): Promise<
  { userId: string; date: string; resolution: PlanActualGapResolution | null }[]
> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const rows = await safeQuery<{ user_id: string; date: string; resolution: string | null }>(
      supabase.from("plan_actual_gap_approvals").select("user_id,date,resolution")
    );
    return rows.map((r) => ({
      userId: r.user_id,
      date: String(r.date).slice(0, 10),
      resolution:
        r.resolution === "planned" ||
        r.resolution === "actual" ||
        r.resolution === "absent" ||
        r.resolution === "manual"
          ? r.resolution
          : null,
    }));
  } catch {
    return [];
  }
}

/**
 * 予実乖離の確定（予定優先 / 実績優先 / 手動確定 等）を保存。
 * plan_actual_gap_approvals が未作成の環境では警告のみで return（稼働予定・活動記録など本体保存は続行できるようにする）。
 * 監査列が未マイグレーションの DB では、監査キーを外して 1 回だけ再試行する。
 */
export async function savePlanActualGapResolution(
  userId: string,
  date: string,
  resolution: PlanActualGapResolution,
  audit?: PlanActualGapResolutionAudit
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("データベースに接続できません");

  const baseRow = {
    user_id: userId,
    date,
    approved_at: new Date().toISOString(),
    resolution,
  };

  const auditRow =
    audit &&
    (audit.kpiId != null ||
      audit.originalStart != null ||
      audit.originalEnd != null ||
      audit.approvedStart != null ||
      audit.approvedEnd != null ||
      audit.adminId != null)
      ? {
          kpi_id: audit.kpiId ?? null,
          original_start: audit.originalStart ?? null,
          original_end: audit.originalEnd ?? null,
          approved_start: audit.approvedStart ?? null,
          approved_end: audit.approvedEnd ?? null,
          admin_id: audit.adminId ?? null,
        }
      : null;

  const tryUpsert = async (row: Record<string, unknown>) => {
    return supabase.from("plan_actual_gap_approvals").upsert(row, { onConflict: "user_id,date" });
  };

  let { error } = await tryUpsert(auditRow ? { ...baseRow, ...auditRow } : baseRow);

  if (error && auditRow && isUndefinedColumnError(error)) {
    console.warn(
      "savePlanActualGapResolution: 監査列が未マイグレーションのため、resolution のみで upsert します:",
      error
    );
    ({ error } = await tryUpsert(baseRow));
  }

  if (error) {
    const skipMsg = planActualGapApprovalsTableMissingMessage(error);
    if (skipMsg) {
      console.warn(
        "[savePlanActualGapResolution] plan_actual_gap_approvals が未作成またはスキーマキャッシュ未更新のためスキップしました。",
        skipMsg,
        "\nSQL: supabase-migration-plan-actual-gap-approvals.sql 実行後、NOTIFY pgrst, 'reload schema'; またはダッシュボードで Reload schema。"
      );
      return;
    }
    const m = error.message ?? String(error);
    console.warn("savePlanActualGapResolution error:", error);
    throw new Error(m);
  }
}

/** 指定シフト行の予定枠を直接更新（予実「実績に合わせる」用。枠2は null でクリア） */
export async function updateShiftPlannedSlotsById(
  shiftId: string,
  patch: {
    startPlanned: string;
    endPlanned: string;
    startPlanned2: string | null;
    endPlanned2: string | null;
  }
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from("shifts")
      .update({
        start_planned: patch.startPlanned,
        end_planned: patch.endPlanned,
        start_planned2: patch.startPlanned2,
        end_planned2: patch.endPlanned2,
      })
      .eq("id", shiftId);
    if (error) {
      console.warn("updateShiftPlannedSlotsById error:", error);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("updateShiftPlannedSlotsById error:", e);
    return false;
  }
}

/** 指定ユーザー分の稼働を差し替えて保存（他ユーザー分は維持） */
export async function saveRecordsForUser(
  userId: string,
  userRecords: WorkRecord[],
  opts?: SaveDataOptions
): Promise<void> {
  for (const r of userRecords) {
    if (isWeekendYmdJst(r.date)) {
      throw new Error(JST_WEEKEND_WORK_REJECTED_MESSAGE);
    }
  }
  const withUserId = userRecords.map((r) => ({ ...r, userId }));
  if (!opts?.bypassWorkDurationSanity) {
    assertWorkRecordsDurationWithinHardCap(withUserId);
  }
  if (!opts?.bypassPunchTimeRestrictions) {
    const allShifts = await loadShifts();
    assertMemberWorkRecordsForTodayPunch(userId, userRecords, allShifts, new Date());
  }
  const all = await loadRecords();
  const rest = all.filter((r) => r.userId !== userId);
  await saveRecords([...rest, ...withUserId], { bypassWorkDurationSanity: true });
}

/** 指定ユーザーの未終了稼働を設定 */
export async function setOpenRecordForUser(
  userId: string,
  record: OpenRecord | null,
  opts?: SaveDataOptions
): Promise<void> {
  if (record && isWeekendYmdJst(record.date)) {
    throw new Error(JST_WEEKEND_WORK_REJECTED_MESSAGE);
  }
  if (record && !opts?.bypassPunchTimeRestrictions) {
    if (record.userId !== userId) throw new Error("ユーザーが一致しません");
    const allShiftsForPunch = await loadShifts();
    const shiftForDate = canonicalShiftForUserDate(allShiftsForPunch, userId, record.date);
    assertMemberOpenRecordPunchAllowed(record, new Date(), shiftForDate);
  }
  const all = await loadOpenRecords();
  const rest = all.filter((r) => r.userId !== userId);
  const next = record ? [...rest, { ...record, userId }] : rest;
  await saveOpenRecords(next);
}

/** 保存前判定: 当該ユーザーに「稼働なし」以外の予定時間が1件でもあるか */
export async function userHasPlannedWorkShiftInDb(userId: string): Promise<boolean | null> {
  const supabase = getSupabase();
  if (!supabase) {
    const all = await loadShifts();
    return all.some((s) => s.userId === userId && shiftHasPlannedWorkHours(s));
  }
  const { data, error } = await supabase
    .from("shifts")
    .select("start_planned,end_planned,start_planned2,end_planned2")
    .eq("user_id", userId);
  if (error) {
    console.warn("[userHasPlannedWorkShiftInDb] query error:", error);
    return null;
  }
  for (const r of data ?? []) {
    const s: Shift = {
      id: "",
      userId,
      date: "",
      startPlanned: r.start_planned,
      endPlanned: r.end_planned,
      startPlanned2: r.start_planned2 ?? undefined,
      endPlanned2: r.end_planned2 ?? undefined,
    };
    if (shiftHasPlannedWorkHours(s)) return true;
  }
  return false;
}

/** users.slack_first_shift_hours_notified_at（未設定は null） */
export async function getUserSlackFirstShiftHoursNotifiedAt(userId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("users")
    .select("slack_first_shift_hours_notified_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.warn("[getUserSlackFirstShiftHoursNotifiedAt] error:", error);
    return null;
  }
  const row = data as { slack_first_shift_hours_notified_at?: string | null } | null;
  const v = row?.slack_first_shift_hours_notified_at;
  return v != null && String(v).trim() !== "" ? String(v) : null;
}

/** 初回シフト Slack 通知済みとしてマーク（成功時 true） */
export async function markUserSlackFirstShiftHoursNotified(userId: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase
    .from("users")
    .update({ slack_first_shift_hours_notified_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) {
    console.warn("[markUserSlackFirstShiftHoursNotified] error:", error);
    return false;
  }
  return true;
}

type SupabaseClientNonNull = NonNullable<ReturnType<typeof getSupabase>>;

/** 同一 user_id・同一 date の重複行を1件（id 昇順で先頭）に残し、他を削除 */
async function dedupeShiftRowsForUserInDb(supabase: SupabaseClientNonNull, userId: string): Promise<void> {
  const { data: rows, error } = await supabase.from("shifts").select("id, date").eq("user_id", userId);
  if (error || !rows?.length) return;
  const byDate = new Map<string, string[]>();
  for (const r of rows) {
    const d = String(r.date);
    const arr = byDate.get(d) ?? [];
    arr.push(String(r.id));
    byDate.set(d, arr);
  }
  const idGroups = Array.from(byDate.values());
  for (const ids of idGroups) {
    if (ids.length <= 1) continue;
    const sorted = [...ids].sort();
    for (let i = 1; i < sorted.length; i++) {
      const { error: delErr } = await supabase.from("shifts").delete().eq("id", sorted[i]);
      if (delErr) console.warn("[dedupeShiftRowsForUserInDb] delete error:", delErr);
    }
  }
}

/** ペイロードの id を DB 上の (user_id, date) に既に存在する行の id に揃え、新規日付のみクライアント id のまま */
async function alignShiftIdsWithExistingDbRows(
  supabase: SupabaseClientNonNull,
  userId: string,
  userShifts: Shift[]
): Promise<Shift[]> {
  const dates = Array.from(new Set(userShifts.filter((s) => s.userId === userId).map((s) => s.date)));
  if (dates.length === 0) return userShifts;
  const { data: existing, error } = await supabase
    .from("shifts")
    .select("id, date")
    .eq("user_id", userId)
    .in("date", dates);
  if (error) {
    console.warn("[alignShiftIdsWithExistingDbRows] select error:", error);
    return userShifts;
  }
  const idByDate = new Map<string, string>();
  for (const r of existing ?? []) {
    const d = String(r.date);
    const id = String(r.id);
    const cur = idByDate.get(d);
    if (!cur || id < cur) idByDate.set(d, id);
  }
  return userShifts.map((s) => {
    if (s.userId !== userId) return s;
    const ex = idByDate.get(s.date);
    if (ex) return { ...s, id: ex };
    return s;
  });
}

/**
 * 稼働予定をユーザー単位で保存。
 * - 保存前に DB の (user_id, date) 重複を削除
 * - 送信された行の id を既存行に合わせて upsert が常に更新側に寄る（二重 INSERT 防止）
 */
export async function saveShiftsForUser(
  userId: string,
  userShifts: Shift[],
  opts?: SaveDataOptions
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  await dedupeShiftRowsForUserInDb(supabase, userId);
  const aligned = await alignShiftIdsWithExistingDbRows(supabase, userId, userShifts);
  const all = await loadShifts();
  const merged = mergeUserShiftsPreserveExistingByDate(all, userId, aligned);
  return saveShifts(merged, opts);
}

export async function saveKpiForUser(
  userId: string,
  userRecords: KpiRecord[],
  opts?: SaveDataOptions
): Promise<void> {
  const uid = (userId ?? "").trim();
  if (!uid) {
    throw new Error("ユーザーIDが不正です");
  }
  for (const r of userRecords) {
    const d = coerceKpiWorkDateYmd(r.date);
    if (d && isWeekendYmdJst(d)) {
      throw new Error(JST_WEEKEND_WORK_REJECTED_MESSAGE);
    }
  }
  const sanitizedIncoming = userRecords.map(sanitizeKpiRecordForPersistence).filter((r): r is KpiRecord => r != null);
  if (userRecords.length > 0 && sanitizedIncoming.length === 0) {
    throw new Error("KPIの入力が無効です。日付・数値を確認してください。");
  }
  const explicitSlotKeys = new Set(sanitizedIncoming.map((r) => kpiAggregationKey({ ...r, userId: uid })));
  const all = await loadKpi();
  const merged = mergeUserKpiPreserveExistingByDate(all, uid, sanitizedIncoming, { explicitSlotKeys });
  await saveKpi(merged, opts);
}

/** ログイン: login_account と password が一致するユーザーを返す（bcrypt または従来の平文） */
export async function loginUser(loginAccount: string, password: string): Promise<Member | null> {
  const members = await loadMembers();
  if (members === null) return null;
  const trimmed = loginAccount.trim();
  const found = members.find(
    (m) => (m.loginAccount ?? "").toLowerCase() === trimmed.toLowerCase() && m.isActive !== false
  );
  if (!found) return null;
  if (!(await passwordMatchesStored(found.password ?? "", password))) return null;
  return found;
}

/** エクスポート用: 全データを取得 */
export async function exportAllDataFromSupabase(): Promise<{
  version: number;
  exportedAt: string;
  records: WorkRecord[];
  openRecords: OpenRecord[];
  shifts: Shift[];
  kpi: KpiRecord[];
  members: Member[];
}> {
  const [records, openRecords, shifts, kpi, membersOrNull] = await Promise.all([
    loadRecords(),
    loadOpenRecords(),
    loadShifts(),
    loadKpi(),
    loadMembers(),
  ]);
  const members = membersOrNull ?? [];
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    records,
    openRecords,
    shifts,
    kpi,
    members,
  };
}

/** インポート: JSON データを Supabase に投入 */
export async function importAllDataToSupabase(data: {
  records?: WorkRecord[];
  openRecords?: OpenRecord[];
  shifts?: Shift[];
  kpi?: KpiRecord[];
  members?: Member[];
}): Promise<void> {
  if (data.records?.length) {
    const recs = data.records.filter((r) => !isWeekendYmdJst(r.date));
    if (recs.length < data.records.length) {
      console.warn("[import] 土曜・日曜の活動記録はインポートから除外しました");
    }
    if (recs.length > 0) await saveRecords(recs, { bypassWorkDurationSanity: true });
  }
  if (data.openRecords?.length) {
    const opens = data.openRecords.filter((r) => !isWeekendYmdJst(r.date));
    if (opens.length < data.openRecords.length) {
      console.warn("[import] 土曜・日曜の未終了打刻はインポートから除外しました");
    }
    if (opens.length > 0) await saveOpenRecords(opens);
  }
  if (data.shifts?.length) await saveShifts(data.shifts, { skipChangeHistory: true });
  if (data.kpi?.length) {
    const kpis = data.kpi.filter((k) => !isWeekendYmdJst(k.date));
    if (kpis.length < data.kpi.length) {
      console.warn("[import] 土曜・日曜の KPI はインポートから除外しました");
    }
    if (kpis.length > 0) await saveKpi(kpis, { skipChangeHistory: true });
  }
  if (data.members?.length) await saveMembers(data.members);
}

/**
 * 生産性低下 Slack（KPI 保存直後）を同一ユーザー・同一稼働日で1回だけ送るための枠を取得する。
 * INSERT に成功したときのみ true。既に行がある（23505）ときは false。
 */
export async function tryClaimKpiProductivityAlertSent(userId: string, workDate: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) {
    console.warn("[tryClaimKpiProductivityAlertSent] Supabase 未設定のため送信しません（重複防止のため DB ロックが必要です）");
    return false;
  }
  const { error } = await supabase.from("kpi_productivity_alert_sent").insert({
    user_id: userId,
    work_date: workDate,
  });
  if (!error) return true;
  const code = (error as { code?: string }).code;
  const msg = String((error as { message?: string }).message ?? "");
  if (code === "23505" || /duplicate key|unique constraint/i.test(msg)) {
    return false;
  }
  if (code === "42P01" || /does not exist|relation.*kpi_productivity_alert_sent/i.test(msg)) {
    console.warn(
      "[tryClaimKpiProductivityAlertSent] テーブル kpi_productivity_alert_sent が未作成です（マイグレーション未実行）。送信しません。"
    );
    return false;
  }
  console.warn("[tryClaimKpiProductivityAlertSent] insert error:", error);
  return false;
}

/** Slack 送信失敗時に枠を解放し、再保存時に再送できるようにする */
export async function releaseKpiProductivityAlertSent(userId: string, workDate: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase
    .from("kpi_productivity_alert_sent")
    .delete()
    .eq("user_id", userId)
    .eq("work_date", workDate);
  if (error) {
    console.warn("[releaseKpiProductivityAlertSent] delete error:", error);
  }
}

/** 終了打刻後 KPI 未入力 Slack を同一ユーザー×稼働日で 1 回だけ送るための枠（INSERT 成功時のみ true） */
export async function tryClaimKpiMissingAfterPunchAlertSent(userId: string, workDate: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) {
    console.warn("[tryClaimKpiMissingAfterPunchAlertSent] Supabase 未設定のため送信しません（重複防止のため DB ロックが必要です）");
    return false;
  }
  const { error } = await supabase.from("kpi_missing_after_punch_alert_sent").insert({
    user_id: userId,
    work_date: workDate,
  });
  if (!error) return true;
  const code = (error as { code?: string }).code;
  const msg = String((error as { message?: string }).message ?? "");
  if (code === "23505" || /duplicate key|unique constraint/i.test(msg)) {
    return false;
  }
  if (code === "42P01" || /does not exist|relation.*kpi_missing_after_punch_alert_sent/i.test(msg)) {
    console.warn(
      "[tryClaimKpiMissingAfterPunchAlertSent] テーブル kpi_missing_after_punch_alert_sent が未作成です（マイグレーション未実行）。送信しません。"
    );
    return false;
  }
  console.warn("[tryClaimKpiMissingAfterPunchAlertSent] insert error:", error);
  return false;
}

export async function releaseKpiMissingAfterPunchAlertSent(userId: string, workDate: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase
    .from("kpi_missing_after_punch_alert_sent")
    .delete()
    .eq("user_id", userId)
    .eq("work_date", workDate);
  if (error) {
    console.warn("[releaseKpiMissingAfterPunchAlertSent] delete error:", error);
  }
}
