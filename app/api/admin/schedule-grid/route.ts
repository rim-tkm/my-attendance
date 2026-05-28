import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { mergeShiftsAndKpisByUserDate, scheduleGridEntriesFromMerged } from "@/lib/attendance";
import { loadShiftsAndKpiForDateRange } from "@/lib/supabase-data";

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 管理用: 期間内の shifts と kpis を取得し、同一 userId+date で結合した entries も返す。
 * GET ?start=YYYY-MM-DD&end=YYYY-MM-DD
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !isAdmin(session)) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start") ?? "";
  const end = searchParams.get("end") ?? "";
  if (!YMD_RE.test(start) || !YMD_RE.test(end)) {
    return NextResponse.json({ error: "start と end は YYYY-MM-DD で指定してください" }, { status: 400 });
  }

  const { shifts, kpis } = await loadShiftsAndKpiForDateRange(start, end);
  const merged = mergeShiftsAndKpisByUserDate(shifts, kpis);
  const entries = scheduleGridEntriesFromMerged(merged);

  return NextResponse.json({ shifts, kpis, entries });
}
