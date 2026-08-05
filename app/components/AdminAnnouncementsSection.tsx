"use client";

import { useCallback, useEffect, useState } from "react";
import {
  announcementTargetLabel,
  sortAnnouncementsNewestFirst,
  type Announcement,
  type AnnouncementTarget,
} from "@/lib/announcements";

export type AdminAnnouncementRow = Announcement & {
  targetCount: number;
  confirmedCount: number;
  unconfirmedMembers: { id: string; name: string }[];
};

export type AdminAnnouncementsState = {
  rows: AdminAnnouncementRow[];
  busy: boolean;
  error: string | null;
  /** 公開中の必読で、未確認者が残っている件数（左メニューのバッジ用） */
  unconfirmedCount: number;
  reload: () => Promise<void>;
  create: (input: { title: string; body: string; target: AnnouncementTarget; isRequired: boolean }) => Promise<boolean>;
  update: (
    id: string,
    input: {
      title?: string;
      body?: string;
      target?: AnnouncementTarget;
      isRequired?: boolean;
      isPublished?: boolean;
      requireReconfirm?: boolean;
    }
  ) => Promise<boolean>;
};

export function useAdminAnnouncements(enabled: boolean): AdminAnnouncementsState {
  const [rows, setRows] = useState<AdminAnnouncementRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) {
      setRows([]);
      return;
    }
    try {
      const res = await fetch("/api/admin/announcements", { credentials: "include" });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; announcements?: AdminAnnouncementRow[] }
        | null;
      if (!res.ok || !data?.ok || !Array.isArray(data.announcements)) {
        setRows([]);
        return;
      }
      setRows(data.announcements);
    } catch {
      setRows([]);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create: AdminAnnouncementsState["create"] = useCallback(
    async (input) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/announcements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(input),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(data.error || "登録に失敗しました");
          return false;
        }
        await reload();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload]
  );

  const update: AdminAnnouncementsState["update"] = useCallback(
    async (id, input) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/announcements/${encodeURIComponent(id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(input),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(data.error || "更新に失敗しました");
          return false;
        }
        await reload();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload]
  );

  const unconfirmedCount = rows.filter(
    (r) => r.isPublished && r.isRequired && r.unconfirmedMembers.length > 0
  ).length;

  return { rows, busy, error, unconfirmedCount, reload, create, update };
}

export function AdminAnnouncementsSection({ state }: { state: AdminAnnouncementsState }) {
  const { rows, busy, error, create, update } = state;
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [target, setTarget] = useState<AnnouncementTarget>("all");
  const [isRequired, setIsRequired] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editReconfirm, setEditReconfirm] = useState(true);

  const list = sortAnnouncementsNewestFirst(rows) as AdminAnnouncementRow[];

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">お知らせを作成</h2>
        <p className="mb-3 text-xs text-slate-500">
          「必読」はメンバーが確認するまで稼働開始・シフト提出ができなくなります。
        </p>
        {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
        <div className="space-y-3">
          <label className="block text-xs font-medium text-slate-700">
            タイトル
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
              placeholder="例：8月の稼働について"
            />
          </label>
          <label className="block text-xs font-medium text-slate-700">
            本文
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
              placeholder="改行はそのまま表示されます。"
            />
          </label>
          <div className="flex flex-wrap items-end gap-4">
            <label className="block text-xs font-medium text-slate-700">
              宛先
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value as AnnouncementTarget)}
                className="mt-1 block rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
              >
                <option value="all">全員</option>
                <option value="contractor">業務委託のみ</option>
                <option value="intern">インターンのみ</option>
              </select>
            </label>
            <div className="text-xs font-medium text-slate-700">
              種別
              <div className="mt-1 flex gap-3">
                <label className="flex items-center gap-1.5 text-xs font-normal">
                  <input type="radio" checked={isRequired} onChange={() => setIsRequired(true)} />
                  必読（稼働をブロック）
                </label>
                <label className="flex items-center gap-1.5 text-xs font-normal">
                  <input type="radio" checked={!isRequired} onChange={() => setIsRequired(false)} />
                  お知らせのみ
                </label>
              </div>
            </div>
            <button
              type="button"
              disabled={busy || title.trim() === "" || body.trim() === ""}
              onClick={async () => {
                if (!window.confirm(`このお知らせを${isRequired ? "「必読」として" : ""}公開しますか？`)) return;
                const ok = await create({ title: title.trim(), body: body.trim(), target, isRequired });
                if (ok) {
                  setTitle("");
                  setBody("");
                  setTarget("all");
                  setIsRequired(true);
                }
              }}
              className="rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              公開する
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">登録済みのお知らせ</h2>
        {list.length === 0 ? (
          <p className="text-sm text-slate-600">まだお知らせはありません。</p>
        ) : (
          <div className="space-y-3">
            {list.map((a) => (
              <div key={a.id} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  {a.isRequired ? (
                    <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">必読</span>
                  ) : (
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">お知らせ</span>
                  )}
                  <span className="rounded bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-800">
                    {announcementTargetLabel(a.target)}
                  </span>
                  {!a.isPublished && (
                    <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600">終了</span>
                  )}
                  <span className="text-[10px] text-slate-500">
                    確認済み {a.confirmedCount}/{a.targetCount}名
                  </span>
                </div>
                <p className="text-sm font-semibold text-slate-900">{a.title}</p>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{a.body}</p>

                {a.unconfirmedMembers.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-amber-700">
                      未確認 {a.unconfirmedMembers.length}名を表示
                    </summary>
                    <p className="mt-1 text-[11px] text-slate-600">
                      {a.unconfirmedMembers.map((m) => m.name).join("、")}
                    </p>
                  </details>
                )}

                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (editingId === a.id) {
                        setEditingId(null);
                        return;
                      }
                      setEditingId(a.id);
                      setEditTitle(a.title);
                      setEditBody(a.body);
                      setEditReconfirm(true);
                    }}
                    className="rounded border border-slate-300 px-3 py-1 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {editingId === a.id ? "編集を閉じる" : "編集"}
                  </button>
                  {a.isPublished && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        if (!window.confirm(`「${a.title}」を公開終了しますか？\n\nメンバーのお知らせタブには過去分として残ります。`)) return;
                        await update(a.id, { isPublished: false });
                      }}
                      className="rounded border border-amber-300 bg-amber-50 px-3 py-1 text-[11px] text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                    >
                      公開終了
                    </button>
                  )}
                </div>

                {editingId === a.id && (
                  <div className="mt-3 space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
                    <label className="block text-[11px] font-medium text-slate-700">
                      タイトル
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-900"
                      />
                    </label>
                    <label className="block text-[11px] font-medium text-slate-700">
                      本文
                      <textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        rows={5}
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-900"
                      />
                    </label>
                    <label className="flex items-start gap-2 text-[11px] text-slate-700">
                      <input
                        type="checkbox"
                        checked={editReconfirm}
                        onChange={(e) => setEditReconfirm(e.target.checked)}
                        className="mt-0.5 rounded border-slate-300"
                      />
                      <span>この変更をメンバーに再確認してもらう（確認済みの人も未確認に戻ります）</span>
                    </label>
                    <button
                      type="button"
                      disabled={busy || editTitle.trim() === "" || editBody.trim() === ""}
                      onClick={async () => {
                        const ok = await update(a.id, {
                          title: editTitle.trim(),
                          body: editBody.trim(),
                          requireReconfirm: editReconfirm,
                        });
                        if (ok) setEditingId(null);
                      }}
                      className="rounded bg-slate-800 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                    >
                      保存する
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
