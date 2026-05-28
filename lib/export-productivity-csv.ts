import type { KpiRecord, Member, WorkRecord } from "@/lib/attendance";
import {
  aggregateUserWorkDaySpan,
  calcMonthlyPay,
  decisionMakerApoUnitYenFromPay,
  DEFAULT_HOURLY_RATE,
  formatDuration,
  getDateStringsInclusive,
  getKpiForDate,
  getKpiRates,
  getKpiTotalsFromRecords,
  getKpiForUser,
  getRecordsForUser,
  kpiRecordHasOperationalMetrics,
  safeRatePercent,
} from "@/lib/attendance";
import { normalizeRoiRange } from "@/lib/roi-analysis";

const UTF8_BOM = "\uFEFF";

function isoToJstHhmm(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "0";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "0";
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

/** 一覧表示に合わせた請求管理番号（3桁）※未設定は空 */
export function invoiceNumberForCsvDisplay(invoiceNumber: string | null | undefined): string {
  const raw = String(invoiceNumber ?? "").replace(/\D/g, "");
  if (!raw) return "";
  return raw.slice(-3).padStart(3, "0");
}

function csvEscapeCell(cell: string | number): string {
  const s = typeof cell === "number" ? (Number.isFinite(cell) ? String(cell) : "") : cell;
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildCsvLinesFromRows(rows: string[][]): string {
  return rows.map((row) => row.map(csvEscapeCell).join(",")).join("\r\n");
}

/** BOM 付き UTF-8（Excel で日本語を開きやすい） */
export function buildBomUtf8CsvContent(rows: string[][]): string {
  return UTF8_BOM + buildCsvLinesFromRows(rows);
}

/** 画面上の safeRatePercent と同じ値を、CSV では小数第2位まで（末尾 0 埋め） */
function formatRatePercentFromSafe(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return "";
  return rate.toFixed(2);
}

/** 比率（0〜1）をパーセント文字列に（分母0は空）— ユーザー指定の派生率用 */
function formatPercentFromRatio(num: number, denom: number): string {
  if (!Number.isFinite(num) || !Number.isFinite(denom) || denom === 0) return "";
  return ((num / denom) * 100).toFixed(2);
}

/** 生産性（有効コール／h）— 分単位の稼働時間ベース、小数第2位 */
function productivityValidCallsPerHour(validCalls: number, workMinutes: number): string {
  if (!Number.isFinite(validCalls) || validCalls <= 0) return "";
  const h = workMinutes / 60;
  if (!Number.isFinite(h) || h <= 0) return "";
  return (validCalls / h).toFixed(2);
}

/**
 * 業務委託KPI テーブル・getKpiRates と同じ定義の率（有効率・KC率・アポ率）
 */
function kpiRatesForCsv(k: KpiRecord): {
  validRate: string;
  kcRate: string;
  apoRateScreen: string;
} {
  const r = getKpiRates(k);
  return {
    validRate: formatRatePercentFromSafe(r.validRate),
    kcRate: formatRatePercentFromSafe(r.kcRate),
    apoRateScreen: formatRatePercentFromSafe(r.apoRate),
  };
}

const DAILY_HEADERS = [
  "日付",
  "請求管理番号",
  "氏名",
  "稼働開始時間",
  "稼働終了時間",
  "休憩時間（分）",
  "実稼働時間（分）",
  "実稼働時間（時間表記）",
  "合計委託料（円）",
  "総コール数",
  "有効コール数",
  "KC数",
  "追いかけ作成数",
  "決裁者アポ数",
  "非決裁者アポ数",
  "アポ数（決裁+非決裁）",
  "有効率（％）",
  "KC率（％）",
  "アポ率_決裁者アポ除以KC（％）",
  "アポ率_アポ合計除以有効コール（％）",
  "決アポ率_決裁者アポ除以有効コール（％）",
  "決アポ単価（円）",
  "生産性_有効コール毎時（件／h）",
] as const;

const SUMMARY_HEADERS = [
  "請求管理番号",
  "氏名",
  "期間内実稼働合計（分）",
  "期間内実稼働（時間表記）",
  "合計委託料（円）",
  "総コール数",
  "有効コール数",
  "KC数",
  "追いかけ作成数",
  "決裁者アポ数",
  "非決裁者アポ数",
  "アポ数（決裁+非決裁）",
  "有効率（％）",
  "KC率（％）",
  "アポ率_決裁者アポ除以KC（％）",
  "アポ率_アポ合計除以有効コール（％）",
  "決アポ率_決裁者アポ除以有効コール（％）",
  "決アポ単価（円）",
  "生産性_有効コール毎時（件／h）",
] as const;

function emptyKpiCounts() {
  return {
    totalCalls: 0,
    validCalls: 0,
    kcCount: 0,
    followUpCreated: 0,
    decisionMakerApo: 0,
    nonDecisionMakerApo: 0,
    totalApo: 0,
  };
}

/**
 * 日次明細：指定期間・メンバーごとに、稼働または KPI がある日のみ1行。
 * KPI 列・率は業務委託KPI パネル（getKpiRates / safeRatePercent）と同一式。
 */
export function buildProductivityDailyCsvRows(
  members: Member[],
  allRecords: WorkRecord[],
  allKpiRecords: KpiRecord[],
  rangeStart: string,
  rangeEnd: string
): string[][] {
  const { start, end } = normalizeRoiRange(rangeStart, rangeEnd);
  const dates = getDateStringsInclusive(start, end);
  const out: string[][] = [Array.from(DAILY_HEADERS)];

  for (const m of members) {
    const rate = m.hourlyRate != null && m.hourlyRate >= 0 ? m.hourlyRate : DEFAULT_HOURLY_RATE;
    const inv = invoiceNumberForCsvDisplay(m.invoiceNumber);
    const userKpi = getKpiForUser(allKpiRecords, m.id);

    for (const dateStr of dates) {
      const span = aggregateUserWorkDaySpan(allRecords, m.id, dateStr);
      const kpi = getKpiForDate(userKpi, dateStr);
      const hasWork = span != null;
      const hasKpi = kpi != null && kpiRecordHasOperationalMetrics(kpi);
      if (!hasWork && !hasKpi) continue;

      const workMin = span?.totalWorkMinutes ?? 0;
      const startH = span ? isoToJstHhmm(span.earliestStartIso) : "";
      const endH = span ? isoToJstHhmm(span.latestEndIso) : "";
      const breakMin = span ? String(span.breakOrGapMinutes) : "";
      const durationLabel = formatDuration(workMin);
      const pay = calcMonthlyPay(workMin, rate);

      const c = kpi
        ? {
            totalCalls: kpi.totalCalls,
            validCalls: kpi.validCalls,
            kcCount: kpi.kcCount,
            followUpCreated: kpi.followUpCreated,
            decisionMakerApo: kpi.decisionMakerApo,
            nonDecisionMakerApo: kpi.nonDecisionMakerApo,
            totalApo: kpi.decisionMakerApo + kpi.nonDecisionMakerApo,
          }
        : emptyKpiCounts();

      const ratesFromKpi = kpi ? kpiRatesForCsv(kpi) : { validRate: "", kcRate: "", apoRateScreen: "" };
      const apoOverValid = formatPercentFromRatio(c.totalApo, c.validCalls);
      const decisionApoOverValid = formatPercentFromRatio(c.decisionMakerApo, c.validCalls);

      const unitYen = decisionMakerApoUnitYenFromPay(pay, c.decisionMakerApo);
      const unitStr = unitYen != null && Number.isFinite(unitYen) ? String(Math.round(unitYen)) : "";

      const prod = productivityValidCallsPerHour(c.validCalls, workMin);

      out.push([
        dateStr,
        inv,
        m.name,
        startH,
        endH,
        breakMin,
        String(workMin),
        durationLabel,
        String(pay),
        String(c.totalCalls),
        String(c.validCalls),
        String(c.kcCount),
        String(c.followUpCreated),
        String(c.decisionMakerApo),
        String(c.nonDecisionMakerApo),
        String(c.totalApo),
        ratesFromKpi.validRate,
        ratesFromKpi.kcRate,
        ratesFromKpi.apoRateScreen,
        apoOverValid,
        decisionApoOverValid,
        unitStr,
        prod,
      ]);
    }
  }

  return out;
}

/**
 * メンバー別集計：期間内を合算。率は getKpiTotalsFromRecords の合計に対して safeRatePercent（カスタム集計ブロックと同じ）
 */
export function buildProductivityMemberSummaryCsvRows(
  members: Member[],
  allRecords: WorkRecord[],
  allKpiRecords: KpiRecord[],
  rangeStart: string,
  rangeEnd: string
): string[][] {
  const { start, end } = normalizeRoiRange(rangeStart, rangeEnd);
  const out: string[][] = [Array.from(SUMMARY_HEADERS)];

  for (const m of members) {
    const rate = m.hourlyRate != null && m.hourlyRate >= 0 ? m.hourlyRate : DEFAULT_HOURLY_RATE;
    const inv = invoiceNumberForCsvDisplay(m.invoiceNumber);

    const totalMin = getRecordsForUser(allRecords, m.id)
      .filter((r) => r.date >= start && r.date <= end)
      .reduce((s, r) => s + r.durationMinutes, 0);

    const userKpis = getKpiForUser(allKpiRecords, m.id).filter((k) => k.date >= start && k.date <= end);
    const t = getKpiTotalsFromRecords(userKpis);

    const pay = calcMonthlyPay(totalMin, rate);

    const validRate = formatRatePercentFromSafe(safeRatePercent(t.validCalls, t.totalCalls));
    const kcRate = formatRatePercentFromSafe(safeRatePercent(t.kcCount, t.validCalls));
    const apoRateScreen = formatRatePercentFromSafe(safeRatePercent(t.decisionMakerApo, t.kcCount));
    const apoOverValid = formatPercentFromRatio(t.totalApo, t.validCalls);
    const decisionApoOverValid = formatPercentFromRatio(t.decisionMakerApo, t.validCalls);

    const unitYen = decisionMakerApoUnitYenFromPay(pay, t.decisionMakerApo);
    const unitStr = unitYen != null && Number.isFinite(unitYen) ? String(Math.round(unitYen)) : "";

    const prod = productivityValidCallsPerHour(t.validCalls, totalMin);

    out.push([
      inv,
      m.name,
      String(totalMin),
      formatDuration(totalMin),
      String(pay),
      String(t.totalCalls),
      String(t.validCalls),
      String(t.kcCount),
      String(t.followUpCreated),
      String(t.decisionMakerApo),
      String(t.nonDecisionMakerApo),
      String(t.totalApo),
      validRate,
      kcRate,
      apoRateScreen,
      apoOverValid,
      decisionApoOverValid,
      unitStr,
      prod,
    ]);
  }

  return out;
}
