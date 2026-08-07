"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  NAKANO_CATEGORIES,
  nakanoCategoryLabel,
  type NakanoCategory,
  type NakanoKnowledge,
} from "@/lib/nakano";
// lib/nakano-data.ts は service_role の Supabase クライアントを持つサーバー専用モジュール。
// 値を import するとブラウザバンドルに混入するので、型だけ借りる。
import type { NakanoLogRow, NakanoUsage } from "@/lib/nakano-data";

const LOGS_PAGE_SIZE = 50;

/* ------------------------------------------------------------------ *
 * 知識
 * ------------------------------------------------------------------ */

export type NakanoKnowledgeInput = {
  title: string;
  body: string;
  category: NakanoCategory;
  parentId: string | null;
  showAsStep: boolean;
  isActive: boolean;
  sortOrder: number;
};

export type AdminNakanoKnowledgeState = {
  rows: NakanoKnowledge[];
  busy: boolean;
  error: string | null;
  reload: () => Promise<void>;
  create: (input: NakanoKnowledgeInput) => Promise<boolean>;
  update: (id: string, input: Partial<NakanoKnowledgeInput>) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
};

export function useAdminNakanoKnowledge(): AdminNakanoKnowledgeState {
  const [rows, setRows] = useState<NakanoKnowledge[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/nakano/knowledge", { credentials: "include" });
      const data = (await res.json().catch(() => null)) as
        | { knowledge?: NakanoKnowledge[]; error?: string }
        | null;
      if (!res.ok || !Array.isArray(data?.knowledge)) {
        setRows([]);
        return;
      }
      setRows(data.knowledge);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create: AdminNakanoKnowledgeState["create"] = useCallback(
    async (input) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/nakano/knowledge", {
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

  const update: AdminNakanoKnowledgeState["update"] = useCallback(
    async (id, input) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/nakano/knowledge/${encodeURIComponent(id)}`, {
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

  const remove: AdminNakanoKnowledgeState["remove"] = useCallback(
    async (id) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/nakano/knowledge/${encodeURIComponent(id)}`, {
          method: "DELETE",
          credentials: "include",
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(data.error || "削除に失敗しました");
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

  return { rows, busy, error, reload, create, update, remove };
}

/* ------------------------------------------------------------------ *
 * 知識の承認待ちドラフト
 * ------------------------------------------------------------------ */

type NakanoDraftRow = {
  id: string;
  question: string;
  rawAnswer: string;
  draftTitle: string;
  draftBody: string;
  slackPermalink: string | null;
  createdAt: string;
};

/* ------------------------------------------------------------------ *
 * 会話ログ
 * ------------------------------------------------------------------ */

export type AdminNakanoLogsState = {
  rows: NakanoLogRow[];
  hasMore: boolean;
  busy: boolean;
  error: string | null;
  escalatedOnly: boolean;
  autoRefresh: boolean;
  setAutoRefresh: (v: boolean) => void;
  refresh: () => void;
  lastLoadedAt: Date | null;
  setEscalatedOnly: (v: boolean) => void;
  loadMore: () => void;
};

export function useAdminNakanoLogs(): AdminNakanoLogsState {
  const [rows, setRows] = useState<NakanoLogRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [escalatedOnly, setEscalatedOnly] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  const fetchPage = useCallback(async (offset: number, only: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(LOGS_PAGE_SIZE), offset: String(offset) });
      if (only) params.set("escalatedOnly", "1");
      const res = await fetch(`/api/admin/nakano/logs?${params.toString()}`, { credentials: "include" });
      const data = (await res.json().catch(() => ({}))) as {
        rows?: NakanoLogRow[];
        hasMore?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || "読み込みに失敗しました");
        return;
      }
      const next = Array.isArray(data.rows) ? data.rows : [];
      setRows((prev) => (offset === 0 ? next : prev.concat(next)));
      setHasMore(data.hasMore === true);
      setLastLoadedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  // 絞り込みを切り替えたら先頭から取り直す。
  useEffect(() => {
    void fetchPage(0, escalatedOnly);
  }, [fetchPage, escalatedOnly]);

  const loadMore = useCallback(() => {
    void fetchPage(rows.length, escalatedOnly);
  }, [fetchPage, rows.length, escalatedOnly]);

  const refresh = useCallback(() => {
    void fetchPage(0, escalatedOnly);
  }, [fetchPage, escalatedOnly]);

  // 30秒ごとに先頭から取り直す。質問が来ていることに気づけるようにするため。
  // 「もっと見る」で読み足したぶんは先頭に戻るが、
  // リアルタイムに見たい場面と過去を掘る場面は別なので、そこは割り切る。
  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => {
      void fetchPage(0, escalatedOnly);
    }, 30_000);
    return () => window.clearInterval(id);
  }, [autoRefresh, fetchPage, escalatedOnly]);

  return {
    rows,
    hasMore,
    busy,
    error,
    escalatedOnly,
    setEscalatedOnly,
    loadMore,
    autoRefresh,
    setAutoRefresh,
    refresh,
    lastLoadedAt,
  };
}

