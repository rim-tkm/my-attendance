import { normalizeMemberName, type Member } from "@/lib/attendance";
import { bankByCode, branchByCode } from "@/lib/bank-master";
import { freeeRequest, getFreeeAccess } from "@/lib/freee-api";
import {
  accountNumberForTransfer,
  branchNameForFreee,
  resolveBankCodesForFreee,
  resolveJpAddress,
  splitBuildingFromStreet,
  toHalfWidthKana,
} from "@/lib/freee-partners-csv";
import { getSupabase } from "@/lib/supabase";
import { loadMembers } from "@/lib/supabase-data";

/**
 * freee 取引先（partner）API の作成・更新ペイロードをメンバーから組み立てる（サーバー専用）。
 * フィールド名は freee 公式 OpenAPI スキーマ（partnerCreateParams / partnerUpdateParams）に準拠。
 * 支払条件は CSV 出力と同じ全員共通の運用値（末日締め＝cutoff_day 32・翌月＝additional_months 1・15日払い）。
 */

/** freee の都道府県コード（0=北海道 〜 46=沖縄。JIS コード−1） */
const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

function prefectureCode(prefecture: string): number {
  const i = PREFECTURES.indexOf(prefecture);
  return i >= 0 ? i : -1; // -1 = 設定しない
}

export type FreeePartnerPayload = Record<string, unknown>;

/** 取引先の作成・更新に使う共通ペイロード（company_id は呼び出し側で付与） */
export function buildFreeePartnerPayload(member: Member, companyId: number): FreeePartnerPayload {
  const { prefecture, rest } = resolveJpAddress(member.address ?? "", member.postalCode ?? "");
  const address2 = (member.address2 ?? "").trim();
  const split = address2 !== "" ? { street: rest, building: address2 } : splitBuildingFromStreet(rest);
  const { bankCode, branchCode } = resolveBankCodesForFreee(member);
  const bankMaster = bankCode !== "" ? bankByCode(bankCode) : null;
  const branchMaster = bankCode !== "" && branchCode !== "" ? branchByCode(bankCode, branchCode) : null;
  const invReg = (member.invoiceRegistrationNumber ?? "").trim();
  const accountType = ((member.accountType ?? "普通").trim() || "普通") === "当座" ? "checking" : "ordinary";
  const accountHolderKana = (member.accountHolder ?? "").trim() || (member.furigana ?? "").trim();

  const payload: FreeePartnerPayload = {
    company_id: companyId,
    name: member.name,
    org_code: 2, // 個人
    country_code: "JP",
    phone: (member.phoneNumber ?? "").trim(),
    qualified_invoice_issuer: invReg !== "",
    payment_term_attributes: { cutoff_day: 32, additional_months: 1, fixed_day: 15 },
  };
  if (invReg !== "" && /^T[1-9][0-9]{12}$/.test(invReg)) {
    payload.invoice_registration_number = invReg;
  }
  if ((member.address ?? "").trim() !== "" || (member.postalCode ?? "").trim() !== "") {
    payload.address_attributes = {
      zipcode: (member.postalCode ?? "").trim(),
      prefecture_code: prefectureCode(prefecture),
      street_name1: split.street,
      street_name2: split.building,
    };
  }
  if ((member.bankName ?? "").trim() !== "") {
    payload.partner_bank_account_attributes = {
      bank_name: (member.bankName ?? "").trim(),
      bank_name_kana: bankMaster ? toHalfWidthKana(bankMaster.kana) : "",
      bank_code: bankCode,
      branch_name: branchNameForFreee(member.branchName ?? ""),
      branch_kana: branchMaster ? toHalfWidthKana(branchMaster.kana) : "",
      branch_code: branchCode,
      account_type: accountType,
      account_number: accountNumberForTransfer(member.accountNumber ?? "", (member.bankName ?? "").trim(), bankCode),
      long_account_name: member.name,
      account_name: toHalfWidthKana(accountHolderKana),
    };
  }
  return payload;
}

export type FreeeSyncRow = { name: string; action: "created" | "updated" | "error"; detail?: string };

export type FreeeSyncSummary =
  | {
      ok: true;
      companyName: string;
      created: number;
      updated: number;
      errors: FreeeSyncRow[];
      linked: FreeeSyncRow[];
    }
  | { ok: false; error: string };

/**
 * 有効メンバー（管理者除く）を freee の取引先として一括同期する（管理画面のボタンと毎日の Cron の共通コア）。
 * - users.freee_partner_id が未設定 → 作成して ID を保存。設定済み → 更新
 * - freee 側の既存取引先とは空白無視の名前照合で自動紐付け（更新時に name がアプリ表記へ揃う）
 */
export async function syncAllMembersToFreee(): Promise<FreeeSyncSummary> {
  const access = await getFreeeAccess();
  if (!access) {
    return { ok: false, error: "freee と未接続です。管理設定の「freeeと接続」を実行してください。" };
  }
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "データベースに接続できません" };
  const members = await loadMembers();
  if (members === null) return { ok: false, error: "メンバーを取得できません" };

  const targets = members.filter(
    (m) => m.isActive !== false && (m.loginAccount ?? "").trim().toLowerCase() !== "admin"
  );

  const results: FreeeSyncRow[] = [];
  let created = 0;
  let updated = 0;

  const savePartnerId = async (memberId: string, partnerId: number) => {
    const { error } = await supabase.from("users").update({ freee_partner_id: partnerId }).eq("id", memberId);
    if (error) console.warn("[freee-sync] freee_partner_id 保存エラー:", error);
  };

  const partnersByNormalizedName = new Map<string, number>();
  try {
    const pageLimit = 100;
    for (let offset = 0; ; offset += pageLimit) {
      const page = await freeeRequest<{ partners?: { id: number; name: string }[] }>(
        access.accessToken,
        "GET",
        `/api/1/partners?company_id=${access.companyId}&limit=${pageLimit}&offset=${offset}`
      );
      const list = page.partners ?? [];
      for (const p of list) {
        partnersByNormalizedName.set(normalizeMemberName(p.name), p.id);
      }
      if (list.length < pageLimit) break;
    }
  } catch (e) {
    return {
      ok: false,
      error: `freee の既存取引先一覧を取得できません: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  for (const m of targets) {
    const payload = buildFreeePartnerPayload(m, access.companyId);
    try {
      if (m.freeePartnerId != null) {
        await freeeRequest(access.accessToken, "PUT", `/api/1/partners/${m.freeePartnerId}`, payload);
        updated++;
        results.push({ name: m.name, action: "updated" });
        continue;
      }
      const existingId = partnersByNormalizedName.get(normalizeMemberName(m.name));
      if (existingId != null) {
        await freeeRequest(access.accessToken, "PUT", `/api/1/partners/${existingId}`, payload);
        await savePartnerId(m.id, existingId);
        updated++;
        results.push({ name: m.name, action: "updated", detail: "freee側の既存取引先に自動紐付けしました" });
        continue;
      }
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
    } catch (e) {
      results.push({ name: m.name, action: "error", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    ok: true,
    companyName: access.companyName,
    created,
    updated,
    errors: results.filter((x) => x.action === "error"),
    linked: results.filter((x) => x.detail != null && x.action !== "error"),
  };
}
