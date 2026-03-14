import type { Member, WorkRecord, OpenRecord, Shift, KpiRecord } from "@/lib/attendance";
import { DEFAULT_HOURLY_RATE } from "@/lib/attendance";
import { getSupabase } from "@/lib/supabase";

type DbUser = {
  id: string;
  name: string;
  login_account: string | null;
  password: string | null;
  hourly_rate: number | null;
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
  total_calls: number;
  valid_calls: number;
  kc_count: number;
  follow_up_created: number;
  decision_maker_apo: number;
  non_decision_maker_apo: number;
};

function toMember(r: DbUser): Member {
  return {
    id: r.id,
    name: r.name ?? "",
    loginAccount: r.login_account ?? "",
    password: r.password ?? "",
    hourlyRate: typeof r.hourly_rate === "number" && r.hourly_rate >= 0 ? r.hourly_rate : DEFAULT_HOURLY_RATE,
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
  return {
    id: r.id,
    userId: r.user_id,
    date: r.date,
    totalCalls: r.total_calls,
    validCalls: r.valid_calls,
    kcCount: r.kc_count,
    followUpCreated: r.follow_up_created,
    decisionMakerApo: r.decision_maker_apo,
    nonDecisionMakerApo: r.non_decision_maker_apo,
  };
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

export async function saveMembers(members: Member[]): Promise<void> {
  if (members.length === 0) return;
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    const rows = members.map((m) => ({
      id: m.id,
      name: m.name,
      login_account: m.loginAccount ?? "",
      password: m.password ?? "",
      hourly_rate: m.hourlyRate ?? DEFAULT_HOURLY_RATE,
    }));
    await supabase.from("users").upsert(rows, { onConflict: "id" });
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
  };
  const supabase = getSupabase();
  if (!supabase) return newMember;
  try {
    await supabase.from("users").insert({
      id: newMember.id,
      name: newMember.name,
      login_account: newMember.loginAccount,
      password: newMember.password,
      hourly_rate: newMember.hourlyRate,
    });
  } catch (e) {
    console.warn("addMember error:", e);
  }
  return newMember;
}

export async function updateMember(
  memberId: string,
  updates: Partial<Pick<Member, "name" | "loginAccount" | "password" | "hourlyRate">>
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    const body: Record<string, unknown> = {};
    if (updates.name !== undefined) body.name = updates.name;
    if (updates.loginAccount !== undefined) body.login_account = updates.loginAccount;
    if (updates.password !== undefined) body.password = updates.password;
    if (updates.hourlyRate !== undefined) body.hourly_rate = updates.hourlyRate;
    if (Object.keys(body).length === 0) return;
    await supabase.from("users").update(body).eq("id", memberId);
  } catch (e) {
    console.warn("updateMember error:", e);
  }
}

export async function deleteMember(memberId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase.from("users").delete().eq("id", memberId);
  } catch (e) {
    console.warn("deleteMember error:", e);
  }
}

export async function loadRecords(): Promise<WorkRecord[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const rows = await safeQuery<DbAttendance>(supabase.from("attendance").select("*").order("date", { ascending: false }));
    return rows.map(toWorkRecord);
  } catch {
    return [];
  }
}

export async function saveRecords(records: WorkRecord[]): Promise<void> {
  if (records.length === 0) return;
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    const rows = records.map((r) => ({
      id: r.id,
      user_id: r.userId,
      start_raw: r.startRaw,
      start_rounded: r.startRounded,
      end_raw: r.endRaw,
      end_rounded: r.endRounded,
      duration_minutes: r.durationMinutes,
      date: r.date,
    }));
    await supabase.from("attendance").upsert(rows, { onConflict: "id" });
  } catch (e) {
    console.warn("saveRecords error:", e);
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
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    const { data: existing } = await supabase.from("open_records").select("id");
    if (existing?.length) {
      for (const row of existing) {
        await supabase.from("open_records").delete().eq("id", row.id);
      }
    }
    if (records.length === 0) return;
    const rows = records.map((r) => ({
      id: r.id,
      user_id: r.userId,
      start_raw: r.startRaw,
      start_rounded: r.startRounded,
      date: r.date,
    }));
    await supabase.from("open_records").insert(rows);
  } catch (e) {
    console.warn("saveOpenRecords error:", e);
  }
}

