/**
 * Googleフォーム / GAS 連携 API 用の共有シークレット認証。
 * EXTERNAL_REGISTER_SECRET 未設定時は後方互換のため認証をスキップ（本番では必ず設定推奨）。
 */
export function verifyExternalRegisterSecret(request: Request): { ok: true } | { ok: false; error: string } {
  const secret = process.env.EXTERNAL_REGISTER_SECRET?.trim();
  if (!secret) return { ok: true };

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
