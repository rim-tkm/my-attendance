import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getTodayJstDateString } from "@/lib/export-schedule";
import {
  estimateNakanoYen,
  nakanoCacheHitRate,
  readNakanoDailyYenAlert,
  readNakanoPricing,
} from "@/lib/nakano-cost";
import { loadNakanoDailyUsage, loadNakanoUsageForMonth } from "@/lib/nakano-data";

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 日別に見せる日数。1週間あれば増え方の傾向は読める */
const DAILY_DAYS = 7;

/** 当月の使用状況と概算費用（管理者のみ） */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ ok: false, error: "管理者のみ利用できます" }, { status: 403 });
  }

  // サーバーのタイムゾーンに引きずられないよう、当月は JST の「今日」から切り出す。
  const month = (new URL(req.url).searchParams.get("month") ?? "").trim() || getTodayJstDateString().slice(0, 7);
  if (!MONTH_PATTERN.test(month)) {
    return NextResponse.json({ ok: false, error: "月の指定が不正です（YYYY-MM）" }, { status: 400 });
  }

  const pricing = readNakanoPricing();

  try {
    // 月合計だけだと「今日いくら使ったか」が分からず、1日あたりの上限で運用できない。
    // 日別も一緒に返して、画面で今日の費用と直近の増え方を見られるようにする。
    const [usage, daily] = await Promise.all([
      loadNakanoUsageForMonth(month),
      loadNakanoDailyUsage(DAILY_DAYS),
    ]);
    const estimatedYen = Math.round(estimateNakanoYen(usage, pricing));
    return NextResponse.json({
      ok: true,
      usage,
      estimatedYen,
      dailyAlertYen: readNakanoDailyYenAlert(),
      daily: daily.map((d) => ({
        date: d.date,
        aiQuestionCount: d.aiQuestionCount,
        stepUseCount: d.stepUseCount,
        yen: Math.round(estimateNakanoYen(d, pricing)),
        cacheHitRate: nakanoCacheHitRate(d),
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
