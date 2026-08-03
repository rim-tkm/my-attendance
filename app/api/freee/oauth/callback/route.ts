import { NextResponse, type NextRequest } from "next/server";
import { resolveAppBaseUrlFromEnv } from "@/lib/app-base-url";
import { exchangeFreeeAuthCode } from "@/lib/freee-api";

/**
 * freee 認可後のコールバック。state を Cookie と照合し、コードをトークンに交換して保存する。
 * 成否はトップへのリダイレクトのクエリ（?freee=connected / ?freee=error）で伝える。
 */
export async function GET(req: NextRequest) {
  const base = resolveAppBaseUrlFromEnv() || new URL(req.url).origin;
  const redirectTo = (result: string, detail?: string) => {
    const u = new URL(base);
    u.searchParams.set("freee", result);
    if (detail) u.searchParams.set("freeeDetail", detail.slice(0, 200));
    const res = NextResponse.redirect(u.toString());
    res.cookies.set("freee_oauth_state", "", { httpOnly: true, maxAge: 0, path: "/" });
    return res;
  };

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get("freee_oauth_state")?.value;
  if (!code || !state || !cookieState || state !== cookieState) {
    return redirectTo("error", "認可フローが不正です（もう一度「freeeと接続」からやり直してください）");
  }
  try {
    const { companyName } = await exchangeFreeeAuthCode(code);
    return redirectTo("connected", companyName);
  } catch (e) {
    return redirectTo("error", e instanceof Error ? e.message : String(e));
  }
}
