import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { listUsers, addUser } from "@/lib/users";

function isAdmin(session: { user?: { loginId?: string } | null } | null): boolean {
  return session?.user?.loginId === "admin";
}

/** メンバー一覧（管理者のみ） */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "ログインしてください" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "管理者のみ利用できます" }, { status: 403 });
  }
  const users = listUsers();
  return NextResponse.json(users);
}

/** メンバー追加（管理者のみ） */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "ログインしてください" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "管理者のみ利用できます" }, { status: 403 });
  }
  let body: { loginId?: string; name?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });
  }
  const { loginId, name, password } = body;
  if (!loginId?.trim() || !name?.trim() || !password) {
    return NextResponse.json(
      { error: "ログインID・名前・パスワードは必須です" },
      { status: 400 }
    );
  }
  const result = await addUser(loginId.trim(), name.trim(), password);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
