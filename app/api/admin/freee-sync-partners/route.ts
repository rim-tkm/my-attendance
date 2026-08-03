import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { freeeRequest, getFreeeAccess } from "@/lib/freee-api";
import { buildFreeePartnerPayload } from "@/lib/freee-partner-sync";
import { getSupabase } from "@/lib/supabase";
import { loadMembers } from "@/lib/supabase-data";

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

type SyncRow = { name: string; action: "created" | "updated" | "error"; detail?: string };

/**
 * 有効メンバー（管理者除く）を freee の取引先として同期する（管理者のみ）。
 * - users.freee_partner_id が未設定 → POST /api/1/partners で新規作成し、返ってきた ID を保存
 * - 設定済み → PUT /api/1/partners/{id} で更新（名前・住所・口座・支払条件を上書き）
 * - 「既に使用されています」等の名前重複は、freee 側の既存取引先を検索して ID を取り込み更新に切り替える
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !isAdmin(session)) {
    return NextResponse.json({ error: "管理者のみ利用できます" }, { status: 403 });
  }
  const access = await getFreeeAccess();
  if (!access) {
    return NextResponse.json(
      { error: "freee と未接続です。先に「freeeと接続」を実行してください。" },
      { status: 400 }
    );
  }
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "データベースに接続できません" }, { status: 500 });
  }
  const members = await loadMembers();
  if (members === null) {
    return NextResponse.json({ error: "メンバーを取得できません" }, { status: 500 });
  }

  const targets = members.filter(
    (m) => m.isActive !== false && (m.loginAccount ?? "").trim().toLowerCase() !== "admin"
  );

  const results: SyncRow[] = [];
  let created = 0;
  let updated = 0;

  const savePartnerId = async (memberId: string, partnerId: number) => {
    const { error } = await supabase.from("users").update({ freee_partner_id: partnerId }).eq("id", memberId);
    if (error) console.warn("[freee-sync] freee_partner_id 保存エラー:", error);
  };

  /** 名前重複時のフォールバック: freee 側を検索して同名取引先の ID を返す */
  const findPartnerIdByName = async (name: string): Promise<number | null> => {
    try {
      const res = await freeeRequest<{ partners?: { id: number; name: string }[] }>(
        access.accessToken,
        "GET",
        `/api/1/partners?company_id=${access.companyId}&keyword=${encodeURIComponent(name)}&limit=10`
      );
      const hit = (res.partners ?? []).find((p) => p.name === name);
      return hit ? hit.id : null;
    } catch {
      return null;
    }
  };

  for (const m of targets) {
    const payload = buildFreeePartnerPayload(m, access.companyId);
    try {
      if (m.freeePartnerId != null) {
        await freeeRequest(access.accessToken, "PUT", `/api/1/partners/${m.freeePartnerId}`, payload);
        updated++;
        results.push({ name: m.name, action: "updated" });
        continue;
      }
      try {
        const createdRes = await freeeRequest<{ partner?: { id: number } }>(
          access.accessToken,
          "POST",
          "/api/1/partners",
          payload
        );
        const newId = createdRes.partner?.id;
        if (newId != null) await savePartnerId(m.id, newId);
        created++;
        results.push({ name: m.name, action: "created" });
      } catch (createErr) {
        // 名前重複（手動登録済みなど）→ 既存取引先を取り込んで更新
        const existingId = await findPartnerIdByName(m.name);
        if (existingId == null) throw createErr;
        await freeeRequest(access.accessToken, "PUT", `/api/1/partners/${existingId}`, payload);
        await savePartnerId(m.id, existingId);
        updated++;
        results.push({ name: m.name, action: "updated", detail: "freee側の同名取引先に紐付けました" });
      }
    } catch (e) {
      results.push({ name: m.name, action: "error", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({
    ok: true,
    companyName: access.companyName,
    created,
    updated,
    errors: results.filter((r) => r.action === "error"),
    linked: results.filter((r) => r.detail != null && r.action !== "error"),
  });
}
