import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getRecords, saveRecords } from "@/lib/store";
import type { WorkRecord } from "@/lib/attendance";
import { isWeekendYmdJst, JST_WEEKEND_WORK_REJECTED_MESSAGE } from "@/lib/export-schedule";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const records = getRecords(session.user.id);
  return NextResponse.json(records);
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json();
  const records = body as WorkRecord[];
  if (!Array.isArray(records)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  for (const r of records) {
    if (r?.date && isWeekendYmdJst(String(r.date))) {
      return NextResponse.json({ error: JST_WEEKEND_WORK_REJECTED_MESSAGE }, { status: 403 });
    }
  }
  saveRecords(session.user.id, records);
  return NextResponse.json({ ok: true });
}
