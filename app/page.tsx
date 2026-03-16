"use client";

import { useEffect, useState, useCallback } from "react";
import type { WorkRecord, OpenRecord, Shift, KpiRecord, Member } from "@/lib/attendance";
import {
  DEFAULT_HOURLY_RATE,
  roundUpTo15Minutes,
  roundDownTo15Minutes,
  calcDurationMinutes,
  toDateString,
  formatDuration,
  getRecordsForMonth,
  getRecordsForDate,
  getTotalMinutesForMonth,
  getTotalMinutesForDate,
  getSelectableMonths,
  getOpenRecordForUser,
  getRecordsForUser,
  getShiftsForUser,
  getKpiForUser,
  getKpiForDate,
  getKpiForMonth,
  getMonthlyKpiTotals,
  getThisWeekMondayDateString,
  getKpiInDateRange,
  getKpiTotalsFromRecords,
  get15MinOptions,
  getShiftPlannedMinutes,
  getWeekStart,
  getWeekDates,
  getTargetWeekStart,
  getDeadlineForWeek,
  getShiftsByDateForWeek,
  getKpiRates,
  safeRatePercent,
  getTotalMinutesForMonthByUser,
  calcMonthlyPay,
} from "@/lib/attendance";
import {
  loadMembers,
  addMember,
  updateMember,
  deleteMember,
  loadRecords,
  loadOpenRecords,
  loadShifts,
  loadKpi,
  saveRecordsForUser,
  setOpenRecordForUser,
  saveShiftsForUser,
  saveKpiForUser,
  loginUser,
  exportAllDataFromSupabase,
  importAllDataToSupabase,
} from "@/lib/supabase-data";

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function formatDisplayDate(dateStr: string): string {
  const parts = dateStr.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  const date = new Date(y, (m || 1) - 1, d || 1);
  return date.toLocaleDateString("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

type Tab = "home" | "shift" | "kpi";
type AdminSection = "dashboard" | "attendance" | "shift" | "kpi" | "settings";

const KPI_LABELS: { key: keyof Omit<KpiRecord, "id" | "date" | "userId">; label: string }[] = [
  { key: "totalCalls", label: "総コール数" },
  { key: "validCalls", label: "有効コール数" },
  { key: "kcCount", label: "KC数" },
  { key: "followUpCreated", label: "追いかけ作成数" },
  { key: "decisionMakerApo", label: "決裁者アポ数" },
  { key: "nonDecisionMakerApo", label: "非決裁者アポ数" },
];

function AdminDashboard(props: {
  allRecords: WorkRecord[];
  allOpenRecords: OpenRecord[];
  allShifts: Shift[];
  allKpiRecords: KpiRecord[];
  members: Member[];
  setMembers: (v: Member[] | ((prev: Member[]) => Member[])) => void;
  onRefresh: () => void;
}) {
  const {
    allRecords,
    allOpenRecords,
    allShifts,
    allKpiRecords,
    members,
    setMembers,
    onRefresh,
  } = props;
  const [adminSection, setAdminSection] = useState<AdminSection>("dashboard");
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberLogin, setNewMemberLogin] = useState("");
  const [newMemberPassword, setNewMemberPassword] = useState("");
  const [newMemberHourlyRate, setNewMemberHourlyRate] = useState(DEFAULT_HOURLY_RATE);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editLogin, setEditLogin] = useState("");
  const [editPass, setEditPass] = useState("");
  const [editRate, setEditRate] = useState(DEFAULT_HOURLY_RATE);
  const [kpiDate, setKpiDate] = useState(() => toDateString(new Date()));
  const [dashboardDate, setDashboardDate] = useState(() => toDateString(new Date()));
  const [backupExpanded, setBackupExpanded] = useState(false);
  const [rangeStart, setRangeStart] = useState(() => getThisWeekMondayDateString());
  const [rangeEnd, setRangeEnd] = useState(() => toDateString(new Date()));

  const y = new Date().getFullYear();
  const m = new Date().getMonth() + 1;
  const currentYearMonth = `${y}-${String(m).padStart(2, "0")}`;
  const todayStr = toDateString(new Date());
  const teamTotals = getMonthlyKpiTotals(allKpiRecords, currentYearMonth);
  const teamValidRate = safeRatePercent(teamTotals.validCalls, teamTotals.totalCalls);
  const teamKcRate = safeRatePercent(teamTotals.kcCount, teamTotals.validCalls);
  const teamApoRate = safeRatePercent(teamTotals.decisionMakerApo, teamTotals.kcCount);
  const monthTeamMinutes = members.reduce((s, mem) => s + getTotalMinutesForMonthByUser(allRecords, mem.id, currentYearMonth), 0);
  const monthApoCostMinutes = teamTotals.decisionMakerApo > 0 ? monthTeamMinutes / teamTotals.decisionMakerApo : null;

  const thisWeekMonday = getThisWeekMondayDateString();
  const weekKpis = getKpiInDateRange(allKpiRecords, thisWeekMonday, todayStr);
  const weekTotals = getKpiTotalsFromRecords(weekKpis);
  const weekValidRate = safeRatePercent(weekTotals.validCalls, weekTotals.totalCalls);
  const weekKcRate = safeRatePercent(weekTotals.kcCount, weekTotals.validCalls);
  const weekApoRate = safeRatePercent(weekTotals.decisionMakerApo, weekTotals.kcCount);

  // ダッシュボード表示日付に基づく集計（Supabase kpis / attendance / open_records を日付でフィルタ）
  const dateKpis = allKpiRecords.filter((k) => k.date === dashboardDate);
  const dateDecision = dateKpis.reduce((s, k) => s + k.decisionMakerApo, 0);
  const dateNonDecision = dateKpis.reduce((s, k) => s + k.nonDecisionMakerApo, 0);
  // 選択日の「業務開始」活動記録が1回でもあるメンバー数（完了した記録 or 未終了の記録のいずれか）
  const userIdsFromAttendance = allRecords.filter((r) => r.date === dashboardDate).map((r) => r.userId);
  const userIdsFromOpen = allOpenRecords.filter((r) => r.date === dashboardDate).map((r) => r.userId);
  const workingCountForDate = new Set([...userIdsFromAttendance, ...userIdsFromOpen]).size;
  const dateTeamMinutes = allRecords.filter((r) => r.date === dashboardDate).reduce((s, r) => s + r.durationMinutes, 0);
  const dateApoCostMinutes = dateDecision > 0 ? dateTeamMinutes / dateDecision : null;
  // 決裁者アポまたは非決裁者アポが1件以上あるメンバーのみ、決裁者アポ多い順
  const apoListForDate = members
    .map((mem) => {
      const k = getKpiForDate(getKpiForUser(allKpiRecords, mem.id), dashboardDate);
      const dec = k ? k.decisionMakerApo : 0;
      const non = k ? k.nonDecisionMakerApo : 0;
      return { mem, dec, non };
    })
    .filter(({ dec, non }) => dec >= 1 || non >= 1)
    .sort((a, b) => b.dec - a.dec);

  const handleAdd = async () => {
    if (!newMemberName.trim()) return;
    await addMember(newMemberName.trim(), {
      loginAccount: newMemberLogin.trim(),
      password: newMemberPassword,
      hourlyRate: newMemberHourlyRate >= 0 ? newMemberHourlyRate : DEFAULT_HOURLY_RATE,
    });
    const mems = await loadMembers();
    setMembers(mems ?? []);
    setNewMemberName("");
    setNewMemberLogin("");
    setNewMemberPassword("");
    setNewMemberHourlyRate(DEFAULT_HOURLY_RATE);
    onRefresh();
  };

  const openDetail = (member: Member) => {
    setDetailId(member.id);
    setEditName(member.name);
    setEditLogin(member.loginAccount ?? "");
    setEditPass("");
    setEditRate(member.hourlyRate ?? DEFAULT_HOURLY_RATE);
  };

  const saveDetail = async () => {
    if (!detailId) return;
    const updates: { name: string; loginAccount: string; hourlyRate: number; password?: string } = {
      name: editName.trim(),
      loginAccount: editLogin.trim(),
      hourlyRate: editRate >= 0 ? editRate : DEFAULT_HOURLY_RATE,
    };
    if (editPass !== "") updates.password = editPass;
    await updateMember(detailId, updates);
    const mems = await loadMembers();
    setMembers(mems ?? []);
    setDetailId(null);
    onRefresh();
  };

  const targetWeekStart = getTargetWeekStart();
  const targetWeekDates = getWeekDates(targetWeekStart);

  const navItems: { id: AdminSection; label: string }[] = [
    { id: "dashboard", label: "ダッシュボード" },
    { id: "attendance", label: "稼働状況" },
    { id: "shift", label: "稼働予定管理" },
    { id: "kpi", label: "業務委託KPI" },
    { id: "settings", label: "管理設定" },
  ];

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-0 border-b border-slate-200 bg-white shadow-sm">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setAdminSection(item.id)}
            className={`px-4 py-3 text-sm font-medium transition ${adminSection === item.id ? "border-b-2 border-slate-700 text-slate-800" : "text-slate-500 hover:text-slate-700"}`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {adminSection === "dashboard" && (
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center gap-4">
              <h2 className="text-sm font-medium text-slate-700">チーム成果</h2>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-500">表示日付</span>
                <input
                  type="date"
                  value={dashboardDate}
                  onChange={(e) => setDashboardDate(e.target.value)}
                  className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-800"
                />
            </label>
            </div>
            <div className="mb-4 flex flex-wrap gap-4">
              <div className="rounded-lg bg-emerald-700 px-4 py-3 text-white">
                <div className="text-xs text-emerald-100">決裁者アポ合計</div>
                <div className="text-2xl font-bold">{dateDecision} 件</div>
              </div>
              <div className="rounded-lg bg-teal-700 px-4 py-3 text-white">
                <div className="text-xs text-teal-100">非決裁者アポ合計</div>
                <div className="text-2xl font-bold">{dateNonDecision} 件</div>
              </div>
              <div className="rounded-lg bg-amber-600 px-4 py-3 text-white">
                <div className="text-xs text-amber-100">本日の活動人数</div>
                <div className="text-2xl font-bold">{workingCountForDate} 名</div>
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-slate-500">アポ取得一覧（決裁者 or 非決裁者1件以上のメンバー、決裁者アポ多い順）</div>
              {apoListForDate.length === 0 ? (
                <p className="rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-500">指定された日のアポ獲得者はまだいません</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {apoListForDate.map(({ mem, dec, non }) => (
                    <span key={mem.id} className="inline-flex items-center rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-800">
                      <span className="font-medium">{mem.name}</span>
                      <span className="ml-1.5 text-slate-600">：決裁者{dec}件 / 非決裁者{non}件</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-medium text-slate-700">KPI統計（今月・今週）</h2>
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">今月のKPI統計（{currentYearMonth}）</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg bg-slate-800 p-4 text-white">
                    <div className="text-xs text-slate-300">総架電数合計</div>
                    <div className="text-2xl font-bold">{teamTotals.totalCalls}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">有効対話数合計</div>
                    <div className="text-2xl font-bold">{teamTotals.validCalls}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">決裁者アポ数合計</div>
                    <div className="text-2xl font-bold">{teamTotals.decisionMakerApo}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">有効率</div>
                    <div className="text-2xl font-bold">{teamValidRate != null ? `${teamValidRate}%` : "—"}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">KC率（決裁者接続率）</div>
                    <div className="text-2xl font-bold">{teamKcRate != null ? `${teamKcRate}%` : "—"}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">アポ率</div>
                    <div className="text-2xl font-bold">{teamApoRate != null ? `${teamApoRate}%` : "—"}</div>
                  </div>
                </div>
              </div>
              <div>
                <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">今週のKPI統計（月曜〜今日）</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg bg-slate-800 p-4 text-white">
                    <div className="text-xs text-slate-300">総架電数合計</div>
                    <div className="text-2xl font-bold">{weekTotals.totalCalls}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">有効対話数合計</div>
                    <div className="text-2xl font-bold">{weekTotals.validCalls}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">決裁者アポ数合計</div>
                    <div className="text-2xl font-bold">{weekTotals.decisionMakerApo}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">有効率</div>
                    <div className="text-2xl font-bold">{weekValidRate != null ? `${weekValidRate}%` : "—"}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">KC率（決裁者接続率）</div>
                    <div className="text-2xl font-bold">{weekKcRate != null ? `${weekKcRate}%` : "—"}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">アポ率</div>
                    <div className="text-2xl font-bold">{weekApoRate != null ? `${weekApoRate}%` : "—"}</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-medium text-slate-700">生産性指標（アポ取得単価・時間ベース）</h2>
            <p className="mb-4 text-xs text-slate-500">決裁者アポ1件あたりの活動時間。数値が小さいほど効率が良いです。</p>
            <div className="flex flex-wrap gap-6">
              <div className="rounded-lg bg-slate-800 px-4 py-3 text-white">
                <div className="text-xs text-slate-300">表示日のアポ取得単価（チーム全体）</div>
                <div className="text-xl font-bold">
                  {dateApoCostMinutes != null ? `${formatDuration(Math.round(dateApoCostMinutes))}/件` : "—"}
                </div>
              </div>
              <div className="rounded-lg bg-slate-700 px-4 py-3 text-white">
                <div className="text-xs text-slate-300">今月の平均アポ取得単価（チーム全体）</div>
                <div className="text-xl font-bold">
                  {monthApoCostMinutes != null ? `${formatDuration(Math.round(monthApoCostMinutes))}/件` : "—"}
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {adminSection === "attendance" && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-medium text-slate-700">稼働状況（本日）</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[500px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-3 py-2.5 text-left font-medium text-slate-600">名前</th>
                  <th className="px-3 py-2.5 text-center font-medium text-slate-600">ステータス</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600">当日の活動時間</th>
                </tr>
              </thead>
              <tbody>
                {members.map((mem) => {
                  const open = getOpenRecordForUser(allOpenRecords, mem.id);
                  const userRecords = getRecordsForUser(allRecords, mem.id);
                  const todayMin = userRecords.filter((r) => r.date === todayStr).reduce((s, r) => s + r.durationMinutes, 0);
                  return (
                    <tr key={mem.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                      <td className="px-3 py-2.5 font-medium text-slate-800">{mem.name}</td>
                      <td className="px-3 py-2.5 text-center">
                        {open ? (
                          <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">活動中</span>
                        ) : (
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">活動なし</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{formatDuration(todayMin)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {adminSection === "shift" && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-2 text-sm font-medium text-slate-700">稼働予定管理</h2>
          <p className="mb-4 text-xs text-slate-500">対象週: {formatDisplayDate(targetWeekDates[0])} ～ {formatDisplayDate(targetWeekDates[6])}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-3 py-2.5 text-left font-medium text-slate-600">名前</th>
                  <th className="px-3 py-2.5 text-center font-medium text-slate-600">登録状況</th>
                  <th className="px-3 py-2.5 text-left font-medium text-slate-600">登録済み稼働予定（直近）</th>
                </tr>
              </thead>
              <tbody>
                {members.map((mem) => {
                  const userShifts = getShiftsForUser(allShifts, mem.id);
                  const hasShiftThisWeek = targetWeekDates.some((d) => userShifts.some((s) => s.date === d));
                  const recentShifts = [...userShifts].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
                  return (
                    <tr key={mem.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                      <td className="px-3 py-2.5 font-medium text-slate-800">{mem.name}</td>
                      <td className="px-3 py-2.5 text-center">
                        {hasShiftThisWeek ? (
                          <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">登録済</span>
                        ) : (
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">未登録</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">
                        {recentShifts.length === 0 ? "—" : recentShifts.map((s) => `${formatDisplayDate(s.date)} ${s.startPlanned}～${s.endPlanned}`).join(" / ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {adminSection === "kpi" && (
        <section className="space-y-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <h2 className="mb-4 text-sm font-medium text-slate-700">期間指定（カスタム集計）</h2>
            <div className="mb-4 flex flex-wrap items-end gap-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">開始日</span>
                <input
                  type="date"
                  value={rangeStart}
                  onChange={(e) => setRangeStart(e.target.value)}
                  className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-800"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">終了日</span>
                <input
                  type="date"
                  value={rangeEnd}
                  onChange={(e) => setRangeEnd(e.target.value)}
                  className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-800"
                />
              </label>
            </div>
            {(() => {
              const start = rangeStart <= rangeEnd ? rangeStart : rangeEnd;
              const end = rangeStart <= rangeEnd ? rangeEnd : rangeStart;
              const rangeKpis = getKpiInDateRange(allKpiRecords, start, end);
              const rangeTotals = getKpiTotalsFromRecords(rangeKpis);
              const rangeValidRate = safeRatePercent(rangeTotals.validCalls, rangeTotals.totalCalls);
              const rangeKcRate = safeRatePercent(rangeTotals.kcCount, rangeTotals.validCalls);
              const rangeApoRate = safeRatePercent(rangeTotals.decisionMakerApo, rangeTotals.kcCount);
              return (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-lg bg-slate-800 p-4 text-white">
                    <div className="text-xs text-slate-300">総架電数</div>
                    <div className="text-2xl font-bold">{rangeTotals.totalCalls}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">有効対話数</div>
                    <div className="text-2xl font-bold">{rangeTotals.validCalls}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">決裁者アポ数</div>
                    <div className="text-2xl font-bold">{rangeTotals.decisionMakerApo}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">有効率</div>
                    <div className="text-2xl font-bold">{rangeValidRate != null ? `${rangeValidRate}%` : "—"}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">KC率（決裁者接続率）</div>
                    <div className="text-2xl font-bold">{rangeKcRate != null ? `${rangeKcRate}%` : "—"}</div>
                  </div>
                  <div className="rounded-lg bg-slate-700 p-4 text-white">
                    <div className="text-xs text-slate-300">アポ率</div>
                    <div className="text-2xl font-bold">{rangeApoRate != null ? `${rangeApoRate}%` : "—"}</div>
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="border-t border-slate-200 pt-6">
          <h2 className="mb-4 text-sm font-medium text-slate-700">業務委託KPI（日別）</h2>
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">表示日付</span>
              <input
                type="date"
                value={kpiDate}
                onChange={(e) => setKpiDate(e.target.value)}
                className="rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-3 py-2.5 text-left font-medium text-slate-600">名前</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600">総コール</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600">有効</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600">KC</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600">追いかけ</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600">決裁者アポ</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600">非決裁者アポ</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600">有効率</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600">KC率</th>
                  <th className="px-3 py-2.5 text-right font-medium text-slate-600">アポ率</th>
                </tr>
              </thead>
              <tbody>
                {members.map((mem) => {
                  const dayKpi = getKpiForDate(getKpiForUser(allKpiRecords, mem.id), kpiDate);
                  const rates = dayKpi ? getKpiRates(dayKpi) : null;
                  return (
                    <tr key={mem.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                      <td className="px-3 py-2.5 font-medium text-slate-800">{mem.name}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{dayKpi ? dayKpi.totalCalls : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{dayKpi ? dayKpi.validCalls : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{dayKpi ? dayKpi.kcCount : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{dayKpi ? dayKpi.followUpCreated : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{dayKpi ? dayKpi.decisionMakerApo : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{dayKpi ? dayKpi.nonDecisionMakerApo : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{rates?.validRate != null ? `${rates.validRate}%` : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{rates?.kcRate != null ? `${rates.kcRate}%` : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{rates?.apoRate != null ? `${rates.apoRate}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </div>
        </section>
      )}

      {adminSection === "settings" && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-medium text-slate-700">管理設定（メンバー追加・編集・削除）</h2>

          <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-5 sm:p-6">
            <p className="mb-4 text-sm font-medium text-slate-700">新規メンバー追加</p>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5 lg:gap-6">
              <div className="flex min-w-0 flex-col gap-2">
                <label className="text-xs font-medium text-slate-600">名前</label>
                <input type="text" value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)} placeholder="表示名" className="h-10 w-full min-w-0 rounded border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <label className="text-xs font-medium text-slate-600">ユーザー名（ログイン用）</label>
                <input type="text" value={newMemberLogin} onChange={(e) => setNewMemberLogin(e.target.value)} placeholder="ログインID" className="h-10 w-full min-w-0 rounded border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <label className="text-xs font-medium text-slate-600">パスワード</label>
                <input type="password" value={newMemberPassword} onChange={(e) => setNewMemberPassword(e.target.value)} placeholder="パスワード" className="h-10 w-full min-w-0 rounded border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <label className="text-xs font-medium text-slate-600">委託料単価（/h・円）</label>
                <input type="number" min={0} value={newMemberHourlyRate} onChange={(e) => setNewMemberHourlyRate(parseInt(e.target.value, 10) || 0)} className="h-10 w-full min-w-0 rounded border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="flex min-w-0 flex-col gap-2 lg:justify-end">
                <label className="text-xs font-medium text-slate-600 lg:invisible">操作</label>
                <button type="button" onClick={handleAdd} className="h-10 w-full rounded bg-slate-700 px-4 text-sm font-medium text-white hover:bg-slate-600 lg:w-full">追加</button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-2 py-2.5 text-left font-medium text-slate-600">名前</th>
                  <th className="px-2 py-2.5 text-left font-medium text-slate-600">ログイン名</th>
                  <th className="px-2 py-2.5 text-left font-medium text-slate-600">パスワード</th>
                  <th className="px-2 py-2.5 text-right font-medium text-slate-600">今月の活動時間</th>
                  <th className="px-2 py-2.5 text-right font-medium text-slate-600">概算委託料</th>
                  <th className="px-2 py-2.5 text-right font-medium text-slate-600 whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody>
                {members.map((mem) => {
                  const monthMin = getTotalMinutesForMonthByUser(allRecords, mem.id, currentYearMonth);
                  const rate = mem.hourlyRate != null ? mem.hourlyRate : DEFAULT_HOURLY_RATE;
                  const pay = calcMonthlyPay(monthMin, rate);
                  return (
                    <tr key={mem.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                      <td className="px-2 py-2.5 font-medium text-slate-800">{mem.name}</td>
                      <td className="px-2 py-2.5 text-slate-600">{mem.loginAccount || "—"}</td>
                      <td className="px-2 py-2.5 font-mono text-slate-700">{mem.password || "—"}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-slate-700">{formatDuration(monthMin)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums font-medium text-slate-800">¥{pay.toLocaleString()}</td>
                      <td className="px-2 py-2.5 text-right whitespace-nowrap">
                        <button type="button" onClick={() => openDetail(mem)} className="mr-2 text-slate-600 underline hover:text-slate-800">編集</button>
                        <button
                          type="button"
                          onClick={async () => { if (window.confirm(`${mem.name} を削除しますか？`)) { await deleteMember(mem.id); const mems = await loadMembers(); setMembers(mems ?? []); onRefresh(); } }}
                          className="text-red-600 underline hover:text-red-800"
                        >
                          削除
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {detailId !== null && (
            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <h3 className="mb-3 text-sm font-medium text-slate-700">メンバー詳細設定（編集）</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-0.5 block text-xs text-slate-500">名前</label>
                  <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-slate-500">ログイン用アカウント名</label>
                  <input type="text" value={editLogin} onChange={(e) => setEditLogin(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-slate-500">パスワード</label>
                  <input type="password" value={editPass} onChange={(e) => setEditPass(e.target.value)} placeholder="変更時のみ。空欄で変更しません" className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-slate-500">委託料単価（/h・円）</label>
                  <input type="number" min={0} value={editRate} onChange={(e) => setEditRate(parseInt(e.target.value, 10) || 0)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={saveDetail} className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600">保存</button>
                <button type="button" onClick={() => setDetailId(null)} className="rounded border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">キャンセル</button>
              </div>
            </div>
          )}

          <div className="mt-8 border-t border-slate-100 pt-6">
            {!backupExpanded ? (
              <button
                type="button"
                onClick={() => setBackupExpanded(true)}
                className="text-xs text-slate-400 hover:text-slate-600 underline"
              >
                バックアップ・高度な設定を表示
              </button>
            ) : (
              <div className="rounded border border-slate-100 bg-slate-50/50 p-4">
                <p className="mb-2 text-xs text-slate-500">データのバックアップ・復元（Supabase のデータをJSONで出し入れできます）</p>
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const data = await exportAllDataFromSupabase();
                        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `kado-backup-${data.exportedAt.slice(0, 10)}-${Date.now()}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                      } catch (e) {
                        alert("エクスポートに失敗しました。");
                      }
                    }}
                    className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    バックアップをダウンロード
                  </button>
                  <label className="flex cursor-pointer items-center rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
                    <span>ファイルから復元</span>
                    <input
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = async () => {
                          try {
                            const data = JSON.parse(reader.result as string);
                            if (!data || typeof data !== "object") throw new Error("不正な形式です");
                            await importAllDataToSupabase(data);
                            onRefresh();
                            const mems = await loadMembers();
                            setMembers(mems ?? []);
                            alert("復元が完了しました。画面を更新します。");
                            window.location.reload();
                          } catch (err) {
                            alert("復元に失敗しました。正しいバックアップファイルか確認してください。");
                          }
                        };
                        reader.readAsText(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <button type="button" onClick={() => setBackupExpanded(false)} className="text-xs text-slate-400 hover:text-slate-600 underline">
                    閉じる
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function HistorySection(props: {
  monthRecords: WorkRecord[];
  monthShifts: Shift[];
  monthKpi: KpiRecord[];
  currentYearMonth: string;
  isCurrentMonth: boolean;
}) {
  const { monthRecords, monthShifts, monthKpi, currentYearMonth, isCurrentMonth } = props;
  const dateToShifts = new Map<string, Shift[]>();
  monthShifts.forEach((s) => {
    const list = dateToShifts.get(s.date) || [];
    list.push(s);
    dateToShifts.set(s.date, list);
  });
  const dateToRecords = new Map<string, WorkRecord[]>();
  monthRecords.forEach((r) => {
    const list = dateToRecords.get(r.date) || [];
    list.push(r);
    dateToRecords.set(r.date, list);
  });
  const dateToKpi = new Map<string, KpiRecord>();
  monthKpi.forEach((k) => dateToKpi.set(k.date, k));
  const allDates = new Set<string>();
  dateToShifts.forEach((_, key) => allDates.add(key));
  dateToRecords.forEach((_, key) => allDates.add(key));
  dateToKpi.forEach((_, key) => allDates.add(key));
  const sortedDates = Array.from(allDates).sort();

  return (
    <section className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200/80">
      <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 sm:px-5 sm:py-4">
        活動記録一覧（予定 vs 実績・KPI）
        {!isCurrentMonth ? `（${currentYearMonth}）` : ""}
      </h2>
      <div className="divide-y divide-slate-100">
        {sortedDates.length === 0 ? (
          <div className="px-4 py-8 text-center text-slate-500 sm:px-5">この月の履歴はありません</div>
        ) : (
          sortedDates.map((dateStr) => {
            const dayShifts = dateToShifts.get(dateStr) || [];
            const dayRecords = dateToRecords.get(dateStr) || [];
            const dayKpi = dateToKpi.get(dateStr);
            const plannedTotal = dayShifts.reduce((sum, s) => sum + getShiftPlannedMinutes(s), 0);
            const actualTotal = dayRecords.reduce((sum, r) => sum + r.durationMinutes, 0);
            const rates = dayKpi ? getKpiRates(dayKpi) : null;
            return (
              <div key={dateStr} className="px-4 py-4 sm:px-5">
                <div className="mb-2 font-medium text-slate-800">{formatDisplayDate(dateStr)}</div>
                <div className="mb-2 flex flex-wrap gap-4 text-sm">
                  <span className="text-slate-600">予定: {plannedTotal > 0 ? formatDuration(plannedTotal) : "—"}</span>
                  <span className="font-medium text-slate-800">実績: {formatDuration(actualTotal)}</span>
                </div>
                {dayKpi && (
                  <div className="mb-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <span className="font-medium text-slate-700">KPI: </span>
                    総コール {dayKpi.totalCalls} / 有効 {dayKpi.validCalls} / KC {dayKpi.kcCount} / 追いかけ {dayKpi.followUpCreated} / 決裁者アポ {dayKpi.decisionMakerApo} / 非決裁者アポ {dayKpi.nonDecisionMakerApo}
                    {rates && (
                      <div className="mt-1 text-slate-500">
                        有効率 {rates.validRate != null ? `${rates.validRate}%` : "—"} / KC率 {rates.kcRate != null ? `${rates.kcRate}%` : "—"} / アポ率 {rates.apoRate != null ? `${rates.apoRate}%` : "—"}
                      </div>
                    )}
                  </div>
                )}
                <ul className="space-y-1.5 pl-0">
                  {dayRecords.map((r) => (
                    <li key={r.id} className="flex justify-between text-sm text-slate-600">
                      <span>
                        {formatTime(r.startRounded)} ～ {formatTime(r.endRounded)}
                      </span>
                      <span className="font-medium text-slate-700">{formatDuration(r.durationMinutes)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

type WeekFormState = Record<string, { s1: string; e1: string; s2: string; e2: string }>;

function ShiftTab(props: {
  userId: string;
  shifts: Shift[];
  onSave: (s: Shift[]) => void;
  onRefresh: () => void;
}) {
  const { userId, shifts, onSave, onRefresh } = props;
  const options = get15MinOptions();
  const [exceptionMode, setExceptionMode] = useState(false);
  const [weekStart, setWeekStart] = useState("");
  const [weekForm, setWeekForm] = useState<WeekFormState>({});

  const targetStart = weekStart || getTargetWeekStart();
  const weekDates = getWeekDates(targetStart);
  const deadline = getDeadlineForWeek(targetStart);
  const isPastDeadline = new Date() > deadline;
  const byDate = getShiftsByDateForWeek(shifts, targetStart);

  useEffect(() => {
    const dates = getWeekDates(targetStart);
    const map = getShiftsByDateForWeek(shifts, targetStart);
    const next: WeekFormState = {};
    dates.forEach((dateStr) => {
      const s = map.get(dateStr);
      next[dateStr] = {
        s1: s ? s.startPlanned : "09:00",
        e1: s ? s.endPlanned : "18:00",
        s2: s && s.startPlanned2 ? s.startPlanned2 : "",
        e2: s && s.endPlanned2 ? s.endPlanned2 : "",
      };
    });
    setWeekForm((prev) => ({ ...next, ...prev }));
  }, [targetStart, shifts]);

  const updateDay = (dateStr: string, field: "s1" | "e1" | "s2" | "e2", value: string) => {
    setWeekForm((prev) => {
      const cur = prev[dateStr] || { s1: "09:00", e1: "18:00", s2: "", e2: "" };
      return { ...prev, [dateStr]: { ...cur, [field]: value } };
    });
  };

  const handleSubmitWeek = (e: React.FormEvent) => {
    e.preventDefault();
    const otherShifts = shifts.filter((s) => !weekDates.includes(s.date));
    const newShifts: Shift[] = weekDates.map((dateStr) => {
      const f = weekForm[dateStr] || { s1: "09:00", e1: "18:00", s2: "", e2: "" };
      const existing = byDate.get(dateStr);
      const base = {
        id: existing ? existing.id : crypto.randomUUID(),
        userId,
        date: dateStr,
        startPlanned: f.s1,
        endPlanned: f.e1,
      };
      if (f.s2 && f.e2) {
        return { ...base, startPlanned2: f.s2, endPlanned2: f.e2 };
      }
      return base;
    });
    onSave([...newShifts, ...otherShifts]);
    onRefresh();
  };

  const weekOptions: string[] = [];
  for (let i = -4; i <= 2; i++) {
    const d = new Date();
    d.setDate(d.getDate() + 7 * i);
    weekOptions.push(getWeekStart(d));
  }

  return (
    <>
      <section className="mb-6 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80 sm:p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-slate-700">稼働可能日時の登録</h2>
          <p className="text-xs text-slate-500">
            予定の登録をお願いします
          </p>
        </div>
        {exceptionMode && (
          <div className="mb-4">
            <label className="mb-1 block text-sm text-slate-600">対象週を選択</label>
            <select
              value={targetStart}
              onChange={(e) => setWeekStart(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800 sm:max-w-xs"
            >
              {weekOptions.map((ws) => {
                const [yy, mm, dd] = ws.split("-").map(Number);
                const mon = new Date(yy, mm - 1, dd);
                const sun = new Date(mon);
                sun.setDate(sun.getDate() + 6);
                const label = `${mon.getMonth() + 1}/${mon.getDate()}～${sun.getMonth() + 1}/${sun.getDate()}`;
                return (
                  <option key={ws} value={ws}>
                    {label}
                  </option>
                );
              })}
            </select>
          </div>
        )}
        <p className="mb-4 text-sm text-slate-600">
          {exceptionMode ? "選択した週の稼働予定を入力・修正できます。" : `${formatDisplayDate(weekDates[0])} ～ ${formatDisplayDate(weekDates[6])}`}
        </p>
        <form onSubmit={handleSubmitWeek} className="space-y-4">
          {weekDates.map((dateStr) => (
            <div key={dateStr} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
              <div className="mb-2 font-medium text-slate-800">{formatDisplayDate(dateStr)}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-14 text-xs text-slate-500">予定1</span>
                  <select
                    value={weekForm[dateStr] ? weekForm[dateStr].s1 : "09:00"}
                    onChange={(e) => updateDay(dateStr, "s1", e.target.value)}
                    className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                  >
                    {options.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                  <span className="text-slate-400">～</span>
                  <select
                    value={weekForm[dateStr] ? weekForm[dateStr].e1 : "18:00"}
                    onChange={(e) => updateDay(dateStr, "e1", e.target.value)}
                    className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                  >
                    {options.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-14 text-xs text-slate-500">予定2</span>
                  <select
                    value={weekForm[dateStr] ? weekForm[dateStr].s2 : ""}
                    onChange={(e) => updateDay(dateStr, "s2", e.target.value)}
                    className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                  >
                    <option value="">—</option>
                    {options.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                  <span className="text-slate-400">～</span>
                  <select
                    value={weekForm[dateStr] ? weekForm[dateStr].e2 : ""}
                    onChange={(e) => updateDay(dateStr, "e2", e.target.value)}
                    className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                  >
                    <option value="">—</option>
                    {options.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ))}
          <button type="submit" className="w-full rounded-xl bg-slate-700 px-4 py-2.5 font-medium text-white hover:bg-slate-600 sm:w-auto">
            この週を保存
          </button>
        </form>
        <button
          type="button"
          onClick={() => {
            setExceptionMode(!exceptionMode);
            if (exceptionMode) setWeekStart("");
            else setWeekStart(getTargetWeekStart());
          }}
          className="mt-4 text-sm text-slate-500 underline hover:text-slate-700"
        >
          {exceptionMode ? "通常モードに戻る" : "稼働可能日時の登録を忘れた方はこちら"}
        </button>
      </section>

      <section className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200/80">
        <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 sm:px-5 sm:py-4">登録した稼働予定一覧</h2>
        <div className="divide-y divide-slate-100">
          {shifts.length === 0 ? (
            <div className="px-4 py-8 text-center text-slate-500 sm:px-5">まだ稼働予定がありません</div>
          ) : (
            [...shifts]
              .sort((a, b) => b.date.localeCompare(a.date))
              .slice(0, 14)
              .map((s) => (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5 sm:py-4">
                  <div className="text-slate-800">
                    <span className="font-medium">{formatDisplayDate(s.date)}</span>
                    <span className="ml-2 text-sm text-slate-500">
                      {s.startPlanned}～{s.endPlanned}
                      {s.startPlanned2 && s.endPlanned2 ? ` / ${s.startPlanned2}～${s.endPlanned2}` : ""}
                    </span>
                  </div>
                  <div className="text-right font-semibold text-slate-700">{formatDuration(getShiftPlannedMinutes(s))}</div>
                </div>
              ))
          )}
        </div>
      </section>
    </>
  );
}

function KpiTab(props: {
  userId: string;
  kpiRecords: KpiRecord[];
  currentYearMonth: string;
  onSave: (k: KpiRecord[]) => void;
  onRefresh: () => void;
}) {
  const { userId, kpiRecords, currentYearMonth, onSave, onRefresh } = props;
  const today = toDateString(new Date());
  const [kpiDate, setKpiDate] = useState(today);
  const [totalCalls, setTotalCalls] = useState(0);
  const [validCalls, setValidCalls] = useState(0);
  const [kcCount, setKcCount] = useState(0);
  const [followUpCreated, setFollowUpCreated] = useState(0);
  const [decisionMakerApo, setDecisionMakerApo] = useState(0);
  const [nonDecisionMakerApo, setNonDecisionMakerApo] = useState(0);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const existing = getKpiForDate(kpiRecords, kpiDate);
    if (existing) {
      setTotalCalls(existing.totalCalls);
      setValidCalls(existing.validCalls);
      setKcCount(existing.kcCount);
      setFollowUpCreated(existing.followUpCreated);
      setDecisionMakerApo(existing.decisionMakerApo);
      setNonDecisionMakerApo(existing.nonDecisionMakerApo);
    } else {
      setTotalCalls(0);
      setValidCalls(0);
      setKcCount(0);
      setFollowUpCreated(0);
      setDecisionMakerApo(0);
      setNonDecisionMakerApo(0);
    }
    setSaved(false);
  }, [kpiDate, kpiRecords]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const existingRec = getKpiForDate(kpiRecords, kpiDate);
    const rec: KpiRecord = {
      id: existingRec ? existingRec.id : crypto.randomUUID(),
      userId,
      date: kpiDate,
      totalCalls,
      validCalls,
      kcCount,
      followUpCreated,
      decisionMakerApo,
      nonDecisionMakerApo,
    };
    const next = existingRec
      ? kpiRecords.map((r) => (r.date === kpiDate ? rec : r))
      : [rec, ...kpiRecords.filter((r) => r.date !== kpiDate)];
    onSave(next);
    onRefresh();
    setSaved(true);
  };

  const totals = getMonthlyKpiTotals(kpiRecords, currentYearMonth);
  const monthKpiList = getKpiForMonth(kpiRecords, currentYearMonth).sort((a, b) => b.date.localeCompare(a.date));
  const currentKpi = getKpiForDate(kpiRecords, kpiDate);
  const rates = currentKpi ? getKpiRates(currentKpi) : null;
  const prevDate = (() => {
    const d = new Date(kpiDate);
    d.setDate(d.getDate() - 1);
    return toDateString(d);
  })();
  const prevKpi = getKpiForDate(kpiRecords, prevDate);
  const prevRates = prevKpi ? getKpiRates(prevKpi) : null;
  const monthRates =
    totals.totalCalls > 0
      ? {
          validRate: safeRatePercent(totals.validCalls, totals.totalCalls),
          kcRate: safeRatePercent(totals.kcCount, totals.validCalls),
          apoRate: safeRatePercent(totals.decisionMakerApo, totals.kcCount),
        }
      : null;

  return (
    <>
      {currentKpi && rates && (
        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:mb-8 sm:p-6">
          <h2 className="mb-3 text-sm font-medium text-slate-700">生産性カード（{formatDisplayDate(kpiDate)}）</h2>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">有効率</div>
              <div className="text-lg font-bold text-slate-800">{rates.validRate != null ? `${rates.validRate}%` : "—"}</div>
              <div className="text-xs text-slate-500">有効÷総コール</div>
              {prevRates && prevRates.validRate != null && <div className="mt-1 text-xs text-slate-500">前日: {prevRates.validRate}%</div>}
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">KC率</div>
              <div className="text-lg font-bold text-slate-800">{rates.kcRate != null ? `${rates.kcRate}%` : "—"}</div>
              <div className="text-xs text-slate-500">KC÷有効</div>
              {prevRates && prevRates.kcRate != null && <div className="mt-1 text-xs text-slate-500">前日: {prevRates.kcRate}%</div>}
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">アポ率</div>
              <div className="text-lg font-bold text-slate-800">{rates.apoRate != null ? `${rates.apoRate}%` : "—"}</div>
              <div className="text-xs text-slate-500">決裁者アポ÷KC</div>
              {prevRates && prevRates.apoRate != null && <div className="mt-1 text-xs text-slate-500">前日: {prevRates.apoRate}%</div>}
            </div>
          </div>
          {monthRates && (
            <div className="mt-3 border-t border-slate-200 pt-3 text-center text-xs text-slate-500">
              今月平均 有効率 {monthRates.validRate != null ? `${monthRates.validRate}%` : "—"} / KC率 {monthRates.kcRate != null ? `${monthRates.kcRate}%` : "—"} / アポ率 {monthRates.apoRate != null ? `${monthRates.apoRate}%` : "—"}
            </div>
          )}
        </section>
      )}

      <section className="mb-6 rounded-xl bg-slate-800 p-5 text-white shadow-md sm:mb-8 sm:p-6">
        <h2 className="mb-3 text-sm font-medium text-slate-300">今月の累計（{currentYearMonth}）</h2>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <div>総コール数: <span className="font-semibold">{totals.totalCalls}</span></div>
          <div>有効コール数: <span className="font-semibold">{totals.validCalls}</span></div>
          <div>KC数: <span className="font-semibold">{totals.kcCount}</span></div>
          <div>追いかけ作成: <span className="font-semibold">{totals.followUpCreated}</span></div>
          <div>決裁者アポ: <span className="font-semibold">{totals.decisionMakerApo}</span></div>
          <div>非決裁者アポ: <span className="font-semibold">{totals.nonDecisionMakerApo}</span></div>
        </div>
        <p className="mt-2 text-sm text-slate-300">合計アポ数: <span className="font-semibold">{totals.totalApo}</span></p>
      </section>

      <section className="mb-8 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80 sm:p-6">
        <h2 className="mb-4 text-sm font-medium text-slate-700">本日の成果入力</h2>
        <p className="mb-4 text-sm text-slate-600">日付を選び、数値を入力して保存してください。</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-slate-600">日付</label>
            <input
              type="date"
              value={kpiDate}
              onChange={(e) => setKpiDate(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800"
            />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {KPI_LABELS.map(({ key, label }) => (
              <div key={key}>
                <label className="mb-1 block text-sm text-slate-600">{label}</label>
                <input
                  type="number"
                  min={0}
                  value={
                    key === "totalCalls"
                      ? totalCalls
                      : key === "validCalls"
                        ? validCalls
                        : key === "kcCount"
                          ? kcCount
                          : key === "followUpCreated"
                            ? followUpCreated
                            : key === "decisionMakerApo"
                              ? decisionMakerApo
                              : nonDecisionMakerApo
                  }
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10) || 0;
                    if (key === "totalCalls") setTotalCalls(v);
                    else if (key === "validCalls") setValidCalls(v);
                    else if (key === "kcCount") setKcCount(v);
                    else if (key === "followUpCreated") setFollowUpCreated(v);
                    else if (key === "decisionMakerApo") setDecisionMakerApo(v);
                    else setNonDecisionMakerApo(v);
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800"
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" className="rounded-xl bg-slate-700 px-4 py-2.5 font-medium text-white hover:bg-slate-600">
              保存する
            </button>
            {saved && <span className="text-sm text-green-600">保存しました</span>}
          </div>
        </form>
      </section>

      <section className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200/80">
        <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 sm:px-5 sm:py-4">今月のKPI履歴（{currentYearMonth}）</h2>
        <div className="divide-y divide-slate-100">
          {monthKpiList.length === 0 ? (
            <div className="px-4 py-8 text-center text-slate-500 sm:px-5">まだKPIがありません</div>
          ) : (
            monthKpiList.map((k) => (
              <div key={k.id} className="px-4 py-3 sm:px-5 sm:py-4">
                <div className="mb-1 font-medium text-slate-800">{formatDisplayDate(k.date)}</div>
                <div className="text-xs text-slate-600 sm:text-sm">
                  総コール {k.totalCalls} / 有効 {k.validCalls} / KC {k.kcCount} / 追いかけ {k.followUpCreated} / 決裁者アポ {k.decisionMakerApo} / 非決裁者アポ {k.nonDecisionMakerApo}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}

export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<Tab>("home");
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [allRecords, setAllRecords] = useState<WorkRecord[]>([]);
  const [allOpenRecords, setAllOpenRecords] = useState<OpenRecord[]>([]);
  const [allShifts, setAllShifts] = useState<Shift[]>([]);
  const [allKpiRecords, setAllKpiRecords] = useState<KpiRecord[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [loginAccount, setLoginAccount] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [setupName, setSetupName] = useState("");
  const [setupLogin, setSetupLogin] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupHourlyRate, setSetupHourlyRate] = useState(DEFAULT_HOURLY_RATE);

  const refresh = useCallback(async () => {
    try {
      const [records, openRecs, shifts, kpis, mems] = await Promise.all([
        loadRecords(),
        loadOpenRecords(),
        loadShifts(),
        loadKpi(),
        loadMembers(),
      ]);
      setAllRecords(records);
      setAllOpenRecords(openRecs);
      setAllShifts(shifts);
      setAllKpiRecords(kpis);
      setMembers(mems ?? []);
    } catch (e) {
      console.error("refresh", e);
      setLoadError("データの取得に失敗しました。Supabase の設定とテーブルを確認してください。");
    }
  }, []);

  const hydrate = useCallback(async () => {
    setLoadError(null);
    try {
      const mems = await loadMembers();
      if (mems === null) {
        setLoadError("Supabase の設定がありません。.env.local に NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を設定してください。");
        setMembers([]);
        setCurrentUserId(null);
        return;
      }
      setMembers(mems);
      const [records, openRecs, shifts, kpis] = await Promise.all([
        loadRecords(),
        loadOpenRecords(),
        loadShifts(),
        loadKpi(),
      ]);
      setAllRecords(records);
      setAllOpenRecords(openRecs);
      setAllShifts(shifts);
      setAllKpiRecords(kpis);
      const now = new Date();
      setSelectedMonth((prev) => prev || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
      if (mems.length === 0) {
        setShowSetup(true);
        setCurrentUserId(null);
        return;
      }
      setShowSetup(false);
      setCurrentUserId((prev) => {
        if (prev && mems.some((m) => m.id === prev)) return prev;
        return null;
      });
    } catch (err) {
      console.error("hydrate", err);
      setLoadError("Supabase に接続できません。.env.local の NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を確認し、supabase-schema.sql でテーブルを作成してください。");
      setMembers([]);
      setCurrentUserId(null);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) void hydrate();
  }, [mounted, hydrate]);

  const records = isAdminMode ? allRecords : getRecordsForUser(allRecords, currentUserId ?? "");
  const openRecord = getOpenRecordForUser(allOpenRecords, currentUserId ?? "");
  const shifts = isAdminMode ? allShifts : getShiftsForUser(allShifts, currentUserId ?? "");
  const kpiRecords = isAdminMode ? allKpiRecords : getKpiForUser(allKpiRecords, currentUserId ?? "");

  const todayStr = toDateString(new Date());
  const todayMinutes = getTotalMinutesForDate(records, todayStr);
  const currentYearMonth =
    selectedMonth || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const monthRecords = getRecordsForMonth(records, currentYearMonth);
  const monthShifts = shifts.filter((s) => s.date.startsWith(currentYearMonth));
  const monthKpi = getKpiForMonth(kpiRecords, currentYearMonth);
  const totalMinutes = getTotalMinutesForMonth(records, currentYearMonth);
  const isCurrentMonth =
    currentYearMonth === `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const selectableMonths = getSelectableMonths(records, shifts, kpiRecords);

  const handleStart = async () => {
    if (openRecord || !currentUserId) return;
    const now = new Date();
    const rounded = roundUpTo15Minutes(now);
    const newOpen: OpenRecord = {
      id: crypto.randomUUID(),
      userId: currentUserId,
      startRaw: now.toISOString(),
      startRounded: rounded.toISOString(),
      date: toDateString(now),
    };
    await setOpenRecordForUser(currentUserId, newOpen);
    await refresh();
  };

  const handleEnd = async () => {
    if (!openRecord || !currentUserId) return;
    const now = new Date();
    const endRounded = roundDownTo15Minutes(now);
    const startRounded = new Date(openRecord.startRounded);
    const durationMinutes = calcDurationMinutes(startRounded, endRounded);
    const newRecord: WorkRecord = {
      id: openRecord.id,
      userId: currentUserId,
      startRaw: openRecord.startRaw,
      startRounded: openRecord.startRounded,
      endRaw: now.toISOString(),
      endRounded: endRounded.toISOString(),
      durationMinutes,
      date: openRecord.date,
    };
    const userRecords = getRecordsForUser(allRecords, currentUserId);
    const next = [newRecord, ...userRecords];
    await saveRecordsForUser(currentUserId, next);
    await setOpenRecordForUser(currentUserId, null);
    await refresh();
  };

  const handleSaveShifts = async (newShifts: Shift[]) => {
    if (!currentUserId) return;
    await saveShiftsForUser(currentUserId, newShifts);
    await refresh();
  };

  const handleSaveKpi = async (newKpi: KpiRecord[]) => {
    if (!currentUserId) return;
    await saveKpiForUser(currentUserId, newKpi);
    await refresh();
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    const user = await loginUser(loginAccount.trim(), loginPassword);
    if (user) {
      setCurrentUserId(user.id);
      setLoginPassword("");
      if ((user.loginAccount ?? "").toLowerCase() !== "admin") setIsAdminMode(false);
    } else {
      setLoginError("ユーザー名またはパスワードが正しくありません。");
    }
  };

  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupName.trim() || !setupLogin.trim() || !setupPassword) {
      alert("名前・ユーザー名・パスワードを入力してください。");
      return;
    }
    const newMember = await addMember(setupName.trim(), {
      loginAccount: setupLogin.trim(),
      password: setupPassword,
      hourlyRate: setupHourlyRate >= 0 ? setupHourlyRate : DEFAULT_HOURLY_RATE,
    });
    const mems = await loadMembers();
    setMembers(mems ?? []);
    setCurrentUserId(newMember.id);
    setShowSetup(false);
    setSetupName("");
    setSetupLogin("");
    setSetupPassword("");
    setSetupHourlyRate(DEFAULT_HOURLY_RATE);
    await refresh();
  };

  const handleLogout = () => {
    setCurrentUserId(null);
    setLoginAccount("");
    setLoginPassword("");
    setLoginError("");
  };

  const currentMember = members.find((m) => m.id === currentUserId);
  const isAdminUser = (currentMember?.loginAccount ?? "").toLowerCase() === "admin";

  if (!mounted) {
    return (
      <div
        style={{
          minHeight: "100vh",
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#94a3b8",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <p style={{ fontSize: "1.25rem", fontWeight: 700, color: "#0f172a", margin: 0 }}>読み込み中...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 max-w-md text-center">
          <h1 className="text-lg font-semibold text-amber-800 mb-2">接続エラー</h1>
          <p className="text-sm text-slate-700 mb-4">{loadError}</p>
          <p className="text-xs text-slate-500 mb-4">
            プロジェクトの <code className="bg-slate-200 px-1 rounded">supabase-schema.sql</code> を Supabase の SQL Editor で実行するとテーブルが作成されます。
          </p>
          <button type="button" onClick={() => void hydrate()} className="rounded bg-slate-700 px-4 py-2 text-sm text-white hover:bg-slate-600">
            再試行
          </button>
        </div>
      </div>
    );
  }

  if (showSetup) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-md">
          <h1 className="text-xl font-semibold text-slate-800 mb-1">初回セットアップ</h1>
          <p className="text-sm text-slate-500 mb-6">最初のユーザー（管理者）を登録してください。このアカウントでログインし、メンバーを追加できます。</p>
          <form onSubmit={handleSetupSubmit} className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-600">名前</label>
              <input type="text" value={setupName} onChange={(e) => setSetupName(e.target.value)} placeholder="表示名" className="rounded border border-slate-300 px-3 py-2 text-sm" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-600">ユーザー名（ログインID）</label>
              <input type="text" value={setupLogin} onChange={(e) => setSetupLogin(e.target.value)} placeholder="ログイン時に使用" className="rounded border border-slate-300 px-3 py-2 text-sm" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-600">パスワード</label>
              <input type="password" value={setupPassword} onChange={(e) => setSetupPassword(e.target.value)} placeholder="パスワード" className="rounded border border-slate-300 px-3 py-2 text-sm" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-600">委託料単価（/h・円）</label>
              <input type="number" min={0} value={setupHourlyRate} onChange={(e) => setSetupHourlyRate(parseInt(e.target.value, 10) || 0)} className="rounded border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <button type="submit" className="w-full rounded bg-slate-700 py-2.5 text-sm font-medium text-white hover:bg-slate-600">登録してログイン</button>
          </form>
        </div>
      </div>
    );
  }

  if (currentUserId === null) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-md">
          <h1 className="text-xl font-semibold text-slate-800 mb-1">ログイン</h1>
          <p className="text-sm text-slate-500 mb-6">ユーザー名とパスワードを入力してください。</p>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-600">ユーザー名</label>
              <input type="text" value={loginAccount} onChange={(e) => setLoginAccount(e.target.value)} placeholder="ユーザー名" className="rounded border border-slate-300 px-3 py-2 text-sm" autoComplete="username" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-600">パスワード</label>
              <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="パスワード" className="rounded border border-slate-300 px-3 py-2 text-sm" autoComplete="current-password" />
            </div>
            {loginError && <p className="text-sm text-red-600">{loginError}</p>}
            <button type="submit" className="w-full rounded bg-slate-700 py-2.5 text-sm font-medium text-white hover:bg-slate-600">ログイン</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100" style={{ minHeight: "100vh", backgroundColor: "#f1f5f9" }}>
      <header className="bg-slate-800 text-white shadow-md" style={{ backgroundColor: "#1e293b" }}>
        <div className="mx-auto max-w-2xl px-4 py-4 sm:px-6">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {isAdminMode ? "業務進捗・活動報告（管理者）" : `業務進捗・活動報告${currentMember ? ` - ${currentMember.name}` : ""}`}
          </h1>
        </div>
      </header>

      {!isAdminMode && (
        <div className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-2xl gap-0">
            <button
              type="button"
              onClick={() => setTab("home")}
              className={`flex-1 px-3 py-3 text-sm font-medium transition sm:px-4 ${tab === "home" ? "border-b-2 border-slate-700 text-slate-800" : "text-slate-500 hover:text-slate-700"}`}
            >
              活動記録
            </button>
            <button
              type="button"
              onClick={() => setTab("shift")}
              className={`flex-1 px-3 py-3 text-sm font-medium transition sm:px-4 ${tab === "shift" ? "border-b-2 border-slate-700 text-slate-800" : "text-slate-500 hover:text-slate-700"}`}
            >
              稼働予定
            </button>
            <button
              type="button"
              onClick={() => setTab("kpi")}
              className={`flex-1 px-3 py-3 text-sm font-medium transition sm:px-4 ${tab === "kpi" ? "border-b-2 border-slate-700 text-slate-800" : "text-slate-500 hover:text-slate-700"}`}
            >
              KPI入力
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
        {isAdminMode && isAdminUser ? (
          <AdminDashboard
            allRecords={allRecords}
            allOpenRecords={allOpenRecords}
            allShifts={allShifts}
            allKpiRecords={allKpiRecords}
            members={members}
            setMembers={setMembers}
            onRefresh={refresh}
          />
        ) : tab === "home" ? (
          <>
            <section className="mb-6 rounded-xl bg-slate-800 p-6 text-white shadow-md sm:mb-8">
              <h2 className="mb-1 text-sm font-medium text-slate-300">当日の活動時間</h2>
              <p className="text-3xl font-bold sm:text-4xl">{formatDuration(todayMinutes)}</p>
            </section>

            <section className="mb-6 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80 sm:mb-8 sm:p-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-slate-600">{isCurrentMonth ? "今月の活動時間" : "選択月の活動時間"}</h2>
                <select
                  value={currentYearMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500/20"
                >
                  {selectableMonths.map((ym) => {
                    const [y, m] = ym.split("-");
                    const label =
                      ym === `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}` ? `${y}年${m}月（今月）` : `${y}年${m}月`;
                    return (
                      <option key={ym} value={ym}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>
              <p className="text-2xl font-bold text-slate-800 sm:text-3xl">{formatDuration(totalMinutes)}</p>
            </section>

            <section className="mb-6 sm:mb-8">
              <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={!!openRecord}
                  className="flex-1 rounded-xl bg-slate-700 px-6 py-4 text-base font-semibold text-white shadow-md transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50 sm:py-5 sm:text-lg"
                >
                  業務開始
                </button>
                <button
                  type="button"
                  onClick={handleEnd}
                  disabled={!openRecord}
                  className="flex-1 rounded-xl bg-slate-600 px-6 py-4 text-base font-semibold text-white shadow-md transition hover:bg-slate-500 disabled:cursor-not-allowed disabled:opacity-50 sm:py-5 sm:text-lg"
                >
                  業務終了
                </button>
              </div>
              {openRecord && (
                <p className="mt-3 text-center text-sm text-slate-600">活動中（開始: {formatTime(openRecord.startRounded)}）</p>
              )}
            </section>

            <HistorySection
              monthRecords={monthRecords}
              monthShifts={monthShifts}
              monthKpi={monthKpi}
              currentYearMonth={currentYearMonth}
              isCurrentMonth={isCurrentMonth}
            />
          </>
        ) : tab === "shift" ? (
          <ShiftTab userId={currentUserId} shifts={shifts} onSave={handleSaveShifts} onRefresh={refresh} />
        ) : (
          <KpiTab userId={currentUserId} kpiRecords={kpiRecords} currentYearMonth={currentYearMonth} onSave={handleSaveKpi} onRefresh={refresh} />
        )}
      </main>

      <div className="fixed bottom-4 right-4 z-10 flex flex-col gap-2 rounded-xl border border-slate-300 bg-white p-3 shadow-lg">
        {isAdminUser ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-600">{isAdminMode ? "管理者（Admin）" : "一般メンバー"}</span>
            <button
              type="button"
              onClick={() => setIsAdminMode(!isAdminMode)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${isAdminMode ? "bg-slate-700" : "bg-slate-300"}`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${isAdminMode ? "translate-x-5" : "translate-x-1"}`} />
            </button>
          </div>
        ) : (
          <p className="text-xs text-slate-500">{currentMember?.name ?? ""}</p>
        )}
        <button type="button" onClick={handleLogout} className="rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
          ログアウト
        </button>
      </div>
    </div>
  );
}
