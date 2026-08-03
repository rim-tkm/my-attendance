import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { buildFreeeAuthorizeUrl } from "@/lib/freee-api";

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

/** freee の認可画面へリダイレクト（管理者のみ）。state は httpOnly Cookie に置き callback で照合する */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !isAdmin(session)) {
    return NextResponse.json({ error: "管理者のみ利用できます" }, { status: 403 });
  }
  const state = crypto.randomUUID();
  const url = buildFreeeAuthorizeUrl(state);
  if (!url) {
    return NextResponse.json(
      { error: "FREEE_CLIENT_ID / FREEE_CLIENT_SECRET（Vercel 環境変数）が未設定です" },
      { status: 500 }
    );
  }
  const res = NextResponse.redirect(url);
  res.cookies.set("freee_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
