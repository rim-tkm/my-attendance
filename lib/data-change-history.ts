import { kpiStartTimeToSqlTime } from "@/lib/attendance";
import { getSupabase } from "@/lib/supabase";

export type ChangeEntityType = "shift" | "kpi" | "attendance";

export type ShiftUpsertPayload = {
  id: string;
  user_id: string;
  date: string;
  start_planned: string;
  end_planned: string;
  start_planned2: string | null;
  end_planned2: string | null;
};

export type KpiUpsertPayload = {
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
  /** saveKpi での slack 通知済み時刻のマージ用（履歴の等価比較には含めない） */
  kpi_missing_slack_notified_at?: string | null;
};

/** `kpis` の upsert・履歴用。`start_time` は DB の time と同じ HH:mm:ss */
export type KpiSlot = { user_id: string; date: string; start_time: string };

export function kpiSlotKey(slot: KpiSlot): string {
  return `${slot.user_id}\t${slot.date}\t${slot.start_time}`;
}

export type DataChangeHistoryEntry = {
  id: string;
  entity_type: ChangeEntityType;
  entity_id: string;
  user_id: string | null;
  changed_at: string;
  source: string | null;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown>;
};

const ID_CHUNK = 80;

function normStr(v: string | number | null | undefined): string {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function shiftPayloadToCompare(p: ShiftUpsertPayload) {
  return {
    user_id: p.user_id,
    date: p.date,
    start_planned: normStr(p.start_planned),
    end_planned: normStr(p.end_planned),
    start_planned2: p.start_planned2 == null || normStr(p.start_planned2) === "" ? null : normStr(p.start_planned2),
    end_planned2: p.end_planned2 == null || normStr(p.end_planned2) === "" ? null : normStr(p.end_planned2),
  };
}

function shiftDbRowToCompare(r: ShiftUpsertPayload) {
  return shiftPayloadToCompare(r);
}

function shiftToHistoryObject(p: ShiftUpsertPayload): Record<string, unknown> {
  return {
    id: p.id,
    user_id: p.user_id,
    date: p.date,
    start_planned: normStr(p.start_planned),
    end_planned: normStr(p.end_planned),
    start_planned2: p.start_planned2 == null || normStr(p.start_planned2) === "" ? null : normStr(p.start_planned2),
    end_planned2: p.end_planned2 == null || normStr(p.end_planned2) === "" ? null : normStr(p.end_planned2),
  };
}

function shiftsContentEqual(oldRow: ShiftUpsertPayload, next: ShiftUpsertPayload): boolean {
  return JSON.stringify(shiftDbRowToCompare(oldRow)) === JSON.stringify(shiftPayloadToCompare(next));
}

function kpiPayloadToCompare(p: KpiUpsertPayload) {
  return {
    user_id: p.user_id,
    date: p.date,
    start_time: normStr(p.start_time ?? ""),
    total_calls: p.total_calls,
    valid_calls: p.valid_calls,
    kc_count: p.kc_count,
    follow_up_created: p.follow_up_created,
    decision_maker_apo: p.decision_maker_apo,
    non_decision_maker_apo: p.non_decision_maker_apo,
    confirmed_dm: p.confirmed_dm ?? 0,
    confirmed_non_dm: p.confirmed_non_dm ?? 0,
  };
}

function kpiToHistoryObject(p: KpiUpsertPayload): Record<string, unknown> {
  return { ...kpiPayloadToCompare(p), id: p.id };
}

function kpisContentEqual(oldRow: KpiUpsertPayload, next: KpiUpsertPayload): boolean {
  return JSON.stringify(kpiPayloadToCompare(oldRow)) === JSON.stringify(kpiPayloadToCompare(next));
}

async function fetchShiftsByIds(supabase: NonNullable<ReturnType<typeof getSupabase>>, ids: string[]) {
  const map = new Map<string, ShiftUpsertPayload>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const { data, error } = await supabase.from("shifts").select("*").in("id", chunk);
    if (error) {
      console.warn("[data_change_history] shifts select error:", error);
      return map;
    }
    for (const r of data ?? []) {
      const row = r as {
        id: string;
        user_id: string;
        date: string;
        start_planned: string;
        end_planned: string;
        start_planned2: string | null;
        end_planned2: string | null;
      };
      map.set(row.id, {
        id: row.id,
        user_id: row.user_id,
        date: row.date,
        start_planned: row.start_planned,
        end_planned: row.end_planned,
        start_planned2: row.start_planned2 ?? null,
        end_planned2: row.end_planned2 ?? null,
      });
    }
  }
  return map;
}

