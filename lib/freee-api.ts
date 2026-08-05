import { resolveAppBaseUrlFromEnv } from "@/lib/app-base-url";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * freee 会計 API の OAuth2 認証・トークン管理・HTTP ラッパー（サーバー専用）。
 *
 * - トークンは Supabase の freee_oauth_tokens（RLS 閉鎖・service_role のみ）に 1 行で保管。
 * - アクセストークンは 6 時間有効。期限 5 分前を切ったら refresh_token で自動更新して保存し直す。
 *   freee の refresh_token は使い捨て（更新のたびに新しいものへ差し替わる）ため、保存失敗時は再接続が必要。
 * - 必要な環境変数: FREEE_CLIENT_ID / FREEE_CLIENT_SECRET（freee アプリストアの開発者ページで発行）。
 *   コールバック URL は `${NEXTAUTH_URL}/api/freee/oauth/callback` を freee 側にも登録すること。
 */

const FREEE_AUTHORIZE_URL = "https://accounts.secure.freee.co.jp/public_api/authorize";
const FREEE_TOKEN_URL = "https://accounts.secure.freee.co.jp/public_api/token";
export const FREEE_API_BASE = "https://api.freee.co.jp";

const TOKEN_ROW_ID = "default";
/** 期限のこの秒数前からリフレッシュを行う */
const REFRESH_MARGIN_SECONDS = 300;

export type FreeeTokensRow = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  company_id: number | null;
  company_name: string | null;
};

export function getFreeeClientConfig(): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const clientId = (process.env.FREEE_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.FREEE_CLIENT_SECRET ?? "").trim();
  const base = resolveAppBaseUrlFromEnv();
  if (!clientId || !clientSecret || !base) return null;
  return { clientId, clientSecret, redirectUri: `${base}/api/freee/oauth/callback` };
}

/** freee の認可画面 URL（管理者をここへリダイレクトする） */
export function buildFreeeAuthorizeUrl(state: string): string | null {
  const cfg = getFreeeClientConfig();
  if (!cfg) return null;
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    state,
  });
  return `${FREEE_AUTHORIZE_URL}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

async function requestToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(FREEE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error_description?: string };
  if (!res.ok || !json.access_token || !json.refresh_token) {
    throw new Error(`freee トークン取得に失敗: ${json.error_description ?? res.status}`);
  }
  return { access_token: json.access_token, refresh_token: json.refresh_token, expires_in: json.expires_in ?? 21600 };
}

function expiresAtFrom(expiresInSeconds: number): string {
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

async function saveTokens(tokens: TokenResponse, extra?: { companyId?: number; companyName?: string }): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY が未設定のためトークンを保存できません");
  const row: Record<string, unknown> = {
    id: TOKEN_ROW_ID,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAtFrom(tokens.expires_in),
    updated_at: new Date().toISOString(),
  };
  if (extra?.companyId !== undefined) row.company_id = extra.companyId;
  if (extra?.companyName !== undefined) row.company_name = extra.companyName;
  const { error } = await admin.from("freee_oauth_tokens").upsert(row, { onConflict: "id" });
  if (error) throw new Error(`freee トークンの保存に失敗: ${error.message}`);
}

export async function loadFreeeTokens(): Promise<FreeeTokensRow | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const { data, error } = await admin
    .from("freee_oauth_tokens")
    .select("access_token, refresh_token, expires_at, company_id, company_name")
    .eq("id", TOKEN_ROW_ID)
    .maybeSingle();
  if (error || !data) return null;
  return data as FreeeTokensRow;
}

/** 認可コードをトークンに交換し、事業所を取得して保存する（コールバックから呼ぶ） */
export async function exchangeFreeeAuthCode(code: string): Promise<{ companyName: string }> {
  const cfg = getFreeeClientConfig();
  if (!cfg) throw new Error("FREEE_CLIENT_ID / FREEE_CLIENT_SECRET が未設定です");
  const tokens = await requestToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: cfg.redirectUri,
    })
  );
  // 事業所（company）は最初の 1 件を採用（複数事業所運用になったら選択 UI を検討）
  const companiesRes = await fetch(`${FREEE_API_BASE}/api/1/companies`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const companiesJson = (await companiesRes.json().catch(() => ({}))) as {
    companies?: { id: number; display_name?: string; name?: string }[];
  };
  const company = companiesJson.companies?.[0];
  if (!company) throw new Error("freee の事業所を取得できませんでした");
  const companyName = company.display_name ?? company.name ?? String(company.id);
  await saveTokens(tokens, { companyId: company.id, companyName });
  return { companyName };
}

/** 有効なアクセストークンと事業所IDを返す（期限が近ければ自動リフレッシュ）。未接続なら null */
export async function getFreeeAccess(): Promise<{ accessToken: string; companyId: number; companyName: string } | null> {
  const stored = await loadFreeeTokens();
  if (!stored || stored.company_id == null) return null;
  const expiresAtMs = Date.parse(stored.expires_at);
  if (Number.isFinite(expiresAtMs) && expiresAtMs - Date.now() > REFRESH_MARGIN_SECONDS * 1000) {
    return {
      accessToken: stored.access_token,
      companyId: stored.company_id,
      companyName: stored.company_name ?? "",
    };
  }
  const cfg = getFreeeClientConfig();
  if (!cfg) return null;
  try {
    const refreshed = await requestToken(
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: stored.refresh_token,
      })
    );
    await saveTokens(refreshed);
    return {
      accessToken: refreshed.access_token,
      companyId: stored.company_id,
      companyName: stored.company_name ?? "",
    };
  } catch (e) {
    // refresh_token は使い捨てのため、手動同期と Cron が同時に走ると片方の refresh が失敗する。
    // その場合は勝った側が保存した最新トークンを読み直して使う（競合の自己回復）。
    const latest = await loadFreeeTokens();
    if (latest && latest.company_id != null && latest.refresh_token !== stored.refresh_token) {
      const latestExpiry = Date.parse(latest.expires_at);
      if (Number.isFinite(latestExpiry) && latestExpiry - Date.now() > REFRESH_MARGIN_SECONDS * 1000) {
        return {
          accessToken: latest.access_token,
          companyId: latest.company_id,
          companyName: latest.company_name ?? "",
        };
      }
    }
    throw e;
  }
}

/** freee API 呼び出し（JSON）。エラー時は freee のメッセージを含む Error を投げる */
export async function freeeRequest<T>(
  accessToken: string,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${FREEE_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Api-Version": "2020-06-15",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as T & {
    errors?: { messages?: string[] }[];
    message?: string;
  };
  if (!res.ok) {
    const messages =
      json.errors?.flatMap((e) => e.messages ?? []).join(" / ") ?? json.message ?? `HTTP ${res.status}`;
    throw new Error(messages);
  }
  return json;
}
