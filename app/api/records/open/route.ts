import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getOpenRecord, saveOpenRecord } from "@/lib/store";
import type { OpenRecord } from "@/lib/attendance";
import { isWeekendYmdJst, JST_WEEKEND_WORK_REJECTED_MESSAGE } from "@/lib/export-schedule";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const open = getOpenRecord(session.user.id);
  return NextResponse.json(open ?? null);
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json();
  if (body === null) {
    saveOpenRecord(session.user.id, null);
    return NextResponse.json({ ok: true });
  }
  const open = body as OpenRecord;
  if (!open?.id || !open?.startRaw || !open?.startRounded || !open?.date) {
    return NextResponse.json({ error: "Invalid open record" }, { status: 400 });
  }
  if (isWeekendYmdJst(String(open.date))) {
    return NextResponse.json({ error: JST_WEEKEND_WORK_REJECTED_MESSAGE }, { status: 403 });
  }
  saveOpenRecord(session.user.id, open);
  return NextResponse.json({ ok: true });
}
