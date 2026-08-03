import { NextResponse } from "next/server";
import { bankMasterDisplayName, bankMasterUpdatedAt, searchBanks, searchBranches } from "@/lib/bank-master";

/**
 * 銀行・支店マスタ検索（全銀協オープンデータのスナップショット・公開マスタのため認証不要）。
 * マスタ JSON（約2MB）はサーバー側のみで読み、クライアントには候補だけ返す。
 * GET /api/bank-master?q=みずほ                → 銀行候補
 * GET /api/bank-master?bank=0001&q=丸の内      → 指定銀行の支店候補（q 空なら先頭20件）
 * hits[].display は保存・表示用の名称（銀行は「みずほ銀行」のように種別語を補ったもの）。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const bank = (url.searchParams.get("bank") ?? "").trim();
  if (bank !== "") {
    const hits = searchBranches(bank, q).map((h) => ({ ...h, display: h.name }));
    return NextResponse.json({ ok: true, updatedAt: bankMasterUpdatedAt(), hits });
  }
  const hits = searchBanks(q).map((h) => ({ ...h, display: bankMasterDisplayName(h.name) }));
  return NextResponse.json({ ok: true, updatedAt: bankMasterUpdatedAt(), hits });
}
