import type { OpenRecord } from "@/lib/attendance";

const storageKey = (userId: string) => `my-attendance_open_record_backup:v1:${userId}`;

function isValidOpenRecord(v: unknown): v is OpenRecord {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.userId === "string" &&
    typeof o.startRaw === "string" &&
    typeof o.startRounded === "string" &&
    typeof o.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(o.date)
  );
}

/** ブラウザに未終了打刻をバックアップ（タブ切断・通信不安定時の復元用） */
export function persistOpenRecordClientBackup(userId: string, record: OpenRecord | null): void {
  if (typeof window === "undefined") return;
  const k = storageKey(userId);
  if (record == null) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
    return;
  }
  if (record.userId !== userId) return;
  try {
    localStorage.setItem(k, JSON.stringify(record));
  } catch (e) {
    console.warn("[open-record-client-backup] localStorage.setItem failed:", e);
  }
}

export function readOpenRecordClientBackup(userId: string): OpenRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidOpenRecord(parsed) || parsed.userId !== userId) return null;
    return parsed;
  } catch {
    return null;
  }
}
