"use client";

import { useState } from "react";
import { isAnnouncementUnread, sortAnnouncementsNewestFirst, type Announcement } from "@/lib/announcements";

function formatReadAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

/** 過去のお知らせを読み返すタブ。未確認の必読はここからも確認できる */
export function AnnouncementsTab(props: {
  announcements: Announcement[];
  busy: boolean;
  error: string | null;
  onConfirm: (announcement: Announcement) => void;
}) {
  const { announcements, busy, error, onConfirm } = props;
  const [agreedIds, setAgreedIds] = useState<string[]>([]);
  const rows = sortAnnouncementsNewestFirst(announcements);

  if (rows.length === 0) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-600">お知らせはまだありません。</p>
      </section>
    );
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-red-600">{error}</p>}
      {rows.map((a) => {
        const unread = isAnnouncementUnread(a);
        const agreed = agreedIds.includes(`${a.id}:${a.version}`);
        return (
          <section key={a.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              {a.isRequired ? (
                <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">必読</span>
              ) : (
                <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">お知らせ</span>
              )}
              {unread ? (
                <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white">未確認</span>
              ) : (
                <span className="text-[10px] text-slate-500">確認済み {formatReadAt(a.readAt ?? "")}</span>
              )}
              {!a.isPublished && (
                <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600">終了</span>
              )}
            </div>
            <details open={unread}>
              <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900">
                {a.title}
              </summary>
              <div className="mt-2 whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-800">
                {a.body}
              </div>
              {unread && a.isPublished && (
                <div className="mt-3">
                  <label className="mb-2 flex cursor-pointer items-start gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) =>
                        setAgreedIds((prev) =>
                          e.target.checked
                            ? [...prev, `${a.id}:${a.version}`]
                            : prev.filter((k) => k !== `${a.id}:${a.version}`)
                        )
                      }
                      className="mt-0.5 rounded border-slate-300"
                    />
                    <span>上記の内容を確認し理解しました</span>
                  </label>
                  <button
                    type="button"
                    disabled={!agreed || busy}
                    onClick={() => onConfirm(a)}
                    className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy ? "記録中…" : "確認しました"}
                  </button>
                </div>
              )}
            </details>
          </section>
        );
      })}
    </div>
  );
}