export async function loadShifts(): Promise<Shift[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const rows = await safeQuery<DbShift>(supabase.from("shifts").select("*").order("date", { ascending: false }));
    return rows.map(toShift);
  } catch {
    return [];
  }
}

export async function saveShifts(shifts: Shift[]): Promise<void> {
  if (shifts.length === 0) return;
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    const rows = shifts.map((s) => ({
      id: s.id,
      user_id: s.userId,
      date: s.date,
      start_planned: s.startPlanned,
      end_planned: s.endPlanned,
      start_planned2: s.startPlanned2 ?? null,
      end_planned2: s.endPlanned2 ?? null,
    }));
    await supabase.from("shifts").upsert(rows, { onConflict: "id" });
  } catch (e) {
    console.warn("saveShifts error:", e);
  }
}

export async function loadKpi(): Promise<KpiRecord[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const rows = await safeQuery<DbKpi>(supabase.from("kpis").select("*").order("date", { ascending: false }));
    return rows.map(toKpiRecord);
  } catch {
    return [];
  }
}

export async function saveKpi(records: KpiRecord[]): Promise<void> {
  if (records.length === 0) return;
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    const rows = records.map((r) => ({
      id: r.id,
      user_id: r.userId,
      date: r.date,
      total_calls: r.totalCalls,
      valid_calls: r.validCalls,
      kc_count: r.kcCount,
      follow_up_created: r.followUpCreated,
      decision_maker_apo: r.decisionMakerApo,
      non_decision_maker_apo: r.nonDecisionMakerApo,
    }));
    await supabase.from("kpis").upsert(rows, { onConflict: "id" });
  } catch (e) {
    console.warn("saveKpi error:", e);
  }
}

/** 指定ユーザー分の稼働を差し替えて保存（他ユーザー分は維持） */
export async function saveRecordsForUser(userId: string, userRecords: WorkRecord[]): Promise<void> {
  const all = await loadRecords();
  const rest = all.filter((r) => r.userId !== userId);
  const withUserId = userRecords.map((r) => ({ ...r, userId }));
  await saveRecords([...rest, ...withUserId]);
}

/** 指定ユーザーの未終了稼働を設定 */
export async function setOpenRecordForUser(userId: string, record: OpenRecord | null): Promise<void> {
  const all = await loadOpenRecords();
  const rest = all.filter((r) => r.userId !== userId);
  const next = record ? [...rest, { ...record, userId }] : rest;
  await saveOpenRecords(next);
}

export async function saveShiftsForUser(userId: string, userShifts: Shift[]): Promise<void> {
  const all = await loadShifts();
  const rest = all.filter((s) => s.userId !== userId);
  const withUserId = userShifts.map((s) => ({ ...s, userId }));
  await saveShifts([...rest, ...withUserId]);
}

export async function saveKpiForUser(userId: string, userRecords: KpiRecord[]): Promise<void> {
  const all = await loadKpi();
  const rest = all.filter((r) => r.userId !== userId);
  const withUserId = userRecords.map((r) => ({ ...r, userId }));
  await saveKpi([...rest, ...withUserId]);
}

/** ログイン: login_account と password が一致するユーザーを返す */
export async function loginUser(loginAccount: string, password: string): Promise<Member | null> {
  const members = await loadMembers();
  if (members === null) return null;
  const trimmed = loginAccount.trim();
  const found = members.find((m) => (m.loginAccount ?? "").toLowerCase() === trimmed.toLowerCase() && m.password === password);
  return found ?? null;
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
  if (data.records?.length) await saveRecords(data.records);
  if (data.openRecords?.length) await saveOpenRecords(data.openRecords);
  if (data.shifts?.length) await saveShifts(data.shifts);
  if (data.kpi?.length) await saveKpi(data.kpi);
  if (data.members?.length) await saveMembers(data.members);
}
