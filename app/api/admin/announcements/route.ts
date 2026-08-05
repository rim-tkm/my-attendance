import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  isAnnouncementTargetedAt,
  normalizeAnnouncementTarget,
  toAnnouncement,
  type DbAnnouncement,
} from "@/lib/announcements";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

type DbUserRow = {
  id: string;
  name: string | null;
  is_intern: boolean | null;
  is_active: boolean | null;
  login_account: string | null;
};

/** 全お知らせに確認状況（対象人数・確認済み人数・未確認者）を添えて返す（管理者のみ） */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ ok: false, error: "管理者のみ利用できます" }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY が未設定です" }, { status: 500 });
  }

  const [{ data: rows, error: listErr }, { data: userRows, error: userErr }, { data: readRows, error: readErr }] =
    await Promise.all([
      supabase.from("announcements").select("*").order("created_at", { ascending: false }),
      supabase.from("users").select("id, name, is_intern, is_active, login_account"),
      supabase.from("announcement_reads").select("announcement_id, user_id, version"),
    ]);
  if (listErr) return NextResponse.json({ ok: false, error: listErr.message }, { status: 500 });
  if (userErr) return NextResponse.json({ ok: false, error: userErr.message }, { status: 500 });
  if (readErr) return NextResponse.json({ ok: false, error: readErr.message }, { status: 500 });

  const users = (userRows as DbUserRow[]) ?? [];
  const readKeys = new Set(
    ((readRows ?? []) as { announcement_id: string; user_id: string; version: number }[]).map(
      (r) => `${r.announcement_id}\t${r.user_id}\t${r.version}`
    )
  );

  const announcements = ((rows as DbAnnouncement[]) ?? []).map((r) => {
    const target = normalizeAnnouncementTarget(r.target);
    const version = typeof r.version === "number" ? r.version : 1;
    const targets = users.filter((u) =>
      isAnnouncementTargetedAt(target, {
        isIntern: u.is_intern === true,
        isActive: u.is_active !== false,
        loginAccount: u.login_account ?? "",
      })
    );
    const unconfirmedMembers = targets
      .filter((u) => !readKeys.has(`${r.id}\t${u.id}\t${version}`))
      .map((u) => ({ id: u.id, name: (u.name ?? "").trim() || "（名前なし）" }))
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));
    return {
      ...toAnnouncement(r, null),
      targetCount: targets.length,
      confirmedCount: targets.length - unconfirmedMembers.length,
      unconfirmedMembers,
    };
  });

  return NextResponse.json({ ok: true, announcements });
}

/** お知らせの新規作成（管理者のみ） */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ ok: false, error: "管理者のみ利用できます" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "不正な JSON です" }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  const text = typeof o.body === "string" ? o.body.trim() : "";
  if (!title) {
    return NextResponse.json({ ok: false, error: "タイトルを入力してください" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ ok: false, error: "本文を入力してください" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY が未設定です" }, { status: 500 });
  }

  const adminId = (session.user as { id?: string }).id ?? null;
  const { data, error } = await supabase
    .from("announcements")
    .insert({
      title,
      body: text,
      target: normalizeAnnouncementTarget(typeof o.target === "string" ? o.target : "all"),
      is_required: o.isRequired !== false,
      is_published: true,
      version: 1,
      created_by: adminId,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data?.id ?? null });
}
