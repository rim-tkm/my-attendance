/**
 * サーバー側で管理画面・通知用の絶対 URL のベースを組み立てる。
 * リクエスト body の appBaseUrl は呼び出し元で優先すること。
 */
export function resolveAppBaseUrlFromEnv(): string {
  const auth = process.env.NEXTAUTH_URL?.trim().replace(/\/$/, "");
  if (auth) return auth;
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    return vercel.startsWith("http") ? vercel.replace(/\/$/, "") : `https://${vercel.replace(/\/$/, "")}`;
  }
  return "";
}

/** メンバー編集モーダルを開く管理トップの URL */
export function adminMemberEditUrl(memberId: string): string {
  const base = resolveAppBaseUrlFromEnv();
  const path = `/?adminEditMember=${encodeURIComponent(memberId)}`;
  return base !== "" ? `${base}${path}` : path;
}