/* ------------------------------------------------------------------ *
 * 使用状況
 * ------------------------------------------------------------------ */

/** 日別の費用。1日あたりの上限で運用を判断するために使う */
export type NakanoDailyCost = {
  date: string;
  aiQuestionCount: number;
  stepUseCount: number;
  yen: number;
  cacheHitRate: number | null;
};

export type AdminNakanoUsageState = {
  month: string;
  setMonth: (v: string) => void;
  usage: NakanoUsage | null;
  estimatedYen: number;
  daily: NakanoDailyCost[];
  dailyAlertYen: number;
  busy: boolean;
  error: string | null;
};

export function useAdminNakanoUsage(): AdminNakanoUsageState {
  const [month, setMonth] = useState<string>(() => currentJstMonth());
  const [usage, setUsage] = useState<NakanoUsage | null>(null);
  const [estimatedYen, setEstimatedYen] = useState(0);
  const [daily, setDaily] = useState<NakanoDailyCost[]>([]);
  const [dailyAlertYen, setDailyAlertYen] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!/^\d{4}-\d{2}$/.test(month)) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/nakano/usage?month=${encodeURIComponent(month)}`, {
          credentials: "include",
        });
        const data = (await res.json().catch(() => ({}))) as {
          usage?: NakanoUsage;
          estimatedYen?: number;
          daily?: NakanoDailyCost[];
          dailyAlertYen?: number;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.usage) {
          setUsage(null);
          setEstimatedYen(0);
          setDaily([]);
          setError(data.error || "読み込みに失敗しました");
          return;
        }
        setUsage(data.usage);
        setEstimatedYen(typeof data.estimatedYen === "number" ? data.estimatedYen : 0);
        setDaily(Array.isArray(data.daily) ? data.daily : []);
        setDailyAlertYen(typeof data.dailyAlertYen === "number" ? data.dailyAlertYen : 0);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    };
    void run();
    // 月を素早く切り替えたときに古い応答が後着して上書きするのを防ぐ。
    return () => {
      cancelled = true;
    };
  }, [month]);

  return { month, setMonth, usage, estimatedYen, daily, dailyAlertYen, busy, error };
}

/* ------------------------------------------------------------------ *
 * 表示用のヘルパー
 * ------------------------------------------------------------------ */

function currentJstMonth(): string {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}`;
}

function formatJstDateTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
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

