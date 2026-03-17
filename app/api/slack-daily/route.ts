import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

const SLACK_ENTRY_NONE = "なし";

/** 日本時間で「今日」の YYYY-MM-DD を返す */
function getTodayJst(): string {
  const now = new Date();
  const jst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const y = jst.getFullYear();
  const m = String(jst.getMonth() + 1).padStart(2, "0");
  const d = String(jst.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 稼働予定が「なし」でないか */
function hasRealSchedule(
  startPlanned: string | null | undefined,
  endPlanned: string | null | undefined
): boolean {
  const s = (startPlanned ?? "").trim();
  const e = (endPlanned ?? "").trim();
  return s !== "" && s !== SLACK_ENTRY_NONE && e !== "" && e !== SLACK_ENTRY_NONE;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runSlackDaily(getTodayJst());
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const dateOverride = typeof body?.date === "string" ? body.date : null;
  const targetDate = dateOverride ?? getTodayJst();
  return runSlackDaily(targetDate);
}

async function runSlackDaily(dateStr: string): Promise<NextResponse> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json(
      { error: "SLACK_WEBHOOK_URL is not set", ok: false },
      { status: 500 }
    );
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured", ok: false },
      { status: 500 }
    );
  }

  const { data: shiftRows } = await supabase
    .from("shifts")
    .select("id, user_id, date, start_planned, end_planned, start_planned2, end_planned2")
    .eq("date", dateStr);

  const { data: userRows } = await supabase
    .from("users")
    .select("id, name, is_active")
    .eq("is_active", true);

  const users = new Map((userRows ?? []).map((u) => [u.id, u]));
  const shifts = (shiftRows ?? []).filter(
    (s) =>
      hasRealSchedule(s.start_planned, s.end_planned) ||
      hasRealSchedule(s.start_planned2, s.end_planned2)
  );

  const byUser = new Map<string, { name: string; slots: string[] }>();
  for (const s of shifts) {
    const u = users.get(s.user_id);
    if (!u?.name) continue;
    const slots: string[] = [];
    if (hasRealSchedule(s.start_planned, s.end_planned)) {
      slots.push(`${(s.start_planned ?? "").trim()} - ${(s.end_planned ?? "").trim()}`);
    }
    if (hasRealSchedule(s.start_planned2, s.end_planned2)) {
      slots.push(`${(s.start_planned2 ?? "").trim()} - ${(s.end_planned2 ?? "").trim()}`);
    }
    if (slots.length > 0) {
      const existing = byUser.get(s.user_id);
      if (existing) {
        existing.slots.push(...slots);
      } else {
        byUser.set(s.user_id, { name: u.name, slots });
      }
    }
  }

  const dateLabel = (() => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const d2 = new Date(y, m - 1, d);
    return d2.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
  })();

  let text: string;
  if (byUser.size === 0) {
    text = `📢 本日の稼働予定（${dateLabel}）
----------------------------
本日の稼働予定メンバーはいません
----------------------------
※活動記録（業務開始）の報告を忘れずにお願いします。`;
  } else {
    const lines = Array.from(byUser.entries()).map(([, v]) => {
      const timeStr = v.slots.join(" / ");
      return `・${v.name} 様（${timeStr}）`;
    });
    text = `📢 本日の稼働予定（${dateLabel}）
----------------------------
${lines.join("\n")}
----------------------------
※活動記録（業務開始）の報告を忘れずにお願いします。`;
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json(
      { error: "Slack webhook failed", detail: err, ok: false },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, date: dateStr });
}
