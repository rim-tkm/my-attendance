"use client";

import { useEffect, useState } from "react";
import type { Announcement } from "@/lib/announcements";

/**
 * ログイン時に未確認のお知らせを1件ずつ全画面表示する。
 * 「必読」はチェック＋ボタンの2段階で確認するまで稼働開始・シフト提出ができない。
 */
export function AnnouncementGateModal(props: {
  announcement: Announcement;
  /** このお知らせを含む未確認の残り件数 */
  remaining: number;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { announcement, remaining, busy, error, onConfirm, onClose } = props;
  const [agreed, setAgreed] = useState(false);

  // 次のお知らせに進んだらチェックを外す
  useEffect(() => {
    setAgreed(false);
  }, [announcement.id, announcement.version]);

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-900/60 p-4 print:hidden">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-xl sm:p-6">
        <div className="mb-2 flex items-center gap-2">
          {announcement.isRequired ? (
            <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">必読</span>
          ) : (
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">お知らせ</span>
          )}
          {remaining > 1 && (
            <span className="text-[11px] text-slate-500">ほか {remaining - 1} 件</span>
          )}
        </div>
        <h2 className="mb-3 text-base font-semibold text-slate-900">{announcement.title}</h2>
        <div className="mb-4 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-800">
          {announcement.body}
        </div>

        {announcement.isRequired && (
          <p className="mb-3 text-[11px] leading-relaxed text-red-700">
            このお知らせを確認するまで、稼働開始とシフト提出はできません。
          </p>
        )}

        <label className="mb-3 flex cursor-pointer items-start gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 rounded border-slate-300"
          />
          <span>上記の内容を確認し理解しました</span>
        </label>

        {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={!agreed || busy}
            onClick={onConfirm}
            className="w-full rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "記録中…" : "確認しました"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            あとで読む
          </button>
        </div>
      </div>
    </div>
  );
}