function categoryBadgeClass(c: NakanoCategory): string {
  switch (c) {
    case "operation":
      return "bg-sky-100 text-sky-800";
    case "rule":
      return "bg-violet-100 text-violet-800";
    case "billing":
      return "bg-emerald-100 text-emerald-800";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function sortKnowledge(list: NakanoKnowledge[]): NakanoKnowledge[] {
  return [...list].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    if (a.title !== b.title) return a.title < b.title ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

function buildChildrenMap(all: NakanoKnowledge[]): {
  childrenOf: Map<string, NakanoKnowledge[]>;
  roots: NakanoKnowledge[];
} {
  const byId = new Map(all.map((k) => [k.id, k]));
  const childrenOf = new Map<string, NakanoKnowledge[]>();
  const roots: NakanoKnowledge[] = [];
  for (const k of all) {
    // 親が見つからない孤児は、隠して見えなくするより最上段に出す方が安全。
    if (k.parentId == null || k.parentId === k.id || !byId.has(k.parentId)) {
      roots.push(k);
      continue;
    }
    const list = childrenOf.get(k.parentId) ?? [];
    list.push(k);
    childrenOf.set(k.parentId, list);
  }
  return { childrenOf, roots };
}

export type NakanoKnowledgeRow = { item: NakanoKnowledge; depth: number };

/**
 * 管理画面用に親子を組み立てて、深さ付きの一列に並べる。
 * buildNakanoStepTree は show_as_step=true の行しか返さないので使えない
 * （管理画面は AI 専用の知識も含めて全件見せる必要がある）。
 */
export function flattenNakanoKnowledge(all: NakanoKnowledge[]): NakanoKnowledgeRow[] {
  const { childrenOf, roots } = buildChildrenMap(all);
  const out: NakanoKnowledgeRow[] = [];
  const emitted = new Set<string>();

  // 不正なデータで循環していても固まらないよう、辿った id を持って回る。
  const walk = (node: NakanoKnowledge, depth: number, seen: Set<string>) => {
    out.push({ item: node, depth });
    emitted.add(node.id);
    const nextSeen = new Set(seen);
    nextSeen.add(node.id);
    for (const c of sortKnowledge(childrenOf.get(node.id) ?? [])) {
      if (nextSeen.has(c.id)) continue;
      walk(c, depth + 1, nextSeen);
    }
  };
  for (const r of sortKnowledge(roots)) walk(r, 0, new Set());

  // 循環だけで構成された島は根から辿り着けない。消えるより最上段に出す。
  for (const k of sortKnowledge(all)) {
    if (!emitted.has(k.id)) out.push({ item: k, depth: 0 });
  }
  return out;
}

/** 自分自身とその子孫。親の選択肢から外して循環を作らせないために使う */
function collectSelfAndDescendants(all: NakanoKnowledge[], id: string): Set<string> {
  const { childrenOf } = buildChildrenMap(all);
  const found = new Set<string>([id]);
  const stack = [id];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    for (const c of childrenOf.get(cur) ?? []) {
      if (found.has(c.id)) continue;
      found.add(c.id);
      stack.push(c.id);
    }
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * 知識のフォーム（追加・編集で共用）
 * ------------------------------------------------------------------ */

type KnowledgeParentOption = { id: string; label: string };

function KnowledgeForm({
  initial,
  parentOptions,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: NakanoKnowledgeInput;
  parentOptions: KnowledgeParentOption[];
  busy: boolean;
  submitLabel: string;
  onSubmit: (input: NakanoKnowledgeInput) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [category, setCategory] = useState<NakanoCategory>(initial.category);
  const [parentId, setParentId] = useState<string>(initial.parentId ?? "");
  const [showAsStep, setShowAsStep] = useState(initial.showAsStep);
  const [isActive, setIsActive] = useState(initial.isActive);
  const [sortOrder, setSortOrder] = useState(String(initial.sortOrder));

  return (
    <div className="space-y-3">
      <label className="block text-xs font-medium text-slate-700">
        タイトル
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
          placeholder="例：シフトの提出期限"
        />
      </label>
      <label className="block text-xs font-medium text-slate-700">
        本文
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
          placeholder="そのまま中野くんの回答になります。"
        />
      </label>
      <div className="flex flex-wrap items-end gap-4">
        <label className="block text-xs font-medium text-slate-700">
          カテゴリ
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as NakanoCategory)}
            className="mt-1 block rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
          >
            {NAKANO_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {nakanoCategoryLabel(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-700">
          親の項目
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="mt-1 block max-w-xs rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
          >
            <option value="">なし（最上段）</option>
            {parentOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-700">
          並び順
          <input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="mt-1 block w-24 rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-1.5 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={showAsStep}
            onChange={(e) => setShowAsStep(e.target.checked)}
            className="rounded border-slate-300"
          />
          よくある質問のボタンとして出す
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="rounded border-slate-300"
          />
          有効にする
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || title.trim() === "" || body.trim() === ""}
          onClick={async () => {
            const parsed = Number(sortOrder);
            await onSubmit({
              title: title.trim(),
              body: body.trim(),
              category,
              parentId: parentId === "" ? null : parentId,
              showAsStep,
              isActive,
              sortOrder: Number.isFinite(parsed) ? Math.round(parsed) : 0,
            });
          }}
          className="rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            キャンセル
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 知識の承認待ちカード
 * ------------------------------------------------------------------ */

/**
 * 知識の承認待ちドラフト。
 * Slackで📚が付いた担当回答のAI整形案を、ここで人が確認してから正式知識にする。
 * 0件のときはセクションごと出さない（画面を汚さない）。
 */
function DraftsCard() {
  const [rows, setRows] = useState<NakanoDraftRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { title: string; body: string }>>({});

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/nakano/drafts", { credentials: "include" });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; drafts?: NakanoDraftRow[]; error?: string }
        | null;
      if (!res.ok || !data?.ok || !Array.isArray(data.drafts)) {
        throw new Error(data?.error || "読み込みに失敗しました");
      }
      setRows(data.drafts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const getEdit = (r: NakanoDraftRow) => edits[r.id] ?? { title: r.draftTitle, body: r.draftBody };

  const approve = useCallback(
    async (r: NakanoDraftRow) => {
      const edit = edits[r.id] ?? { title: r.draftTitle, body: r.draftBody };
      if (!window.confirm(`「${edit.title}」を正式な知識として登録します。よろしいですか？`)) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/admin/nakano/drafts/${encodeURIComponent(r.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ action: "approve", title: edit.title, body: edit.body }),
        });
        const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (!res.ok || !data?.ok) throw new Error(data?.error || "承認に失敗しました");
        setRows((prev) => prev.filter((x) => x.id !== r.id));
        window.alert("知識に登録しました。中野くんは次の質問から使います");
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [edits]
  );

  const reject = useCallback(async (r: NakanoDraftRow) => {
    if (!window.confirm(`「${r.draftTitle}」の文案を破棄します。よろしいですか？`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/nakano/drafts/${encodeURIComponent(r.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "reject" }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error || "却下に失敗しました");
      setRows((prev) => prev.filter((x) => x.id !== r.id));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  if (rows.length === 0 && !error) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">知識の承認待ち（{rows.length}件）</h3>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          更新
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-600">
        Slackで📚を付けた回答の文案です。内容を確認・編集して承認すると、中野くんが次の質問から使います。
      </p>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-3 space-y-4">
        {rows.map((r) => {
          const edit = getEdit(r);
          return (
            <div key={r.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">元の質問</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">{r.question}</p>
              <p className="mt-2 text-xs text-slate-500">担当の返信（原文）</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-600">{r.rawAnswer}</p>
              <div className="mt-3 space-y-2">
                <input
                  type="text"
                  value={edit.title}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [r.id]: { ...edit, title: e.target.value } }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="知識のタイトル"
                />
                <textarea
                  value={edit.body}
                  rows={4}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [r.id]: { ...edit, body: e.target.value } }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="知識の本文"
                />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void approve(r)}
                  disabled={busy}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  承認して知識にする
                </button>
                <button
                  type="button"
                  onClick={() => void reject(r)}
                  disabled={busy}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  却下
                </button>
                {r.slackPermalink && (
                  <a
                    href={r.slackPermalink}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto text-xs text-slate-500 underline hover:text-slate-700"
                  >
                    Slackのスレッドを見る
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 本体
 * ------------------------------------------------------------------ */

export function AdminNakanoSection() {
  const knowledge = useAdminNakanoKnowledge();
  const logs = useAdminNakanoLogs();
  const usage = useAdminNakanoUsage();

  const [editingId, setEditingId] = useState<string | null>(null);
  // 追加が成功したらフォームを作り直して入力欄を空に戻す。
  const [createFormKey, setCreateFormKey] = useState(0);

  const orderedKnowledge = useMemo(() => flattenNakanoKnowledge(knowledge.rows), [knowledge.rows]);

  const parentOptionsFor = useCallback(
    (excludeId: string | null): KnowledgeParentOption[] => {
      const excluded = excludeId ? collectSelfAndDescendants(knowledge.rows, excludeId) : new Set<string>();
      return orderedKnowledge
        .filter((r) => !excluded.has(r.item.id))
        .map((r) => ({ id: r.item.id, label: `${"　".repeat(r.depth)}${r.item.title}` }));
    },
    [knowledge.rows, orderedKnowledge]
  );

  // 総額だけでは「使われた量」と「1問の重さ」が混ざって判断できない。
  // 300件/日で回せるかは 1問あたりの単価で決まるので、そこを出す。
  const yenPerQuestion = useMemo(() => {
    const n = usage.usage?.aiQuestionCount ?? 0;
    if (n <= 0) return 0;
    return Math.round((usage.estimatedYen / n) * 10) / 10;
  }, [usage.usage, usage.estimatedYen]);

  // キャッシュが効いた割合。読み出しは書き込みの約1/20の単価なので、
  // ここが下がると1問あたりの費用が跳ね上がる。費用が高いときに最初に見る数字。
  const cacheHitLabel = useMemo(() => {
    const read = usage.usage?.cacheReadTokens ?? 0;
    const write = usage.usage?.cacheWriteTokens ?? 0;
    const total = read + write;
    if (total <= 0) return "—";
    return `${Math.round((read / total) * 1000) / 10}%`;
  }, [usage.usage]);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">届いた質問</h2>
        <p className="mb-3 text-xs text-slate-500">
          ここに来た質問を見て、よくあるものを一番下の「知識の管理」に足していくと中野くんが賢くなります。
        </p>
        {logs.error && <p className="mb-2 text-xs text-red-600">{logs.error}</p>}

        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <label className="flex items-center gap-1.5 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={logs.escalatedOnly}
              onChange={(e) => logs.setEscalatedOnly(e.target.checked)}
              className="rounded border-slate-300"
            />
            担当に回されたものだけ
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={logs.autoRefresh}
              onChange={(e) => logs.setAutoRefresh(e.target.checked)}
              className="rounded border-slate-300"
            />
            自動更新（30秒ごと）
          </label>
          <button
            type="button"
            onClick={logs.refresh}
            disabled={logs.busy}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            今すぐ更新
          </button>
          {logs.lastLoadedAt && (
            <span className="text-[11px] text-slate-400">
              最終更新 {formatJstDateTimeLabel(logs.lastLoadedAt.toISOString())}
            </span>
          )}
        </div>

        {logs.rows.length === 0 ? (
          <p className="text-sm text-slate-600">{logs.busy ? "読み込み中です。" : "まだ質問はありません。"}</p>
        ) : (
          <div className="space-y-2">
            {logs.rows.map((m) => (
              <div key={m.id} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-slate-500">{formatJstDateTimeLabel(m.createdAt)}</span>
                  <span className="text-[10px] font-medium text-slate-700">{m.memberName}</span>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                      m.role === "user" ? "bg-slate-100 text-slate-700" : "bg-sky-100 text-sky-800"
                    }`}
                  >
                    {m.role === "user" ? "メンバーの質問" : "中野くんの回答"}
                  </span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                    {m.source === "step" ? "よくある質問の操作" : "AI"}
                  </span>
                  {m.escalated && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                      担当に回した
                    </span>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{m.content}</p>
              </div>
            ))}
          </div>
        )}

        {logs.hasMore && (
          <button
            type="button"
            disabled={logs.busy}
            onClick={logs.loadMore}
            className="mt-3 rounded border border-slate-300 px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {logs.busy ? "読み込み中…" : "もっと見る"}
          </button>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">今月の使用状況</h2>
        {usage.error && <p className="mb-2 text-xs text-red-600">{usage.error}</p>}

        <label className="mb-4 flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">対象月</span>
          <input
            type="month"
            value={usage.month}
            onChange={(e) => usage.setMonth(e.target.value)}
            disabled={usage.busy}
            className="w-40 rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        {!usage.usage ? (
          <p className="text-sm text-slate-600">{usage.busy ? "読み込み中です。" : "データがありません。"}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[11px] text-slate-500">AIへの質問数</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {Math.round(usage.usage.aiQuestionCount).toLocaleString("ja-JP")}
                  <span className="ml-1 text-xs font-normal text-slate-500">件</span>
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[11px] text-slate-500">よくある質問の利用数</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {Math.round(usage.usage.stepUseCount).toLocaleString("ja-JP")}
                  <span className="ml-1 text-xs font-normal text-slate-500">件</span>
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[11px] text-slate-500">担当に回した数</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {Math.round(usage.usage.escalatedCount).toLocaleString("ja-JP")}
                  <span className="ml-1 text-xs font-normal text-slate-500">件</span>
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[11px] text-slate-500">入力トークン</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {Math.round(usage.usage.inputTokens).toLocaleString("ja-JP")}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[11px] text-slate-500">出力トークン</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {Math.round(usage.usage.outputTokens).toLocaleString("ja-JP")}
                </p>
              </div>
              {/* 費用の大半はこの2つで決まる。表示していないと「なぜ高いのか」が分からない */}
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[11px] text-slate-500">キャッシュ読み込み（安い）</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {Math.round(usage.usage.cacheReadTokens).toLocaleString("ja-JP")}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[11px] text-slate-500">キャッシュ書き込み（高い）</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {Math.round(usage.usage.cacheWriteTokens).toLocaleString("ja-JP")}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] text-slate-500">1問あたりの平均</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  約 {yenPerQuestion.toLocaleString("ja-JP")}
                  <span className="ml-1 text-xs font-normal text-slate-500">円</span>
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] text-slate-500">概算費用</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  約 {Math.round(usage.estimatedYen).toLocaleString("ja-JP")}
                  <span className="ml-1 text-xs font-normal text-slate-500">円</span>
                </p>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              知識はキャッシュに載せて使い回しています。キャッシュが効いた割合{" "}
              <span className="font-semibold text-slate-700">{cacheHitLabel}</span>
              。ここが低いほど1問あたりの費用が上がります。
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              Anthropicの実際の請求額とは一致しません。目安です。
            </p>
          </>
        )}

        {/* 1日あたりの上限で運用を判断するための表。対象月とは関係なく常に直近7日を出す */}
        <div className="mt-5 border-t border-slate-200 pt-4">
          <h3 className="text-xs font-semibold text-slate-800">1日ごとの費用（直近7日）</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {usage.dailyAlertYen > 0
              ? `1日 ${usage.dailyAlertYen.toLocaleString("ja-JP")}円 を超えた日は赤で表示し、その日の21時にSlackへ通知します。`
              : "上の対象月に関わらず、常に直近7日を表示します。"}
          </p>

          {usage.daily.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">{usage.busy ? "読み込み中です。" : "データがありません。"}</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[30rem] text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] text-slate-500">
                    <th className="py-1.5 pr-3 font-medium">日付</th>
                    <th className="py-1.5 pr-3 text-right font-medium">概算費用</th>
                    <th className="py-1.5 pr-3 text-right font-medium">AIへの質問</th>
                    <th className="py-1.5 pr-3 text-right font-medium">ボタン利用</th>
                    <th className="py-1.5 text-right font-medium">キャッシュ</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.daily.map((d, i) => {
                    const over = usage.dailyAlertYen > 0 && d.yen > usage.dailyAlertYen;
                    return (
                      <tr key={d.date} className="border-b border-slate-100 last:border-0">
                        <td className="py-1.5 pr-3 text-slate-700">
                          {d.date.slice(5).replace("-", "/")}
                          {i === 0 && <span className="ml-1 text-[10px] text-slate-400">今日</span>}
                        </td>
                        <td
                          className={`py-1.5 pr-3 text-right font-semibold ${
                            over ? "text-red-600" : "text-slate-900"
                          }`}
                        >
                          {d.yen.toLocaleString("ja-JP")} 円
                        </td>
                        <td className="py-1.5 pr-3 text-right text-slate-700">{d.aiQuestionCount}</td>
                        <td className="py-1.5 pr-3 text-right text-slate-700">{d.stepUseCount}</td>
                        <td className="py-1.5 text-right text-slate-500">
                          {d.cacheHitRate == null ? "—" : `${Math.round(d.cacheHitRate * 100)}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <DraftsCard />

      {/* 知識の管理は普段は畳んでおく。日々見るのは上の2枚で、ここは直したいときだけ開けばいい。 */}
      <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-slate-900">
          知識の管理（中野くんが答えられる内容）
        </summary>
        <div className="border-t border-slate-200 px-5 py-4">
          <p className="mb-3 text-xs text-slate-500">
            ここに書いた内容だけを中野くんは答えます。「よくある質問のボタンとして出す」を付けた項目は、メンバーの画面にボタンとして並びます。
          </p>
          {knowledge.error && <p className="mb-2 text-xs text-red-600">{knowledge.error}</p>}

          <details className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <summary className="cursor-pointer text-xs font-medium text-slate-700">項目を追加する</summary>
            <div className="mt-3">
              <KnowledgeForm
                key={createFormKey}
                initial={{
                  title: "",
                  body: "",
                  category: "operation",
                  parentId: null,
                  showAsStep: false,
                  isActive: true,
                  sortOrder: 0,
                }}
                parentOptions={parentOptionsFor(null)}
                busy={knowledge.busy}
                submitLabel="追加する"
                onSubmit={async (input) => {
                  const ok = await knowledge.create(input);
                  if (ok) setCreateFormKey((v) => v + 1);
                  return ok;
                }}
              />
            </div>
          </details>

          {orderedKnowledge.length === 0 ? (
            <p className="text-sm text-slate-600">まだ知識はありません。</p>
          ) : (
            <div className="space-y-2">
              {orderedKnowledge.map(({ item, depth }) => (
                <div
                  key={item.id}
                  style={{ marginLeft: `${Math.min(depth, 6) * 20}px` }}
                  className={`rounded-lg border p-3 ${
                    item.isActive ? "border-slate-200" : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${categoryBadgeClass(item.category)}`}>
                      {nakanoCategoryLabel(item.category)}
                    </span>
                    {item.showAsStep && (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                        ステップ表示
                      </span>
                    )}
                    {!item.isActive && (
                      <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600">無効</span>
                    )}
                    <span className="text-[10px] text-slate-500">並び順 {item.sortOrder}</span>
                  </div>
                  <p className={`text-sm font-semibold ${item.isActive ? "text-slate-900" : "text-slate-500"}`}>
                    {item.title}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{item.body}</p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={knowledge.busy}
                      onClick={() => setEditingId(editingId === item.id ? null : item.id)}
                      className="rounded border border-slate-300 px-3 py-1 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {editingId === item.id ? "編集を閉じる" : "編集"}
                    </button>
                    <button
                      type="button"
                      disabled={knowledge.busy}
                      onClick={async () => {
                        await knowledge.update(item.id, { isActive: !item.isActive });
                      }}
                      className="rounded border border-slate-300 px-3 py-1 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {item.isActive ? "無効にする" : "有効にする"}
                    </button>
                    <button
                      type="button"
                      disabled={knowledge.busy}
                      onClick={async () => {
                        if (
                          !window.confirm(
                            `「${item.title}」を削除しますか？\n\nこの項目にぶら下がっている子の項目もすべて一緒に削除されます。\nこの操作は取り消せません。`
                          )
                        )
                          return;
                        const ok = await knowledge.remove(item.id);
                        if (ok && editingId === item.id) setEditingId(null);
                      }}
                      className="rounded border border-red-300 bg-red-50 px-3 py-1 text-[11px] text-red-700 hover:bg-red-100 disabled:opacity-50"
                    >
                      削除
                    </button>
                  </div>

                  {editingId === item.id && (
                    <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3">
                      <KnowledgeForm
                        initial={{
                          title: item.title,
                          body: item.body,
                          category: item.category,
                          parentId: item.parentId,
                          showAsStep: item.showAsStep,
                          isActive: item.isActive,
                          sortOrder: item.sortOrder,
                        }}
                        parentOptions={parentOptionsFor(item.id)}
                        busy={knowledge.busy}
                        submitLabel="保存する"
                        onSubmit={async (input) => {
                          const ok = await knowledge.update(item.id, input);
                          if (ok) setEditingId(null);
                          return ok;
                        }}
                        onCancel={() => setEditingId(null)}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

export default AdminNakanoSection;
