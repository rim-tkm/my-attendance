import type { Member } from "@/lib/attendance";

/** お知らせの宛先区分 */
export type AnnouncementTarget = "all" | "contractor" | "intern";

/** メンバーに渡すお知らせ1件（readAt は「現在の版に対する本人の確認日時」） */
export type Announcement = {
  id: string;
  title: string;
  body: string;
  target: AnnouncementTarget;
  isRequired: boolean;
  isPublished: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** 現在の version を確認済みならその日時。未確認は null */
  readAt: string | null;
};

/** announcements テーブルの行 */
export type DbAnnouncement = {
  id: string;
  title: string | null;
  body: string | null;
  target: string | null;
  is_required: boolean | null;
  is_published: boolean | null;
  version: number | null;
  created_at: string;
  updated_at: string;
};

export function normalizeAnnouncementTarget(raw: string | null | undefined): AnnouncementTarget {
  const t = String(raw ?? "").trim();
  return t === "contractor" || t === "intern" ? t : "all";
}

export function toAnnouncement(r: DbAnnouncement, readAt: string | null): Announcement {
  return {
    id: r.id,
    title: r.title ?? "",
    body: r.body ?? "",
    target: normalizeAnnouncementTarget(r.target),
    isRequired: r.is_required !== false,
    isPublished: r.is_published !== false,
    version: typeof r.version === "number" && Number.isFinite(r.version) ? r.version : 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    readAt,
  };
}

/**
 * お知らせの宛先に含まれるメンバーか。
 * 管理者アカウントと無効化済みメンバーは、区分にかかわらず常に対象外。
 */
export function isAnnouncementTargetedAt(
  target: AnnouncementTarget,
  member: Pick<Member, "isIntern" | "isActive" | "loginAccount">
): boolean {
  if (member.isActive === false) return false;
  if ((member.loginAccount ?? "").trim().toLowerCase() === "admin") return false;
  if (target === "all") return true;
  if (target === "intern") return member.isIntern === true;
  return member.isIntern !== true;
}

/**
 * ログイン時モーダルに出す未確認のお知らせ（必読・お知らせのみの両方）。
 * 出した順に読ませるため古い順で返す。公開終了したものは出さない。
 */
export function selectUnreadForModal(list: Announcement[]): Announcement[] {
  return list
    .filter((a) => a.isPublished && a.readAt == null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** 本人が現在の版をまだ確認していないか */
export function isAnnouncementUnread(a: Announcement): boolean {
  return a.readAt == null;
}

/** 稼働（稼働開始・シフト保存）をブロックする未確認の必読お知らせ。古い順 */
export function selectBlockingAnnouncements(list: Announcement[]): Announcement[] {
  return selectUnreadForModal(list).filter((a) => a.isRequired);
}

/** お知らせタブの表示順（新しい順）。元配列は破壊しない */
export function sortAnnouncementsNewestFirst(list: Announcement[]): Announcement[] {
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 宛先の表示名（管理画面の一覧・作成フォーム用） */
export function announcementTargetLabel(target: AnnouncementTarget): string {
  if (target === "contractor") return "業務委託のみ";
  if (target === "intern") return "インターンのみ";
  return "全員";
}
