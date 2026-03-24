import { NextRequest, NextResponse } from "next/server";

/** Cron / 手動実行用: `Authorization: Bearer ${CRON_SECRET}` のみ許可 */
export function verifyCronSecret(request: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured. Set CRON_SECRET in the environment.", ok: false },
      { status: 503 }
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized", ok: false }, { status: 401 });
  }
  return null;
}
