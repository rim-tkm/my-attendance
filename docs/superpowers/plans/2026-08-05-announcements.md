# お知らせ機能 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理者が登録したお知らせをメンバーのログイン時に必ず表示し、「必読」を確認したメンバーだけが稼働開始・シフト提出できるようにする。確認記録を残し、過去のお知らせをいつでも読み返せるようにする。

**Architecture:** 新規テーブル2つ（`announcements` / `announcement_reads`）を service_role 経由のサーバーAPIだけで読み書きする（公開 anon キーからは一切アクセス不可）。宛先判定・未確認判定は `lib/announcements.ts` の純粋関数に切り出し、単体で検証できるようにする。UI は `app/components/` に3ファイル＋フック2つとして切り出し、巨大な `app/page.tsx` には状態の配線とゲート条件だけを足す。

**Tech Stack:** Next.js 14 App Router / React 18 / TypeScript 5 / Tailwind / Supabase (`@supabase/supabase-js`, service_role) / NextAuth

**設計書:** `docs/superpowers/specs/2026-08-05-announcements-design.md`

**このリポジトリの前提（重要）:**
- **自動テストのフレームワークは無い**（jest/vitest/playwright なし）。品質ゲートは `npx tsc --noEmit` ＋ `npm run build` ＋ 手動確認。
- 純粋ロジックは **`npx tsx` で実行する検証スクリプト**で確かめる（本リポジトリの既存プラクティス）。
- 検証スクリプトの置き場（このセッションの scratchpad。以下 `$SCRATCH` と表記）:
  `/private/tmp/claude-501/-Users-takuma-Desktop-my-attendance/e91ed0ea-7035-495e-8bd7-ab9214b5e716/scratchpad`
- `Set` のスプレッド展開（`[...set]`）はビルドエラーになる。必ず `Array.from(set)` を使う。
- コミットメッセージ末尾に必ず `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` を付ける。
- push = 本番デプロイ。各タスクの最後に `npx tsc --noEmit` と `npm run build` を通してから push する。

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `supabase-migration-announcements.sql` | 新規テーブル2つの定義（ユーザーが Supabase SQL Editor で実行） |
| `lib/announcements.ts` | 型・DB行の変換・宛先判定・未確認判定（純粋関数のみ。React も Supabase も import しない） |
| `app/api/member/announcements/route.ts` | GET: 本人が対象のお知らせ一覧（確認日時付き） |
| `app/api/member/announcements/read/route.ts` | POST: 本人の確認を記録 |
| `app/api/admin/announcements/route.ts` | GET: 全お知らせ＋確認状況 / POST: 新規作成 |
| `app/api/admin/announcements/[id]/route.ts` | POST: 編集・公開終了（再確認なら版数を上げる） |
| `app/components/useMemberAnnouncements.ts` | メンバー側の取得・確認フック（失敗時は空配列＝稼働を止めない） |
| `app/components/AnnouncementGateModal.tsx` | ログイン時の全画面お知らせモーダル |
| `app/components/AnnouncementsTab.tsx` | メンバーの「お知らせ」タブ（過去分の読み返し） |
| `app/components/AdminAnnouncementsSection.tsx` | 管理画面の「お知らせ」セクション＋`useAdminAnnouncements` フック |
| `app/page.tsx` | 配線のみ（タブ追加・ゲート条件・稼働ブロック・管理ナビ4点セット） |

---

## Task 1: SQL とロジック（`lib/announcements.ts`）

**Files:**
- Create: `supabase-migration-announcements.sql`
- Create: `lib/announcements.ts`
- Verify: `$SCRATCH/verify-announcements.ts`

- [ ] **Step 1: マイグレーション SQL を作る**

Create `supabase-migration-announcements.sql`:

```sql
-- お知らせ機能。管理者が登録したお知らせをメンバーのログイン時に表示し、
-- 「必読」は確認するまで稼働開始・シフト提出をブロックする。
--
-- 実行後、PostgREST のスキーマキャッシュを更新すること:
--   Supabase ダッシュボード → Project Settings → API →「Reload schema」
--   または SQL エディタで: NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT 'all' CHECK (target IN ('all', 'contractor', 'intern')),
  is_required BOOLEAN NOT NULL DEFAULT true,
  is_published BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_announcements_published
  ON public.announcements(is_published, created_at DESC);

-- 確認記録。(お知らせ, ユーザー, 版数) で一意。版数が上がると再確認が必要になる。
CREATE TABLE IF NOT EXISTS public.announcement_reads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, user_id, version)
);

CREATE INDEX IF NOT EXISTS idx_announcement_reads_user
  ON public.announcement_reads(user_id);

-- RLS は有効化するがポリシーを作らない = 公開 anon キーからは一切アクセス不可。
-- サーバー（service_role）経由のみ。users の RLS 締め（2026-08-05）と同じ方針。
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_reads ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: 検証スクリプトを先に書く（この時点では失敗する）**

Create `$SCRATCH/verify-announcements.ts`:

```ts
/* お知らせ機能の純粋ロジック検証（実装を直接 import） */
import {
  isAnnouncementTargetedAt,
  isAnnouncementUnread,
  selectUnreadForModal,
  selectBlockingAnnouncements,
  sortAnnouncementsNewestFirst,
  normalizeAnnouncementTarget,
  toAnnouncement,
  type Announcement,
} from "/Users/takuma/Desktop/my-attendance/lib/announcements";

let pass = 0;
let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.error(`❌ ${label}: got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`);
  }
}

