import { getToken } from "next-auth/jwt";
import { getServerSession } from "next-auth";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { sendSlackManualRoiReport } from "@/lib/slack-manual-report";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type CookieBag = Record<string, string>;

/**
 * NextAuth の Route Handler と同じ形で Cookie を渡す（NextRequest 直渡しだと getToken が空になることがある）
 */
function cookiesObjectFromStore(): CookieBag {
  return Object.fromEntries(cookies().getAll().map((c) => [c.name, c.value]));
}

/**
 * JWT から admin 判定。secure / non-secure クッキー名の差を吸収。
 */
async function getLoginIdFromJwt(secret: string, request: NextRequest): Promise<string | null> {
  const cookieRecord = cookiesObjectFromStore();
  const headerRecord = Object.fromEntries(request.headers.entries());

  for (const secureCookie of [undefined, true, false] as const) {
    const opts =
      secureCookie === undefined
        ? { req: { headers: headerRecord, cookies: cookieRecord }, secret }
        : { req: { headers: headerRecord, cookies: cookieRecord }, secret, secureCookie };

    const token = await getToken(opts as Parameters<typeof getToken>[0]);
    if (token && typeof token === "object" && typeof token.loginId === "string") {
      return token.loginId;
    }
  }

  return null;
}

/**
 * 管理者のみ。getToken（クッキー直列化）と getServerSession（next/headers）の二段で確認。
 */
async function assertAdminFromRequest(request: NextRequest): Promise<NextResponse | null> {
  const secret =
    process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        error: "サーバー設定エラー：AUTH_SECRET または NEXTAUTH_SECRET を設定してください",
      },
      { status: 503 }
    );
  }

  let loginId = await getLoginIdFromJwt(secret, request);

  if (!loginId) {
    const session = await getServerSession(authOptions);
    loginId =
      session?.user && typeof (session.user as { loginId?: string }).loginId === "string"
        ? (session.user as { loginId: string }).loginId
        : "";
  }

  if (!loginId) {
    return NextResponse.json(
      {
        ok: false,
        error: "ログインしてください（セッションを確認できませんでした。再ログインしてください）",
      },
      { status: 401 }
    );
  }

  if (loginId.toLowerCase() !== "admin") {
    return NextResponse.json({ ok: false, error: "管理者のみ利用できます" }, { status: 403 });
  }

  return null;
}

/**
 * 管理者のみ。期間指定の ROI ランキングを Slack へ送信。
 * POST JSON: { startDate, endDate, memberIds?: string[] | null }
 */
export async function POST(request: NextRequest) {
  const authDenied = await assertAdminFromRequest(request);
  if (authDenied) return authDenied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "不正なJSONです" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "リクエストボディが不正です" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const startDate = typeof b.startDate === "string" ? b.startDate : "";
  const endDate = typeof b.endDate === "string" ? b.endDate : "";

  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    return NextResponse.json(
      { ok: false, error: "startDate / endDate は YYYY-MM-DD 形式で指定してください" },
      { status: 400 }
    );
  }

  let memberIds: string[] | null = null;
  if (Array.isArray(b.memberIds)) {
    memberIds = b.memberIds.filter((x): x is string => typeof x === "string" && x.length > 0);
  } else if (b.memberIds === null || b.memberIds === undefined) {
    memberIds = null;
  } else {
    return NextResponse.json({ ok: false, error: "memberIds は文字列の配列または null です" }, { status: 400 });
  }

  const result = await sendSlackManualRoiReport(startDate, endDate, memberIds);
  if (!result.ok) {
    const status = result.error === "Slack webhook failed" ? 502 : 500;
    return NextResponse.json(
      { ok: false, error: result.error, detail: "detail" in result ? result.detail : undefined },
      { status }
    );
  }

  return NextResponse.json({ ok: true, start: result.start, end: result.end });
}

export async function GET() {
  return NextResponse.json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
}
