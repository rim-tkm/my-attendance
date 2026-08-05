/**
 * Googleフォーム / GAS 連携 API 用の共有シークレット認証。
 * EXTERNAL_REGISTER_SECRET 未設定時は認証を「拒否」する（フェイルクローズ）。
 * 以前は未設定時にスキップしていたが、環境変数の設定漏れ・消失だけで
 * 登録・口座変更APIが無認証公開になるため廃止（監査指摘 2026-08-05）。
 */
export function verifyExternalRegisterSecret(request: Request): { ok: true } | { ok: false; error: string } {
  const secret = process.env.EXTERNAL_REGISTER_SECRET?.trim();
  if (!secret) {
    return {
      ok: false,
      error: "サーバー側で EXTERNAL_REGISTER_SECRET が未設定のため、このAPIは利用できません。管理者に連絡してください。",
    };
  }

  const auth = request.headers.get("authorization")?.trim() ?? "";
  if (!auth.startsWith("Bearer ")) {
    return { ok: false, error: "Authorization: Bearer <EXTERNAL_REGISTER_SECRET> が必要です。" };
  }
  const token = auth.slice("Bearer ".length).trim();
  if (token !== secret) {
    return { ok: false, error: "認証に失敗しました。" };
  }
  return { ok: true };
}
