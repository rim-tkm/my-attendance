"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import type { Member } from "@/lib/attendance";
import { loadMembers, updateMember } from "@/lib/supabase-data";

function isAdminSession(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

export default function ArchivedMembersPage() {
  const { data: session, status } = useSession();
  const [members, setMembers] = useState<Member[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const mems = await loadMembers();
    setMembers(mems ?? []);
    setLoadError(mems === null ? "メンバー一覧を読み込めませんでした。" : null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-sm text-slate-600" role="status">
        読み込み中…
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <p className="mb-4 text-sm text-slate-700">ログインが必要です。</p>
        <Link href="/login" className="text-sm text-slate-700 underline hover:text-slate-900">
          ログイン
        </Link>
      </div>
    );
  }

  if (!isAdminSession(session)) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <p className="text-sm text-red-700">管理者のみアクセスできます。</p>
        <Link href="/" className="mt-4 inline-block text-sm text-slate-700 underline hover:text-slate-900">
          トップに戻る
        </Link>
      </div>
    );
  }

  const archived = members.filter((m) => m.isActive === false);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-slate-800">アーカイブ済みメンバー</h1>
        <Link href="/" className="text-sm text-slate-600 underline hover:text-slate-900">
          メイン画面に戻る
        </Link>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        無効化したメンバーを有効に戻すか、データベースから完全に削除できます。完全削除は取り消せません。
      </p>
      {loadError ? <p className="mb-4 text-sm text-red-600">{loadError}</p> : null}
      {archived.length === 0 ? (
        <p className="text-sm text-slate-600">アーカイブ中のメンバーはいません。</p>
      ) : (
        <ul className="space-y-2">
          {archived.map((mem) => (
            <li
              key={mem.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm shadow-sm"
            >
              <div className="min-w-0">
                <span className="font-medium text-slate-800">{mem.name}</span>
                <span className="ml-2 text-slate-500">{mem.loginAccount || "—"}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await updateMember(mem.id, { isActive: true });
                      await refresh();
                    } catch (e) {
                      alert(e instanceof Error ? e.message : String(e));
                    }
                  }}
                  className="rounded bg-slate-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-500"
                >
                  有効に戻す
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm("本当にこのメンバーを完全に削除しますか？この操作は取り消せません。")) return;
                    try {
                      const res = await fetch(`/api/members/${encodeURIComponent(mem.id)}`, { method: "DELETE" });
                      const data = (await res.json().catch(() => ({}))) as { error?: string };
                      if (!res.ok) throw new Error(data.error || "削除に失敗しました");
                      await refresh();
                    } catch (e) {
                      alert(e instanceof Error ? e.message : String(e));
                    }
                  }}
                  className="rounded border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
                >
                  完全に削除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
