import type { Member } from "@/lib/attendance";
import { postSlackIncomingWebhook, resolveSlackWebhookUrl, slackWebhookMissingMessage } from "@/lib/slack-webhook";
import { normalizeRoiRange } from "@/lib/roi-analysis";
import {
  buildMemberRankingEntries,
  formatSlackMemberRankingDetails,
  loadSupabaseRoiSourceForRange,
  type MemberRankingEntry,
} from "@/lib/slack-ranking";

function formatPeriodLineJa(start: string, end: string): string {
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me, de] = end.split("-").map(Number);
  const a = new Date(ys, ms - 1, ds).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
  const b = new Date(ye, me - 1, de).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
  return `${a} 〜 ${b}`;
}

/** 画面のメンバー絞り込みをサーバー側で再現（業務委託のみ・admin 除外後に ID フィルタ） */
export function filterMembersForManualReport(allMembers: Member[], memberIds: string[] | null): Member[] {
  const contractors = allMembers.filter(
    (m) => m.isActive !== false && (m.loginAccount ?? "").toLowerCase() !== "admin"
  );
  if (memberIds == null) {
    return contractors;
  }
  const allowed = new Set(memberIds);
  return contractors.filter((m) => allowed.has(m.id));
}

function formatManualPeriodRoiSlackMessage(periodJa: string, entries: MemberRankingEntry[]): string {
  const header = ["【期間指定・業務委託ROIレポート】", `期間: ${periodJa}`, ""].join("\n");
  return header + formatSlackMemberRankingDetails(entries);
}

export type SlackManualReportResult =
  | { ok: true; start: string; end: string }
  | { ok: false; error: string; detail?: string };

export async function sendSlackManualRoiReport(
  startDate: string,
  endDate: string,
  memberIds: string[] | null
): Promise<SlackManualReportResult> {
  const webhookUrl = resolveSlackWebhookUrl("manual_report");
  if (!webhookUrl) {
    return { ok: false, error: "Slack webhook is not configured", detail: slackWebhookMissingMessage("manual_report") };
  }

  const { start, end } = normalizeRoiRange(startDate, endDate);
  const loaded = await loadSupabaseRoiSourceForRange(start, end);
  if (!loaded.ok) {
    return { ok: false, error: loaded.error };
  }

  const members = filterMembersForManualReport(loaded.members, memberIds);
  const entries = buildMemberRankingEntries(start, end, loaded.kpis, loaded.records, members);
  const text = formatManualPeriodRoiSlackMessage(formatPeriodLineJa(start, end), entries);

  const posted = await postSlackIncomingWebhook(webhookUrl, { text });
  if (!posted.ok) {
    return { ok: false, error: posted.error, detail: posted.detail };
  }

  return { ok: true, start, end };
}