// --- 宛先判定 ---
const contractor = { isIntern: false, isActive: true, loginAccount: "taro@example.com" };
const intern = { isIntern: true, isActive: true, loginAccount: "hanako@example.com" };
const admin = { isIntern: false, isActive: true, loginAccount: "admin" };
const inactive = { isIntern: false, isActive: false, loginAccount: "old@example.com" };

eq("all→業務委託", isAnnouncementTargetedAt("all", contractor), true);
eq("all→インターン", isAnnouncementTargetedAt("all", intern), true);
eq("all→管理者は対象外", isAnnouncementTargetedAt("all", admin), false);
eq("all→無効化は対象外", isAnnouncementTargetedAt("all", inactive), false);
eq("contractor→業務委託", isAnnouncementTargetedAt("contractor", contractor), true);
eq("contractor→インターンは対象外", isAnnouncementTargetedAt("contractor", intern), false);
eq("intern→インターン", isAnnouncementTargetedAt("intern", intern), true);
eq("intern→業務委託は対象外", isAnnouncementTargetedAt("intern", contractor), false);
eq("isIntern未設定は業務委託扱い", isAnnouncementTargetedAt("contractor", { isActive: true, loginAccount: "x@y.z" }), true);
eq("大文字ADMINも対象外", isAnnouncementTargetedAt("all", { isIntern: false, isActive: true, loginAccount: "ADMIN" }), false);

// --- target の正規化 ---
eq("不正な target は all", normalizeAnnouncementTarget("bogus"), "all");
eq("null は all", normalizeAnnouncementTarget(null), "all");
eq("intern はそのまま", normalizeAnnouncementTarget("intern"), "intern");

// --- DB行の変換 ---
const row = {
  id: "a1", title: "T", body: "B", target: "contractor",
  is_required: true, is_published: true, version: 2,
  created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-02T00:00:00Z",
};
eq("変換: 未確認は readAt=null", toAnnouncement(row, null).readAt, null);
eq("変換: 版数", toAnnouncement(row, null).version, 2);
eq("変換: isRequired", toAnnouncement(row, null).isRequired, true);

// --- 未確認の選別 ---
function mk(over: Partial<Announcement>): Announcement {
  return {
    id: "x", title: "t", body: "b", target: "all",
    isRequired: true, isPublished: true, version: 1,
    createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z",
    readAt: null,
    ...over,
  };
}

const list: Announcement[] = [
  mk({ id: "new-required-unread", createdAt: "2026-08-03T00:00:00Z" }),
  mk({ id: "old-required-unread", createdAt: "2026-08-01T00:00:00Z" }),
  mk({ id: "optional-unread", isRequired: false, createdAt: "2026-08-02T00:00:00Z" }),
  mk({ id: "required-read", readAt: "2026-08-04T00:00:00Z", createdAt: "2026-08-01T12:00:00Z" }),
  mk({ id: "unpublished-unread", isPublished: false, createdAt: "2026-08-01T06:00:00Z" }),
];

eq(
  "モーダル対象: 公開中の未確認を古い順（必読・任意の両方）",
  selectUnreadForModal(list).map((a) => a.id),
  ["old-required-unread", "optional-unread", "new-required-unread"]
);
eq(
  "ブロック対象: 必読のみを古い順",
  selectBlockingAnnouncements(list).map((a) => a.id),
  ["old-required-unread", "new-required-unread"]
);
eq("公開終了はブロックしない", selectBlockingAnnouncements(list).some((a) => a.id === "unpublished-unread"), false);
eq("確認済みはブロックしない", selectBlockingAnnouncements(list).some((a) => a.id === "required-read"), false);
eq("空配列", selectBlockingAnnouncements([]).length, 0);
eq("未確認判定: readAt=null は未確認", isAnnouncementUnread(mk({ readAt: null })), true);
eq("未確認判定: readAt ありは確認済み", isAnnouncementUnread(mk({ readAt: "2026-08-04T00:00:00Z" })), false);

// --- 版が上がると未確認に戻る（readAt は現 version の確認日時なので null になる） ---
const bumped = mk({ id: "bumped", version: 2, readAt: null });
eq("版が上がった直後はブロック対象", selectBlockingAnnouncements([bumped]).map((a) => a.id), ["bumped"]);

// --- タブの並び（新しい順） ---
eq(
  "タブ: 新しい順",
  sortAnnouncementsNewestFirst(list).map((a) => a.id),
  ["new-required-unread", "optional-unread", "required-read", "unpublished-unread", "old-required-unread"]
);
eq("元配列を破壊しない", list[0].id, "new-required-unread");

