function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * 稼働日 YYYY-MM-DD と HH:mm（日本時間の壁時計）から `Date` を返す。
 */
export function parseStartInstantJstOnWorkDate(workDateYmd: string, hhmm: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  const parts = workDateYmd.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, M, d] = parts as [number, number, number];
  const iso = `${y}-${pad2(M)}-${pad2(d)}T${pad2(h)}:${pad2(min)}:00+09:00`;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** UTC の瞬間を日本の暦日 YYYY-MM-DD に射影 */
export function formatYmdJst(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
