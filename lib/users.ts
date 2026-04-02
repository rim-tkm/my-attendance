import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import path from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";

export interface StoredUser {
  id: string;
  loginId: string;
  name: string;
  passwordHash: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

function loadUsers(): StoredUser[] {
  try {
    if (existsSync(USERS_FILE)) {
      const json = readFileSync(USERS_FILE, "utf-8");
      return JSON.parse(json);
    }
  } catch {
    // ignore
  }
  return [];
}

function saveUsers(users: StoredUser[]): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
}

export async function verifyUser(
  loginId: string,
  password: string
): Promise<{ id: string; loginId: string; name: string } | null> {
  const users = loadUsers();
  const user = users.find(
    (u) => u.loginId.toLowerCase().trim() === loginId.toLowerCase().trim()
  );
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  return { id: user.id, loginId: user.loginId, name: user.name };
}

export function getUserById(id: string): StoredUser | undefined {
  return loadUsers().find((u) => u.id === id);
}

/** 一覧用（パスワードなし） */
export function listUsers(): { id: string; loginId: string; name: string }[] {
  return loadUsers().map(({ id, loginId, name }) => ({ id, loginId, name }));
}

/** 新規ユーザー追加。重複 loginId の場合はエラー。 */
export async function addUser(
  loginId: string,
  name: string,
  password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const users = loadUsers();
  const normalized = loginId.trim().toLowerCase();
  if (users.some((u) => u.loginId.toLowerCase() === normalized)) {
    return { ok: false, error: "このログインIDは既に使用されています" };
  }
  const id = randomUUID();
  const passwordHash = await bcrypt.hash(password, 10);
  users.push({ id, loginId: loginId.trim(), name: name.trim(), passwordHash });
  saveUsers(users);
  return { ok: true };
}
