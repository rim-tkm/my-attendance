"use client";

import { useCallback, useEffect, useState } from "react";
import {
  selectBlockingAnnouncements,
  selectUnreadForModal,
  type Announcement,
} from "@/lib/announcements";

export type MemberAnnouncementsState = {
  announcements: Announcement[];
  /** モーダルに出す未確認（必読・任意の両方）。古い順 */
  unreadForModal: Announcement[];
  /** 稼働をブロックする未確認の必読。古い順 */
  blocking: Announcement[];
  busy: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** 確認を記録する。成功なら true。失敗時は error に理由が入る */
  confirm: (announcement: Announcement) => Promise<boolean>;
};

/**
 * メンバー本人のお知らせを取得・確認するフック。
 * 取得に失敗しても空配列のままにする（fail-open）。一時的な通信障害で
 * 全員の稼働が止まる損害の方が大きいため、ブロックはしない。
 */
export function useMemberAnnouncements(userId: string | null, enabled: boolean): MemberAnnouncementsState {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!userId || !enabled) {
      setAnnouncements([]);
      return;
    }
    try {
      const res = await fetch("/api/member/announcements", { credentials: "include" });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; announcements?: Announcement[] }
        | null;
      if (!res.ok || !data?.ok || !Array.isArray(data.announcements)) {
        setAnnouncements([]);
        return;
      }
      // 壊れた要素が1つでも混じるとレンダー中の選別で例外になり画面が白くなるため、
      // オブジェクト以外は捨てる（fail-open を全経路で守る）
      setAnnouncements(data.announcements.filter((a) => a != null && typeof a === "object"));
    } catch {
      setAnnouncements([]);
    }
  }, [userId, enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const confirm = useCallback(
    async (announcement: Announcement): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/member/announcements/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ announcementId: announcement.id, version: announcement.version }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(data.error || "確認の記録に失敗しました。通信環境を確認してもう一度お試しください。");
          // 409(版ずれ)だけでなく 403(対象外になった)・404(削除された)でも再取得する。
          // 再取得しないと、確認できないお知らせが一覧に残り続けて稼働が永久にブロックされる。
          if (res.status === 409 || res.status === 403 || res.status === 404) {
            await reload();
            // 再取得で最新の内容に置き換わったので、前の版に対するエラー表示は消す
            setError(null);
          }
          return false;
        }
        await reload();
        return true;
      } catch {
        setError("確認の記録に失敗しました。通信環境を確認してもう一度お試しください。");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload]
  );

  return {
    announcements,
    unreadForModal: selectUnreadForModal(announcements),
    blocking: selectBlockingAnnouncements(announcements),
    busy,
    error,
    reload,
    confirm,
  };
}
