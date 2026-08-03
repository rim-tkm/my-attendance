import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 本人による登録情報確認のエビデンスログ（profile_confirmations）への記録。
 * 確認時点の登録内容スナップショットを JSON で残し、「いつ・誰が・どの内容を確認したか」を証明できるようにする。
 * ログ書き込みの失敗で本体処理（確認・保存）を失敗させない（テーブル未作成環境では警告のみ）。
 */
export async function appendProfileConfirmationLog(
  supabase: SupabaseClient,
  userId: string,
  kind: "no_change" | "updated"
): Promise<void> {
  try {
    const { data: row, error: selErr } = await supabase
      .from("users")
      .select(
        "name, last_name, first_name, zip_code, address, address2, phone_number, bank_name, bank_code, branch_name, branch_code, account_type, account_number, account_holder, invoice_registration_number"
      )
      .eq("id", userId)
      .maybeSingle();
    if (selErr || !row) {
      console.warn("[profile-confirmation-log] snapshot取得スキップ:", selErr?.message);
      return;
    }
    const { error: insErr } = await supabase
      .from("profile_confirmations")
      .insert({ user_id: userId, kind, snapshot: row });
    if (insErr) console.warn("[profile-confirmation-log] 記録スキップ:", insErr.message);
  } catch (e) {
    console.warn("[profile-confirmation-log] 記録スキップ:", e);
  }
}
