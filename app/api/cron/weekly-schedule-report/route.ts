/**
 * 毎週土曜 00:00 JST 想定: 翌週（月〜日）の稼働予定を CSV で Slack 通知。
 * - vercel.json: `0 15 * * 5`（金曜 15:00 UTC ＝土曜 00:00 JST）
 * - 認証: `Authorization: Bearer ${CRON_SECRET}`
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-verify";
import { exportScheduleToCsvString, getNextWeekRangeInclusive, getTodayJstDateString } from "@/lib/export-schedule";
import { loadMembers, loadShiftsInDateRange } from "@/lib/supabase-data";
import type { Member } from "@/lib/attendance";
import {
  postSlackIncomingWebhook,
  resolveSlackWebhookUrl,
  slackSendFailureHttpStatus,
  slackWebhookMissingMessage,
} from "@/lib/slack-webhook";

function contractorMembers(members: Member[]): Member[] {
  return members.filter(
    (m) => m.isActive !== false && (m.loginAccount ?? "").toLowerCase() !== "admin"
  );
}

const SLACK_TEXT_BUDGET = 38_000;

async function postWeeklyScheduleToSlack(
  csv: string,
  start: string,
  end: string
): Promise<{ ok: true } | { ok: false; error: string; detail?: string }> {
  const webhookUrl = resolveSlackWebhookUrl("weekly_schedule");
  if (!webhookUrl) {
    return { ok: false, error: "Slack webhook is not configured", detail: slackWebhookMissingMessage("weekly_schedule") };
  }
  const intro =
    "来週の稼働予定レポートです。このCSVをLINEの業務委託グループへ共有してください。";
  const periodLine = `集計期間: ${start} ～ ${end}（月〜日）`;
  let bodyCsv = csv;
  let suffix = "";
  const wrapperLen = intro.length + periodLine.length + 32;
  if (wrapperLen + csv.length > SLACK_TEXT_BUDGET) {
    bodyCsv = `${csv.slice(0, Math.max(0, SLACK_TEXT_BUDGET - wrapperLen - 80))}\n...（省略）`;
    suffix = "\n\n※本文が長いため一部省略しました。管理画面の「稼働予定管理」から CSV をダウンロードできます。";
  }
  const text = `${intro}\n\n${periodLine}\n\n\`\`\`csv\n${bodyCsv}\n\`\`\`${suffix}`;
  const posted = await postSlackIncomingWebhook(webhookUrl, { text });
  if (!posted.ok) {
    return { ok: false, error: posted.error, detail: posted.detail };
  }
  return { ok: true };
}

async function runReport(anchorJstYmd: string): Promise<NextResponse> {
  const { start, end } = getNextWeekRangeInclusive(anchorJstYmd);
  const members = await loadMembers();
  if (members === null) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
  }
  const mems = contractorMembers(members);
  const shifts = await loadShiftsInDateRange(start, end);
  const csv = exportScheduleToCsvString(start, end, shifts, mems);
  const slack = await postWeeklyScheduleToSlack(csv, start, end);
  if (!slack.ok) {
    return NextResponse.json(
      { ok: false, error: slack.error, detail: slack.detail },
      { status: slackSendFailureHttpStatus(slack.error) }
    );
  }
  return NextResponse.json({
    ok: true,
    start,
    end,
    memberCount: mems.length,
    lineCount: csv.split("\n").length,
  });
}

export async function GET(request: NextRequest) {
  const denied = verifyCronSecret(request);
  if (denied) return denied;
  return runReport(getTodayJstDateString());
}

export async function POST(request: NextRequest) {
  const denied = verifyCronSecret(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const anchor =
    typeof body?.anchorDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.anchorDate)
      ? body.anchorDate
      : getTodayJstDateString();
  return runReport(anchor);
}
