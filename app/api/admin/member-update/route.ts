import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { validateQualifiedInvoiceRegistrationNumber } from "@/lib/invoice-registration-number";
import { getSupabase } from "@/lib/supabase";
import { updateMemberOrThrow, type MemberUpdatePayload } from "@/lib/supabase-data";
import { resolveAppBaseUrlFromEnv } from "@/lib/app-base-url";
import { notifyFirstWorkDateSetSlack } from "@/lib/slack-first-work-date";

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function coerceMemberUpdates(raw: Record<string, unknown>): MemberUpdatePayload {
  const out: MemberUpdatePayload = {};
  if (typeof raw.name === "string") out.name = raw.name;
  if (typeof raw.loginAccount === "string") out.loginAccount = raw.loginAccount;
  if (typeof raw.password === "string" && raw.password !== "") out.password = raw.password;
  if (typeof raw.hourlyRate === "number" && Number.isFinite(raw.hourlyRate)) out.hourlyRate = raw.hourlyRate;
  if (typeof raw.postalCode === "string") out.postalCode = raw.postalCode;
  if (typeof raw.address === "string") out.address = raw.address;
  if (typeof raw.bankName === "string") out.bankName = raw.bankName;
  if (typeof raw.branchName === "string") out.branchName = raw.branchName;
  if (typeof raw.accountType === "string") out.accountType = raw.accountType;
  if (typeof raw.accountNumber === "string") out.accountNumber = raw.accountNumber;
  if (typeof raw.accountHolder === "string") out.accountHolder = raw.accountHolder;
  if (typeof raw.invoiceNumber === "string") out.invoiceNumber = raw.invoiceNumber;
  if (typeof raw.invoiceRegistrationNumber === "string") {
    out.invoiceRegistrationNumber = raw.invoiceRegistrationNumber;
  }
  if (typeof raw.phoneNumber === "string") out.phoneNumber = raw.phoneNumber;
  if (typeof raw.slackId === "string") out.slackId = raw.slackId;
  if (typeof raw.isActive === "boolean") out.isActive = raw.isActive;
  if ("firstWorkDate" in raw) {
    if (raw.firstWorkDate === null || raw.firstWorkDate === undefined) out.firstWorkDate = null;
    else if (typeof raw.firstWorkDate === "string") out.firstWorkDate = raw.firstWorkDate;
  }
  if (typeof raw.canWorkMorning === "boolean") out.canWorkMorning = raw.canWorkMorning;
  if (typeof raw.isIntern === "boolean") out.isIntern = raw.isIntern;
  if (typeof raw.internRateDecisionMakerApps === "number" && Number.isFinite(raw.internRateDecisionMakerApps)) {
    out.internRateDecisionMakerApps = raw.internRateDecisionMakerApps;
  }
  if (typeof raw.internRateNonDecisionMakerApps === "number" && Number.isFinite(raw.internRateNonDecisionMakerApps)) {
    out.internRateNonDecisionMakerApps = raw.internRateNonDecisionMakerApps;
  }
  return out;
}

function resolveAppBaseUrl(o: Record<string, unknown>): string {
  const fromBody = typeof o.appBaseUrl === "string" ? o.appBaseUrl.trim().replace(/\/$/, "") : "";
  if (fromBody) return fromBody;
  return resolveAppBaseUrlFromEnv();
}

/** 管理画面からのメンバー更新。初回稼働日が新規設定されたときだけ Slack（SLACK_WEBHOOK_URL） */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "ログインしてください" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "管理者のみ利用できます" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "不正な JSON です" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });
  }
  const o = body as Record<string, unknown>;
  const memberId = typeof o.memberId === "string" ? o.memberId.trim() : "";
  if (!memberId || !UUID_RE.test(memberId)) {
    return NextResponse.json({ error: "memberId が不正です" }, { status: 400 });
  }
  const rawUpdates = o.updates;
  if (!rawUpdates || typeof rawUpdates !== "object") {
    return NextResponse.json({ error: "updates が必要です" }, { status: 400 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "データベースに接続できません" }, { status: 500 });
  }

  const { data: before, error: selErr } = await supabase
    .from("users")
    .select("first_work_date, name")
    .eq("id", memberId)
    .maybeSingle();
  if (selErr) {
    const m = (selErr as { message?: string }).message ?? String(selErr);
    return NextResponse.json({ error: m }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: "メンバーが見つかりません" }, { status: 404 });
  }

  const updates = coerceMemberUpdates(rawUpdates as Record<string, unknown>);

  if (updates.invoiceRegistrationNumber !== undefined) {
    const invRegCheck = validateQualifiedInvoiceRegistrationNumber(updates.invoiceRegistrationNumber);
    if (!invRegCheck.ok) {
      return NextResponse.json({ error: invRegCheck.message }, { status: 400 });
    }
    updates.invoiceRegistrationNumber = invRegCheck.value;
  }

  const prevEmpty =
    before.first_work_date == null || String(before.first_work_date).trim() === "";
  const newFirst = updates.firstWorkDate;
  const willSet =
    newFirst !== undefined && newFirst != null && String(newFirst).trim() !== "";
  const shouldNotifySlack = prevEmpty && willSet;

  try {
    await updateMemberOrThrow(memberId, updates);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (shouldNotifySlack && newFirst != null) {
    const dateYmd = String(newFirst).trim().slice(0, 10);
    const memberName = (
      typeof updates.name === "string" ? updates.name : (before.name as string) ?? ""
    ).trim();
    const base = resolveAppBaseUrl(o);
    const editUrl =
      base !== "" ? `${base}/?adminEditMember=${encodeURIComponent(memberId)}` : `/?adminEditMember=${encodeURIComponent(memberId)}`;
    await notifyFirstWorkDateSetSlack({
      memberName: memberName || "（名前なし）",
      dateYmd,
      editUrl,
    });
  }

  return NextResponse.json({ ok: true });
}