console.log(`\n結果: ${pass} passed / ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 3: 検証スクリプトを実行して失敗することを確認**

Run:
```bash
npx tsx "/private/tmp/claude-501/-Users-takuma-Desktop-my-attendance/e91ed0ea-7035-495e-8bd7-ab9214b5e716/scratchpad/verify-announcements.ts"
```
Expected: `Cannot find module` 系のエラーで失敗（`lib/announcements.ts` が未作成のため）

- [ ] **Step 4: `lib/announcements.ts` を実装**

Create `lib/announcements.ts`:

```ts
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
  created_at: string | null;
  updated_at: string | null;
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
    createdAt: r.created_at ?? "",
    updatedAt: r.updated_at ?? "",
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

/** 本人が現在の version をまだ確認していないか */
export function isAnnouncementUnread(a: Announcement): boolean {
  return a.readAt == null;
}

/**
 * ログイン時モーダルに出す未確認のお知らせ（必読・お知らせのみの両方）。
 * 出した順に読ませるため古い順で返す。公開終了したものは出さない。
 * 作成日時が同値のときも表示順が安定するよう id を第2キーにする。
 */
export function selectUnreadForModal(list: Announcement[]): Announcement[] {
  return list
    .filter((a) => a.isPublished && isAnnouncementUnread(a))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** 稼働（稼働開始・シフト保存）をブロックする未確認の必読お知らせ。古い順 */
export function selectBlockingAnnouncements(list: Announcement[]): Announcement[] {
  return selectUnreadForModal(list).filter((a) => a.isRequired);
}

/**
 * お知らせタブの表示順（新しい順）。元配列は破壊しない。
 * 作成日時が同値のときも表示順が安定するよう id を第2キーにする。
 */
export function sortAnnouncementsNewestFirst(list: Announcement[]): Announcement[] {
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

/** 宛先の表示名（管理画面の一覧・作成フォーム用） */
export function announcementTargetLabel(target: AnnouncementTarget): string {
  if (target === "contractor") return "業務委託のみ";
  if (target === "intern") return "インターンのみ";
  return "全員";
}
```

- [ ] **Step 5: 検証スクリプトを実行して全件成功を確認**

Run:
```bash
npx tsx "/private/tmp/claude-501/-Users-takuma-Desktop-my-attendance/e91ed0ea-7035-495e-8bd7-ab9214b5e716/scratchpad/verify-announcements.ts"
```
Expected: `結果: 26 passed / 0 failed`（失敗が出たら実装を直す。スクリプトを緩めない）

- [ ] **Step 6: 型チェックとビルド**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: 型エラーなし／`✓ Compiled successfully`

- [ ] **Step 7: コミット**

```bash
git add -A && git commit -m "feat(お知らせ): テーブル定義と判定ロジックを追加

announcements / announcement_reads の2テーブル（RLSはポリシーなし＝
サーバー経由のみ）と、宛先判定・未確認判定・並び順の純粋関数を追加。
検証スクリプトで26件のケースを確認済み。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" && git push origin main
```

- [ ] **Step 8: ユーザーに SQL 実行を依頼**

`supabase-migration-announcements.sql` の全文を提示し、Supabase の SQL Editor で実行してもらう。
実行後、`NOTIFY pgrst, 'reload schema';` も必要なことを伝える。
**このタスクの完了報告時に必ず伝える**（未実行でも後続タスクは fail-open のため進められる）。

---

## Task 2: メンバー向け API

**Files:**
- Create: `app/api/member/announcements/route.ts`
- Create: `app/api/member/announcements/read/route.ts`

- [ ] **Step 1: 一覧取得 API を作る**

Create `app/api/member/announcements/route.ts`:

```ts
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  isAnnouncementTargetedAt,
  normalizeAnnouncementTarget,
  toAnnouncement,
  type DbAnnouncement,
} from "@/lib/announcements";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * ログイン中メンバーが対象のお知らせ一覧（公開中・終了の両方）を新しい順で返す。
 * readAt は「現在の版に対する本人の確認日時」。未確認は null。
 * announcements テーブルは RLS でポリシーを持たないため service_role でのみ読める。
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY が未設定です" }, { status: 500 });
  }

  const { data: meRow, error: meErr } = await supabase
    .from("users")
    .select("is_intern, is_active, login_account")
    .eq("id", userId)
    .maybeSingle();
  if (meErr) {
    return NextResponse.json({ ok: false, error: meErr.message }, { status: 500 });
  }
  if (!meRow) {
    return NextResponse.json({ ok: false, error: "メンバーが見つかりません" }, { status: 404 });
  }
  const member = {
    isIntern: meRow.is_intern === true,
    isActive: meRow.is_active !== false,
    loginAccount: (meRow.login_account as string | null) ?? "",
  };

  const [{ data: rows, error: listErr }, { data: readRows, error: readErr }] = await Promise.all([
    supabase.from("announcements").select("*").order("created_at", { ascending: false }),
    supabase.from("announcement_reads").select("announcement_id, version, read_at").eq("user_id", userId),
  ]);
  if (listErr) {
    return NextResponse.json({ ok: false, error: listErr.message }, { status: 500 });
  }
  if (readErr) {
    return NextResponse.json({ ok: false, error: readErr.message }, { status: 500 });
  }

  const readMap = new Map<string, string>();
  for (const r of (readRows ?? []) as { announcement_id: string; version: number; read_at: string }[]) {
    readMap.set(`${r.announcement_id}\t${r.version}`, r.read_at);
  }

  const announcements = ((rows as DbAnnouncement[]) ?? [])
    .filter((r) => isAnnouncementTargetedAt(normalizeAnnouncementTarget(r.target), member))
    .map((r) => toAnnouncement(r, readMap.get(`${r.id}\t${r.version ?? 1}`) ?? null));

  return NextResponse.json({ ok: true, announcements });
}
```

- [ ] **Step 2: 確認記録 API を作る**

Create `app/api/member/announcements/read/route.ts`:

```ts
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { isAnnouncementTargetedAt, normalizeAnnouncementTarget } from "@/lib/announcements";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * 本人によるお知らせ確認の記録。
 * - 宛先に含まれない人からの確認は 403（画面を回避した経路も塞ぐ）
 * - 送られた版数が最新でなければ 409（編集直後の競合。クライアントは再取得する）
 * - 二重送信（一意制約違反）は成功として扱う
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "不正な JSON です" }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;
  const announcementId = typeof o.announcementId === "string" ? o.announcementId.trim() : "";
  const version =
    typeof o.version === "number" && Number.isFinite(o.version) ? Math.floor(o.version) : NaN;
  if (!announcementId || !Number.isFinite(version)) {
    return NextResponse.json({ ok: false, error: "announcementId と version が必要です" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY が未設定です" }, { status: 500 });
  }

  const [{ data: annRow, error: annErr }, { data: meRow, error: meErr }] = await Promise.all([
    supabase.from("announcements").select("id, target, version").eq("id", announcementId).maybeSingle(),
    supabase.from("users").select("is_intern, is_active, login_account").eq("id", userId).maybeSingle(),
  ]);
  if (annErr) {
    return NextResponse.json({ ok: false, error: annErr.message }, { status: 500 });
  }
  if (meErr) {
    return NextResponse.json({ ok: false, error: meErr.message }, { status: 500 });
  }
  if (!annRow) {
    return NextResponse.json({ ok: false, error: "お知らせが見つかりません" }, { status: 404 });
  }
  if (!meRow) {
    return NextResponse.json({ ok: false, error: "メンバーが見つかりません" }, { status: 404 });
  }

  const targeted = isAnnouncementTargetedAt(normalizeAnnouncementTarget(annRow.target as string | null), {
    isIntern: meRow.is_intern === true,
    isActive: meRow.is_active !== false,
    loginAccount: (meRow.login_account as string | null) ?? "",
  });
  if (!targeted) {
    return NextResponse.json({ ok: false, error: "このお知らせの対象ではありません" }, { status: 403 });
  }

  const currentVersion = typeof annRow.version === "number" ? annRow.version : 1;
  if (currentVersion !== version) {
    return NextResponse.json(
      { ok: false, error: "お知らせが更新されています。最新の内容を確認してください。", currentVersion },
      { status: 409 }
    );
  }

  const { error: insErr } = await supabase.from("announcement_reads").insert({
    announcement_id: announcementId,
    user_id: userId,
    version: currentVersion,
  });
  if (insErr && !/duplicate key|unique|23505/i.test(insErr.message ?? "")) {
    return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: 型チェックとビルド**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: 型エラーなし／`✓ Compiled successfully`

- [ ] **Step 4: 未認証で 401 が返ることを確認**

Run（ローカルの dev サーバーは使わず、ビルド済みの本番で確認する。push 後に実行）:
```bash
curl -s -o /dev/null -w "GET  %{http_code}\n" https://my-attendance-rho.vercel.app/api/member/announcements
curl -s -o /dev/null -w "POST %{http_code}\n" -X POST https://my-attendance-rho.vercel.app/api/member/announcements/read \
  -H "Content-Type: application/json" -d '{"announcementId":"x","version":1}'
```
Expected: 両方とも `401`

- [ ] **Step 5: コミットして push（Step 4 の確認はこの後に実行）**

```bash
git add -A && git commit -m "feat(お知らせ): メンバー向けAPI（一覧取得・確認記録）を追加

一覧は本人が対象のものだけを service_role で取得し、現在の版に対する
確認日時を添えて返す。確認記録は宛先・版数をサーバー側で再検証し、
対象外は403・版ずれは409・二重送信は成功として扱う。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" && git push origin main
```

---

## Task 3: 管理者向け API

**Files:**
- Create: `app/api/admin/announcements/route.ts`
- Create: `app/api/admin/announcements/[id]/route.ts`

- [ ] **Step 1: 一覧＋作成 API を作る**

Create `app/api/admin/announcements/route.ts`:

```ts
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  isAnnouncementTargetedAt,
  normalizeAnnouncementTarget,
  toAnnouncement,
  type DbAnnouncement,
} from "@/lib/announcements";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

type DbUserRow = {
  id: string;
  name: string | null;
  is_intern: boolean | null;
  is_active: boolean | null;
  login_account: string | null;
};

/** 全お知らせに確認状況（対象人数・確認済み人数・未確認者）を添えて返す（管理者のみ） */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ ok: false, error: "管理者のみ利用できます" }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY が未設定です" }, { status: 500 });
  }

  const [{ data: rows, error: listErr }, { data: userRows, error: userErr }, { data: readRows, error: readErr }] =
    await Promise.all([
      supabase.from("announcements").select("*").order("created_at", { ascending: false }),
      supabase.from("users").select("id, name, is_intern, is_active, login_account"),
      supabase.from("announcement_reads").select("announcement_id, user_id, version"),
    ]);
  if (listErr) return NextResponse.json({ ok: false, error: listErr.message }, { status: 500 });
  if (userErr) return NextResponse.json({ ok: false, error: userErr.message }, { status: 500 });
  if (readErr) return NextResponse.json({ ok: false, error: readErr.message }, { status: 500 });

  const users = (userRows as DbUserRow[]) ?? [];
  const readKeys = new Set(
    ((readRows ?? []) as { announcement_id: string; user_id: string; version: number }[]).map(
      (r) => `${r.announcement_id}\t${r.user_id}\t${r.version}`
    )
  );

  const announcements = ((rows as DbAnnouncement[]) ?? []).map((r) => {
    const target = normalizeAnnouncementTarget(r.target);
    const version = typeof r.version === "number" ? r.version : 1;
    const targets = users.filter((u) =>
      isAnnouncementTargetedAt(target, {
        isIntern: u.is_intern === true,
        isActive: u.is_active !== false,
        loginAccount: u.login_account ?? "",
      })
    );
    const unconfirmedMembers = targets
      .filter((u) => !readKeys.has(`${r.id}\t${u.id}\t${version}`))
      .map((u) => ({ id: u.id, name: (u.name ?? "").trim() || "（名前なし）" }))
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));
    return {
      ...toAnnouncement(r, null),
      targetCount: targets.length,
      confirmedCount: targets.length - unconfirmedMembers.length,
      unconfirmedMembers,
    };
  });

  return NextResponse.json({ ok: true, announcements });
}

/** お知らせの新規作成（管理者のみ） */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ ok: false, error: "管理者のみ利用できます" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "不正な JSON です" }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  const text = typeof o.body === "string" ? o.body.trim() : "";
  if (!title) {
    return NextResponse.json({ ok: false, error: "タイトルを入力してください" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ ok: false, error: "本文を入力してください" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY が未設定です" }, { status: 500 });
  }

  const adminId = (session.user as { id?: string }).id ?? null;
  const { data, error } = await supabase
    .from("announcements")
    .insert({
      title,
      body: text,
      target: normalizeAnnouncementTarget(typeof o.target === "string" ? o.target : "all"),
      is_required: o.isRequired !== false,
      is_published: true,
      version: 1,
      created_by: adminId,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data?.id ?? null });
}
```

- [ ] **Step 2: 編集・公開終了 API を作る**

Create `app/api/admin/announcements/[id]/route.ts`:

```ts
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { normalizeAnnouncementTarget } from "@/lib/announcements";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

/**
 * お知らせの編集・公開終了（管理者のみ）。
 * requireReconfirm=true のとき版数を +1 し、確認済みのメンバーも未確認に戻す。
 */
export async function POST(req: Request, context: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ ok: false, error: "管理者のみ利用できます" }, { status: 403 });
  }
  const id = (context.params.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ ok: false, error: "ID が指定されていません" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "不正な JSON です" }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY が未設定です" }, { status: 500 });
  }

  const { data: current, error: selErr } = await supabase
    .from("announcements")
    .select("version")
    .eq("id", id)
    .maybeSingle();
  if (selErr) {
    return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 });
  }
  if (!current) {
    return NextResponse.json({ ok: false, error: "お知らせが見つかりません" }, { status: 404 });
  }
  const currentVersion = typeof current.version === "number" ? current.version : 1;
  const nextVersion = o.requireReconfirm === true ? currentVersion + 1 : currentVersion;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), version: nextVersion };
  if (typeof o.title === "string") {
    const t = o.title.trim();
    if (!t) return NextResponse.json({ ok: false, error: "タイトルを入力してください" }, { status: 400 });
    patch.title = t;
  }
  if (typeof o.body === "string") {
    const t = o.body.trim();
    if (!t) return NextResponse.json({ ok: false, error: "本文を入力してください" }, { status: 400 });
    patch.body = t;
  }
  if (typeof o.target === "string") patch.target = normalizeAnnouncementTarget(o.target);
  if (typeof o.isRequired === "boolean") patch.is_required = o.isRequired;
  if (typeof o.isPublished === "boolean") patch.is_published = o.isPublished;

  const { error: upErr } = await supabase.from("announcements").update(patch).eq("id", id);
  if (upErr) {
    return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, version: nextVersion });
}
```

- [ ] **Step 3: 型チェックとビルド**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: 型エラーなし／`✓ Compiled successfully`

- [ ] **Step 4: コミットして push**

```bash
git add -A && git commit -m "feat(お知らせ): 管理者向けAPI（一覧＋確認状況・作成・編集）を追加

一覧は各お知らせの対象人数・確認済み人数・未確認者名を計算して返す。
編集は requireReconfirm=true のとき版数を上げ、確認済みを未確認に戻す。
削除APIは用意せず、公開終了（is_published=false）で運用する。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" && git push origin main
```

- [ ] **Step 5: 未認証・非管理者で弾かれることを確認**

Run:
```bash
curl -s -o /dev/null -w "GET  %{http_code}\n" https://my-attendance-rho.vercel.app/api/admin/announcements
curl -s -o /dev/null -w "POST %{http_code}\n" -X POST https://my-attendance-rho.vercel.app/api/admin/announcements \
  -H "Content-Type: application/json" -d '{"title":"t","body":"b"}'
```
Expected: 両方とも `401`

---

## Task 4: メンバー側のフックとモーダル

**Files:**
- Create: `app/components/useMemberAnnouncements.ts`
- Create: `app/components/AnnouncementGateModal.tsx`
- Modify: `app/page.tsx`（import 追加・フック呼び出し・モーダル描画・月次確認の優先順位）

- [ ] **Step 1: 取得と確認のフックを作る**

Create `app/components/useMemberAnnouncements.ts`:

```ts
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
      setAnnouncements(data.announcements);
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
          if (res.status === 409) await reload();
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
```

- [ ] **Step 2: モーダルコンポーネントを作る**

Create `app/components/AnnouncementGateModal.tsx`:

```tsx
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
```

- [ ] **Step 3: `app/page.tsx` に import を追加**

`app/page.tsx` の import 群（`import { shiftHasPlannedWorkHours } from "@/lib/shift-planned-work";` の直後）に追加:

```ts
import { AnnouncementGateModal } from "@/app/components/AnnouncementGateModal";
import { useMemberAnnouncements } from "@/app/components/useMemberAnnouncements";
```

- [ ] **Step 4: `DashboardPage` にフックと表示状態を追加**

`app/page.tsx` の `// 打刻押し忘れロック（本人側）: 当月の押し忘れ回数と規約同意フローの状態` のブロックの直前に追加:

```ts
  // お知らせ（本人側）。取得失敗時は空配列＝稼働をブロックしない（fail-open）
  const memberAnnouncements = useMemberAnnouncements(currentUserId, !isAdminMode);
  const [announcementGateDismissed, setAnnouncementGateDismissed] = useState(false);
```

- [ ] **Step 5: 表示条件を追加し、月次確認より優先させる**

`app/page.tsx` の `const memberPunchMissAgreed = ...` の直後に追加:

```ts
  /** お知らせゲート。押し忘れロック中は出さない（ロック → お知らせ → 月次確認 の順） */
  const showAnnouncementGate =
    !isAdminMode &&
    !isAdminUser &&
    currentMember != null &&
    !memberPunchMissLocked &&
    !announcementGateDismissed &&
    memberAnnouncements.unreadForModal.length > 0;
```

続いて `const showMonthlyProfileConfirm =` の条件に `!showAnnouncementGate &&` を追加する。変更前:

```ts
  const showMonthlyProfileConfirm =
    !isAdminMode &&
    !isAdminUser &&
    currentMember != null &&
    !memberPunchMissLocked &&
    !profileConfirmDismissed &&
```

変更後:

```ts
  const showMonthlyProfileConfirm =
    !isAdminMode &&
    !isAdminUser &&
    currentMember != null &&
    !memberPunchMissLocked &&
    !showAnnouncementGate &&
    !profileConfirmDismissed &&
```

- [ ] **Step 6: モーダルを描画**

`app/page.tsx` の `{memberPunchMissLocked && currentMember && (` で始まるブロックの**直前**に追加:

```tsx
      {showAnnouncementGate && memberAnnouncements.unreadForModal[0] && (
        <AnnouncementGateModal
          announcement={memberAnnouncements.unreadForModal[0]}
          remaining={memberAnnouncements.unreadForModal.length}
          busy={memberAnnouncements.busy}
          error={memberAnnouncements.error}
          onConfirm={() => {
            void memberAnnouncements.confirm(memberAnnouncements.unreadForModal[0]);
          }}
          onClose={() => setAnnouncementGateDismissed(true)}
        />
      )}
```

- [ ] **Step 7: 型チェックとビルド**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: 型エラーなし／`✓ Compiled successfully`

- [ ] **Step 8: コミットして push**

```bash
git add -A && git commit -m "feat(お知らせ): ログイン時の全画面モーダルを追加

未確認のお知らせを古い順に1件ずつ表示し、チェック＋ボタンの2段階で確認する。
表示の優先順位は 押し忘れロック → お知らせ → 月次の登録情報確認。
取得失敗時は空配列のままにして稼働をブロックしない（fail-open）。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" && git push origin main
```

---

## Task 5: 稼働開始・シフト提出のブロック

**Files:**
- Modify: `app/page.tsx`（`handleStart` と シフト保存の2箇所）

- [ ] **Step 1: 稼働開始をブロック**

`app/page.tsx` の `handleStart` 内、押し忘れロックのガードの**直後**（10470行付近の
`window.alert("稼働開始・稼働終了の押し忘れが今月3回に達したため、アカウントがロックされています。画面の案内に従って規約に同意し、公式LINEへ報告のうえ管理者の解除をお待ちください。");`
を含む `if` ブロックを閉じた直後）に追加:

```ts
      // 未確認の必読お知らせがある間は稼働開始不可。モーダルを再表示する
      if (me && !meIsAdminAccount && memberAnnouncements.blocking.length > 0) {
        setPunchSubmitPhase("idle");
        if (typeof window !== "undefined") {
          window.alert("稼働開始の前に、お知らせの確認をお願いします。");
        }
        setAnnouncementGateDismissed(false);
        return;
      }
```

- [ ] **Step 2: シフト提出をブロック**

`app/page.tsx` のシフト保存処理内、押し忘れロックのガードの**直後**（10862行付近の
`alert("稼働開始・稼働終了の押し忘れが今月3回に達したため、アカウントがロックされています。規約に同意し、公式LINEへ報告のうえ管理者の解除をお待ちください。");`
を含む `if` ブロックを閉じた直後）に追加:

```ts
      // 未確認の必読お知らせがある間はシフト提出も不可
      if (me && !isAdminAccount && memberAnnouncements.blocking.length > 0) {
        alert("シフト提出の前に、お知らせの確認をお願いします。");
        setAnnouncementGateDismissed(false);
        return false;
      }
```

- [ ] **Step 3: 型チェックとビルド**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: 型エラーなし／`✓ Compiled successfully`

- [ ] **Step 4: コミットして push**

```bash
git add -A && git commit -m "feat(お知らせ): 必読が未確認の間は稼働開始・シフト提出をブロック

未確認の必読お知らせがあるときは、稼働開始ボタンとシフト保存を止めて
お知らせモーダルを再表示する（月次の登録情報確認と同じ振る舞い）。
「お知らせのみ」は閉じれば稼働できる。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" && git push origin main
```

---

## Task 6: メンバーの「お知らせ」タブ

**Files:**
- Create: `app/components/AnnouncementsTab.tsx`
- Modify: `app/page.tsx`（`Tab` 型・タブボタン・タブ本体）

- [ ] **Step 1: タブのコンポーネントを作る**

Create `app/components/AnnouncementsTab.tsx`:

```tsx
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
```

- [ ] **Step 2: `Tab` 型に `"announcements"` を追加**

`app/page.tsx` の 763行付近。変更前:

```ts
type Tab = "home" | "shift" | "kpi";
```

変更後:

```ts
type Tab = "home" | "shift" | "kpi" | "announcements";
```

- [ ] **Step 3: import を追加**

`app/page.tsx` の import 群（Task 4 で追加した `AnnouncementGateModal` の隣）に追加:

```ts
import { AnnouncementsTab } from "@/app/components/AnnouncementsTab";
```

- [ ] **Step 4: タブボタンを追加**

`app/page.tsx` のタブナビゲーション、`KPI入力` のボタンの**直後**（`</div>` の直前）に追加:

```tsx
            <button
              type="button"
              disabled={punchFlowBusy}
              onClick={() => !punchFlowBusy && setTab("announcements")}
              className={`relative flex-1 px-3 py-3 text-sm font-medium transition sm:px-4 disabled:cursor-not-allowed disabled:opacity-40 ${tab === "announcements" ? "border-b-2 border-slate-700 text-slate-800" : "text-slate-500 hover:text-slate-700"}`}
            >
              お知らせ
              {memberAnnouncements.unreadForModal.length > 0 && (
                <span className="absolute right-1 top-2 h-2 w-2 rounded-full bg-red-600" aria-label="未確認あり" />
              )}
            </button>
```

- [ ] **Step 5: タブ本体を描画（三項演算子の分岐を1段足す）**

⚠️ **注意**: メンバー画面のタブ本体は `{tab === "home" ? (...) : tab === "shift" ? (...) : (KpiTab)}` という
三項演算子の連鎖で、**最後の else が KPI入力**になっている。ここを直さずに `Tab` 型だけ増やすと、
「お知らせ」タブを開いても KPI入力が表示される。

`app/page.tsx` の 12343〜12345行付近。変更前:

```tsx
        ) : (
          <KpiTab userId={currentUserId} kpiRecords={kpiRecords} currentYearMonth={currentYearMonth} isIntern={currentMember?.isIntern === true} onSave={handleSaveKpi} />
        )}
```

変更後（`tab === "kpi"` の分岐を明示し、お知らせを最後の else にする）:

```tsx
        ) : tab === "kpi" ? (
          <KpiTab userId={currentUserId} kpiRecords={kpiRecords} currentYearMonth={currentYearMonth} isIntern={currentMember?.isIntern === true} onSave={handleSaveKpi} />
        ) : (
          <AnnouncementsTab
            announcements={memberAnnouncements.announcements}
            busy={memberAnnouncements.busy}
            error={memberAnnouncements.error}
            onConfirm={(a) => {
              void memberAnnouncements.confirm(a);
            }}
          />
        )}
```

- [ ] **Step 6: 型チェックとビルド**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: 型エラーなし／`✓ Compiled successfully`

- [ ] **Step 7: コミットして push**

```bash
git add -A && git commit -m "feat(お知らせ): メンバー画面に「お知らせ」タブを追加

過去のお知らせを新しい順に読み返せるタブを追加（公開終了したものは
「終了」ラベル付きで残る）。未確認があるとタブに赤い印を表示し、
タブからも同じ2段階操作で確認できる。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" && git push origin main
```

---

## Task 7: 管理画面の「お知らせ」セクション

**Files:**
- Create: `app/components/AdminAnnouncementsSection.tsx`
- Modify: `app/page.tsx`（`AdminSection` 型・`AdminNavIcon`・`navItems`・セクション描画・バッジ）

- [ ] **Step 1: 管理セクションのコンポーネントとフックを作る**

Create `app/components/AdminAnnouncementsSection.tsx`:

```tsx
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
```

- [ ] **Step 2: `AdminSection` 型に追加**

`app/page.tsx` の 763行付近。`| "dormant"` の直後に `| "announcements"` を追加:

```ts
type AdminSection =
  | "dashboard"
  | "attendance"
  | "shift"
  | "kpi"
  | "dailyActual"
  | "planActualGap"
  | "dormant"
  | "announcements"
  | "settings"
  | "roi"
  | "productivityExport"
  | "invoiceBatchExport";
```

- [ ] **Step 3: `AdminNavIcon` にアイコンを追加**

`app/page.tsx` の `AdminNavIcon` の `paths` に追加（`dailyActual` の後など、既存のどこでもよい）。インラインSVG（依存を増やさない方針）:

```tsx
    announcements: (
      <>
        <path d="M4 9v6h3l5 4V5L7 9H4z" />
        <path d="M16 9a4 4 0 0 1 0 6" />
      </>
    ),
```

- [ ] **Step 4: import とフック呼び出しを追加**

`app/page.tsx` の import に追加:

```ts
import { AdminAnnouncementsSection, useAdminAnnouncements } from "@/app/components/AdminAnnouncementsSection";
```

`AdminDashboard` 内、`const invoiceMissingNavCount = membersWithMissingInvoiceNumber.length;` の直後に追加:

```ts
  // お知らせ（管理者側）。左メニューのバッジにも使う
  const adminAnnouncements = useAdminAnnouncements(isAdminUser);
```

- [ ] **Step 5: `navItems` に追加**

`app/page.tsx` の `navItems`。`{ id: "dormant", label: "休眠メンバー" },` の直後に追加:

```ts
    { id: "announcements", label: "お知らせ" },
```

- [ ] **Step 6: 左メニューのバッジを追加**

`app/page.tsx` のナビ描画、`{item.id === "settings" && invoiceMissingNavCount > 0 ? (` のブロックの**直後**に追加:

```tsx
                  {item.id === "announcements" && adminAnnouncements.unconfirmedCount > 0 ? (
                    <span
                      className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
                      title="未確認のメンバーがいる必読お知らせがあります"
                    >
                      {adminAnnouncements.unconfirmedCount}
                    </span>
                  ) : null}
```

- [ ] **Step 7: セクション本体を描画**

`app/page.tsx` の `{adminSection === "dormant" && (` ブロックの**直前**に追加:

```tsx
      {adminSection === "announcements" && (
        <AdminAnnouncementsSection state={adminAnnouncements} />
      )}
```

- [ ] **Step 8: 型チェックとビルド**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: 型エラーなし／`✓ Compiled successfully`

- [ ] **Step 9: コミットして push**

```bash
git add -A && git commit -m "feat(お知らせ): 管理画面に「お知らせ」セクションを追加

左メニューに独立項目として追加（作成・一覧・編集・公開終了）。
各お知らせに確認状況「確認済み 32/45名」と未確認者名を表示し、
未確認者が残る必読の件数をメニューにバッジ表示する。編集時は
「再確認してもらう」チェックで版数を上げられる。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" && git push origin main
```

---

## Task 8: 総合検証とドキュメント更新

**Files:**
- Modify: `docs/SESSION_LOG.md`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: ロジック検証を再実行（デグレ確認）**

Run:
```bash
npx tsx "/private/tmp/claude-501/-Users-takuma-Desktop-my-attendance/e91ed0ea-7035-495e-8bd7-ab9214b5e716/scratchpad/verify-announcements.ts"
```
Expected: `結果: 26 passed / 0 failed`

- [ ] **Step 2: 本番 API の認証ガードを確認**

Run:
```bash
for p in /api/member/announcements /api/admin/announcements; do
  curl -s -o /dev/null -w "$p -> %{http_code}\n" "https://my-attendance-rho.vercel.app$p"
done
```
Expected: 両方 `401`

- [ ] **Step 3: 公開キーで新テーブルに触れないことを確認**

Run:
```bash
URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')
KEY=$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' .env.local | cut -d= -f2- | tr -d '"')
for t in announcements announcement_reads; do
  echo -n "$t -> "
  curl -s "$URL/rest/v1/$t?select=id&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
  echo
done
```
Expected: 両方 `[]`（RLS でポリシーが無いため読めない）

- [ ] **Step 4: 手動確認の手順をユーザーに案内**

以下をユーザーに提示して確認してもらう（コードでは検証できない部分）:

1. 管理画面 → 左メニュー「お知らせ」→ テスト用に1件作成（必読・宛先=全員）
2. 一覧に「確認済み 0/◯名」と未確認者名が出ること
3. 別ブラウザ（またはシークレットウィンドウ）で一般メンバーとしてログイン
4. ログイン直後にお知らせモーダルが出ること／チェックしないとボタンが押せないこと
5. 「あとで読む」で閉じ、稼働開始ボタンを押すと再表示されること
6. チェック→「確認しました」で閉じ、稼働開始ができること
7. 「お知らせ」タブに確認済みとして残り、本文を読み返せること
8. 管理画面の一覧で「確認済み 1/◯名」に増えていること
9. 管理画面で本文を編集（再確認ON）→ メンバー側で再び未確認になること
10. 公開終了 → メンバーのお知らせタブに「終了」ラベルで残ること

- [ ] **Step 5: `docs/SESSION_LOG.md` の先頭に追記**

`# SESSION_LOG` の直後に、次のブロックを挿入する（既存の追記スタイルに合わせる）:

```markdown
## 2026-08-05（追記: お知らせ機能）

- **お知らせ機能**（設計書: `docs/superpowers/specs/2026-08-05-announcements-design.md`／実装計画: `docs/superpowers/plans/2026-08-05-announcements.md`）: 管理者が登録したお知らせをログイン時に全画面表示し、「必読」は確認するまで稼働開始・シフト提出をブロックする。複数同時運用・個別確認、宛先は 全員／業務委託／インターン、チェック＋ボタンの2段階確認、確認記録は (お知らせ, 本人, 版数) 単位。
- **新テーブル2つ**: `announcements` / `announcement_reads`。**RLS はポリシーなし＝公開キーからは一切アクセス不可**（サーバー service_role 経由のみ）。**SQL 実行が必要**（`supabase-migration-announcements.sql`）。
- **メンバー画面**: 4つ目のタブ「お知らせ」を追加。過去分を読み返せ、未確認があるとタブに赤い印。表示の優先順位は 押し忘れロック → お知らせ → 月次の登録情報確認。
- **管理画面**: 左メニューに「お知らせ」を追加（作成・編集・公開終了・確認状況「確認済み 32/45名」・未確認者名）。未確認者が残る必読の件数をメニューにバッジ表示。
- **fail-open**: お知らせの取得に失敗しても稼働はブロックしない（通信障害で全員の手が止まる方が損害が大きいため）。SQL 未実行でも既存フローに影響しない。
- **検証**: 判定ロジック26ケースを `npx tsx` の検証スクリプトで確認。各コミットで `tsc`/`build` ✅。
```

- [ ] **Step 6: `docs/ARCHITECTURE.md` にテーブルを追記**

データモデルの表に次の2行を追加する（既存の表記に合わせる）:

```markdown
| `announcements` | お知らせ本体。`target`(all/contractor/intern)・`is_required`・`is_published`・`version`。RLS ポリシーなし＝サーバー(service_role)経由のみ |
| `announcement_reads` | お知らせの確認記録。`(announcement_id, user_id, version)` で一意。版数が上がると再確認が必要になる |
```

- [ ] **Step 7: コミットして push**

```bash
git add -A && git commit -m "docs: お知らせ機能をSESSION_LOG・ARCHITECTUREに記録

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" && git push origin main
```

---

## 完了条件

- [ ] `supabase-migration-announcements.sql` をユーザーが実行済み
- [ ] 判定ロジックの検証スクリプトが 26件すべて成功
- [ ] `npx tsc --noEmit` と `npm run build` が通る
- [ ] 本番で `/api/member/announcements` と `/api/admin/announcements` が未認証 401
- [ ] 公開キーで `announcements` / `announcement_reads` が読めない（`[]` が返る）
- [ ] 手動確認（Task 8 Step 4）の10項目をユーザーが確認済み
