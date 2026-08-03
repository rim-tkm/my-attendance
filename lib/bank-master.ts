import zenginData from "@/lib/zengin-data.json";

/**
 * 全銀協の銀行・支店マスタ（zengin-code/source-data・MIT ライセンスのスナップショット）。
 * lib/zengin-data.json はサーバー側でのみ import する（約2MB。クライアントバンドルに入れない）。
 * データ更新は scratchpad の手順（source-data を再取得して JSON を再生成）で年1回程度を想定。
 * freee 連携（取引先の振込口座）に必要な銀行コード4桁・支店コード3桁の入力補助・自動照合に使う。
 */

type ZenginEntry = { c: string; n: string; k: string; h: string };
type ZenginData = {
  updatedAt: string;
  banks: ZenginEntry[];
  branches: Record<string, ZenginEntry[]>;
};

const data = zenginData as ZenginData;

export type BankMasterHit = { code: string; name: string; kana: string };

/** カタカナ→ひらがな */
function kataToHira(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/** 照合用の正規化: NFKC（全角英数→半角等）・空白除去・ひらがな化・長音等の揺れはそのまま */
function normalizeForMatch(raw: string): string {
  return kataToHira(raw.normalize("NFKC").replace(/[\s　]+/g, ""));
}

/**
 * 銀行名クエリの正規化: マスタ側の略称表記（〇〇信金・〇〇信組など）に合わせて種別語を縮め、
 * 末尾の「銀行」のみ除去（マスタの銀行名は「みずほ」のように銀行を含まないため）。
 */
export function normalizeBankNameQuery(raw: string): string {
  const base = normalizeForMatch(raw);
  return base
    .replace(/信用金庫$/, "信金")
    .replace(/信用組合$/, "信組")
    .replace(/労働金庫$/, "労金")
    .replace(/農業協同組合$/, "農協")
    .replace(/銀行$/, "");
}

/** マスタの銀行名（種別語なしの略称が多い）を保存・表示用に補う。信金・信組等の種別語付きはそのまま */
export function bankMasterDisplayName(masterName: string): string {
  return /(銀行|金庫|信金|信組|信連|労金|農協|漁協|信漁連|中金|連合会|公庫)$/.test(masterName)
    ? masterName
    : `${masterName}銀行`;
}

/** 支店名クエリの正規化: 末尾の「支店」のみ除去（営業部・出張所はマスタ側も持つため残す） */
export function normalizeBranchNameQuery(raw: string): string {
  const base = normalizeForMatch(raw);
  return base.replace(/支店$/, "");
}

function scoreEntry(e: ZenginEntry, q: string): number {
  const name = normalizeForMatch(e.n);
  const hira = normalizeForMatch(e.h);
  if (name === q || hira === q) return 0;
  if (name.startsWith(q) || hira.startsWith(q)) return 1;
  if (name.includes(q) || hira.includes(q)) return 2;
  return -1;
}

function searchEntries(entries: ZenginEntry[], q: string, limit: number): BankMasterHit[] {
  const hits: { e: ZenginEntry; s: number }[] = [];
  for (const e of entries) {
    const s = scoreEntry(e, q);
    if (s >= 0) hits.push({ e, s });
  }
  hits.sort((a, b) => a.s - b.s || a.e.c.localeCompare(b.e.c));
  return hits.slice(0, limit).map(({ e }) => ({ code: e.c, name: e.n, kana: e.k }));
}

/** 銀行を部分一致検索（表示名・ひらがな）。空クエリは空配列 */
export function searchBanks(query: string, limit = 20): BankMasterHit[] {
  const q = normalizeBankNameQuery(query);
  if (q === "") return [];
  return searchEntries(data.banks, q, limit);
}

/** 指定銀行の支店を部分一致検索。空クエリは先頭から limit 件（プルダウン初期表示用） */
export function searchBranches(bankCode: string, query: string, limit = 20): BankMasterHit[] {
  const entries = data.branches[bankCode] ?? [];
  const q = normalizeBranchNameQuery(query);
  if (q === "") return entries.slice(0, limit).map((e) => ({ code: e.c, name: e.n, kana: e.k }));
  return searchEntries(entries, q, limit);
}

/**
 * 既存データの一括補完用の厳格な照合: 正規化名の完全一致、なければ前方一致が1件のときだけ採用。
 * 曖昧なもの（複数候補・0件）は null を返し、呼び出し側で「未照合」として一覧に出す。
 */
export function matchBankByName(rawName: string): BankMasterHit | null {
  const q = normalizeBankNameQuery(rawName);
  if (q === "") return null;
  const exact = data.banks.filter((e) => normalizeForMatch(e.n) === q || normalizeForMatch(e.h) === q);
  if (exact.length === 1) return { code: exact[0].c, name: exact[0].n, kana: exact[0].k };
  if (exact.length > 1) return null;
  const prefix = data.banks.filter(
    (e) => normalizeForMatch(e.n).startsWith(q) || normalizeForMatch(e.h).startsWith(q)
  );
  if (prefix.length === 1) return { code: prefix[0].c, name: prefix[0].n, kana: prefix[0].k };
  return null;
}

/** matchBankByName の支店版（bankCode 配下のみ照合） */
export function matchBranchByName(bankCode: string, rawName: string): BankMasterHit | null {
  const entries = data.branches[bankCode] ?? [];
  const q = normalizeBranchNameQuery(rawName);
  if (q === "") return null;
  const exact = entries.filter((e) => normalizeForMatch(e.n) === q || normalizeForMatch(e.h) === q);
  if (exact.length === 1) return { code: exact[0].c, name: exact[0].n, kana: exact[0].k };
  if (exact.length > 1) return null;
  const prefix = entries.filter(
    (e) => normalizeForMatch(e.n).startsWith(q) || normalizeForMatch(e.h).startsWith(q)
  );
  if (prefix.length === 1) return { code: prefix[0].c, name: prefix[0].n, kana: prefix[0].k };
  return null;
}

/** マスタの更新日（YYYYMMDD 文字列。UI の注記用） */
export function bankMasterUpdatedAt(): string {
  return data.updatedAt;
}