type DbKpiRowForHistory = {
  id: string;
  user_id: string;
  date: string;
  start_time: string | null;
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

function dbRowToKpiUpsertPayload(r: DbKpiRowForHistory): KpiUpsertPayload {
  const st = kpiStartTimeToSqlTime(r.start_time);
  return {
    id: r.id,
    user_id: r.user_id,
    date: r.date,
    start_time: st,
    total_calls: r.total_calls,
    valid_calls: r.valid_calls,
    kc_count: r.kc_count,
    follow_up_created: r.follow_up_created,
    decision_maker_apo: r.decision_maker_apo,
    non_decision_maker_apo: r.non_decision_maker_apo,
    confirmed_dm: Math.max(0, r.confirmed_dm ?? 0),
    confirmed_non_dm: Math.max(0, r.confirmed_non_dm ?? 0),
    kpi_missing_slack_notified_at: r.kpi_missing_slack_notified_at ?? null,
  };
}

/** 指定スロットに一致する KPI 行をまとめて取得（`(user_id, date, start_time)` と一致） */
export async function fetchKpiUpsertPayloadsBySlots(
  supabase: NonNullable<ReturnType<typeof getSupabase>>,
  slots: KpiSlot[]
): Promise<Map<string, KpiUpsertPayload>> {
  const map = new Map<string, KpiUpsertPayload>();
  if (slots.length === 0) return map;
  const want = new Set(slots.map((s) => kpiSlotKey(s)));
  const userIds = Array.from(new Set(slots.map((s) => s.user_id)));
  const dates = Array.from(new Set(slots.map((s) => s.date)));
  const { data, error } = await supabase.from("kpis").select("*").in("user_id", userIds).in("date", dates);
  if (error) {
    console.warn("[data_change_history] kpis slot select error:", error);
    return map;
  }
  for (const raw of data ?? []) {
    const payload = dbRowToKpiUpsertPayload(raw as DbKpiRowForHistory);
    const key = kpiSlotKey({
      user_id: payload.user_id,
      date: payload.date,
      start_time: kpiStartTimeToSqlTime(payload.start_time),
    });
    if (want.has(key)) map.set(key, payload);
  }
  return map;
}

/** upsert 直前に、内容が変わった行だけ変更履歴へ追記する（テーブル未作成時は何もしない） */
export async function logShiftUpsertHistory(rows: ShiftUpsertPayload[], source: string | null): Promise<void> {
  if (rows.length === 0) return;
  const supabase = getSupabase();
  if (!supabase) return;
  const ids = rows.map((r) => r.id);
  const prevById = await fetchShiftsByIds(supabase, ids);
  const inserts: {
    entity_type: ChangeEntityType;
    entity_id: string;
    user_id: string | null;
    source: string | null;
    old_row: Record<string, unknown> | null;
    new_row: Record<string, unknown>;
  }[] = [];
  for (const next of rows) {
    const old = prevById.get(next.id);
    if (old && shiftsContentEqual(old, next)) continue;
    inserts.push({
      entity_type: "shift",
      entity_id: next.id,
      user_id: next.user_id,
      source,
      old_row: old ? shiftToHistoryObject(old) : null,
      new_row: shiftToHistoryObject(next),
    });
  }
  if (inserts.length === 0) return;
  const { error } = await supabase.from("data_change_history").insert(inserts);
  if (error) {
    console.warn("[data_change_history] shift insert error (upsert は続行可):", error);
  }
}

/** `saveKpi` の natural-key upsert 後に、メトリクス変化のみ監査ログへ追記する */
export async function appendKpiChangeHistoryForSlots(
  prevByKey: Map<string, KpiUpsertPayload>,
  nextByKey: Map<string, KpiUpsertPayload>,
  slots: KpiSlot[],
  source: string | null
): Promise<void> {
  if (slots.length === 0) return;
  const supabase = getSupabase();
  if (!supabase) return;
  const inserts: {
    entity_type: ChangeEntityType;
    entity_id: string;
    user_id: string | null;
    source: string | null;
    old_row: Record<string, unknown> | null;
    new_row: Record<string, unknown>;
  }[] = [];
  for (const slot of slots) {
    const key = kpiSlotKey(slot);
    const old = prevByKey.get(key);
    const next = nextByKey.get(key);
    if (!next) continue;
    if (old && kpisContentEqual(old, next)) continue;
    inserts.push({
      entity_type: "kpi",
      entity_id: next.id,
      user_id: next.user_id,
      source,
      old_row: old ? kpiToHistoryObject(old) : null,
      new_row: kpiToHistoryObject(next),
    });
  }
  if (inserts.length === 0) return;
  const { error } = await supabase.from("data_change_history").insert(inserts);
  if (error) {
    console.warn("[data_change_history] kpi insert error (upsert は続行可):", error);
  }
}

/** 予実調整の管理者手動上書きなど、活動記録まわりの監査ログ（1 行挿入） */
export async function logAttendanceAdminManualOverrideHistory(params: {
  newAttendanceId: string;
  userId: string;
  source: string | null;
  oldRow: Record<string, unknown>;
  newRow: Record<string, unknown>;
}): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from("data_change_history").insert({
    entity_type: "attendance",
    entity_id: params.newAttendanceId,
    user_id: params.userId,
    source: params.source,
    old_row: params.oldRow,
    new_row: params.newRow,
  });
  if (error) {
    console.warn("[data_change_history] attendance manual override insert error:", error);
  }
}

/** 指定エンティティの変更履歴を新しい順に取得（管理・調査用） */
export async function loadEntityChangeHistory(
  entityType: ChangeEntityType,
  entityId: string,
  limit = 200
): Promise<DataChangeHistoryEntry[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("data_change_history")
    .select("id, entity_type, entity_id, user_id, changed_at, source, old_row, new_row")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("changed_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("[data_change_history] load error:", error);
    return [];
  }
  return (data ?? []) as DataChangeHistoryEntry[];
}
