"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
// lib/line-link-data.ts は Supabase クライアントを直接持つサーバー専用モジュール。
// 値を import するとブラウザバンドルに混入するので、型だけ借りる。
import type { LineLinkRow } from "@/lib/line-link-data";

const INVITE_TEMPLATE = `【お願い・10秒で終わります】
アプリとLINEの連携のため、このトークに次のコードだけを送ってください
→ {あなたのコード}
送信すると自動で「登録できました」と返信が届きます`;

function formatJstDateTimeLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

/** 未連携が上、それぞれ name 昇順 */
function sortLineLinkRows(rows: LineLinkRow[]): LineLinkRow[] {
  return [...rows].sort((a, b) => {
    const aLinked = a.lineUserId != null;
    const bLinked = b.lineUserId != null;
    if (aLinked !== bLinked) return aLinked ? 1 : -1;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

export function AdminLineLinkSection() {
  const [rows, setRows] = useState<LineLinkRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/line-links", { credentials: "include" });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; rows?: LineLinkRow[]; error?: string }
        | null;
      if (!res.ok || !data?.ok || !Array.isArray(data.rows)) {
        throw new Error(data?.error || "読み込みに失敗しました");
      }
      setRows(data.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sortedRows = useMemo(() => sortLineLinkRows(rows), [rows]);
  const linkedCount = useMemo(() => rows.filter((r) => r.lineUserId != null).length, [rows]);
  const unlinkedCount = rows.length - linkedCount;

  const handleIssueCodes = useCallback(async () => {
    if (!window.confirm("コード未発行のメンバー全員にコードを発行します。よろしいですか？")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/line-links", {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; issued?: number; error?: string } | null;
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "発行に失敗しました");
      }
      window.alert(`${data.issued ?? 0}件発行しました`);
      await load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [load]);

  const handleUnlink = useCallback(
    async (row: LineLinkRow) => {
      if (!window.confirm(`${row.name}さんのLINE連携を取り消します。よろしいですか？`)) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/line-links/${encodeURIComponent(row.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ action: "unlink" }),
        });
        const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || "取り消しに失敗しました");
        }
        await load();
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">LINE連携</h2>
        <p className="mt-1 text-xs text-slate-500">
          メンバーの公式LINEとアプリのアカウントを紐付けます。コードを発行し、下の案内文をメンバーに送ってください。
        </p>

        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleIssueCodes()}
            disabled={busy}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "処理中…" : "コードを一括発行"}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy || loading}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            更新
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] text-slate-500">連携済み</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">
              {linkedCount.toLocaleString("ja-JP")}
              <span className="ml-1 text-xs font-normal text-slate-500">人</span>
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] text-slate-500">未連携</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">
              {unlinkedCount.toLocaleString("ja-JP")}
              <span className="ml-1 text-xs font-normal text-slate-500">人</span>
            </p>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          {sortedRows.length === 0 ? (
            <p className="text-sm text-slate-600">{loading ? "読み込み中です。" : "メンバーがいません。"}</p>
          ) : (
            <table className="w-full min-w-[36rem] text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] text-slate-500">
                  <th className="py-1.5 pr-3 font-medium">氏名</th>
                  <th className="py-1.5 pr-3 font-medium">コード</th>
                  <th className="py-1.5 pr-3 font-medium">状態</th>
                  <th className="py-1.5 pr-3 font-medium">連携日時</th>
                  <th className="py-1.5 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => {
                  const linked = row.lineUserId != null;
                  return (
                    <tr key={row.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-3 text-slate-800">
                        <span className="font-medium">{row.name}</span>
                        {row.isIntern && (
                          <span className="ml-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-800">
                            インターン
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-slate-700">
                        {row.lineLinkCode ?? <span className="text-slate-400">未発行</span>}
                      </td>
                      <td className="py-2 pr-3">
                        {linked ? (
                          <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                            連携済み
                          </span>
                        ) : (
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                            未連携
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-slate-600">{formatJstDateTimeLabel(row.lineLinkedAt)}</td>
                      <td className="py-2">
                        {linked && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleUnlink(row)}
                            className="rounded border border-red-300 bg-red-50 px-3 py-1 text-[11px] text-red-700 hover:bg-red-100 disabled:opacity-50"
                          >
                            取り消す
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <details className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <summary className="cursor-pointer text-xs font-medium text-slate-700">
            メンバーへの案内文（コピー用）
          </summary>
          <div className="mt-3">
            <textarea
              readOnly
              rows={5}
              value={INVITE_TEMPLATE}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800"
            />
            <p className="mt-1.5 text-[11px] text-slate-500">
              「{"{あなたのコード}"}」は、上の一覧のコードに手で置き換えてから送ってください。
            </p>
          </div>
        </details>
      </section>
    </div>
  );
}

export default AdminLineLinkSection;
