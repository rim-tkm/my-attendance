import { NextResponse } from "next/server";
import {
  bankMasterDisplayName,
  bankMasterUpdatedAt,
  matchBankByName,
  matchBranchByName,
  searchBanks,
  searchBranches,
} from "@/lib/bank-master";

/**
 * 銀行・支店マスタ検索（全銀協オープンデータのスナップショット・公開マスタのため認証不要）。
 * マスタ JSON（約2MB）はサーバー側のみで読み、クライアントには候補だけ返す。
 * GET /api/bank-master?q=みずほ                → 銀行候補
 * GET /api/bank-master?bank=0001&q=丸の内      → 指定銀行の支店候補（q 空なら先頭20件）
 * hits[].display は保存・表示用の名称（銀行は「みずほ銀行」のように種別語を補ったもの）。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  // 検証モード: 登録済みの銀行名・支店名がマスタと照合できるか（本人確認モーダルの赤字警告用）
  const validateBank = url.searchParams.get("validateBank");
  if (validateBank != null) {
    const bankHit = validateBank.trim() !== "" ? matchBankByName(validateBank) : null;
    const validateBranch = (url.searchParams.get("validateBranch") ?? "").trim();
    const branchHit = bankHit && validateBranch !== "" ? matchBranchByName(bankHit.code, validateBranch) : null;
    return NextResponse.json({
      ok: true,
      bank: bankHit ? { code: bankHit.code, name: bankMasterDisplayName(bankHit.name), kana: bankHit.kana } : null,
      branch: branchHit ? { code: branchHit.code, name: branchHit.name, kana: branchHit.kana } : null,
    });
  }
  const q = url.searchParams.get("q") ?? "";
  const bank = (url.searchParams.get("bank") ?? "").trim();
  if (bank !== "") {
    const hits = searchBranches(bank, q).map((h) => ({ ...h, display: h.name }));
    return NextResponse.json({ ok: true, updatedAt: bankMasterUpdatedAt(), hits });
  }
  const hits = searchBanks(q).map((h) => ({ ...h, display: bankMasterDisplayName(h.name) }));
  return NextResponse.json({ ok: true, updatedAt: bankMasterUpdatedAt(), hits });
}
