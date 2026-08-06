import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getTodayJstDateString } from "@/lib/export-schedule";
import { loadNakanoUsageForMonth } from "@/lib/nakano-data";

function isAdmin(session: { user?: { loginId?: string } } | null): boolean {
  return (session?.user?.loginId ?? "").toLowerCase() === "admin";
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 当月の使用状況と概算費用（管理者のみ） */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ ok: false, error: "管理者のみ利用できます" }, { status: 403 });
  }

  // サーバーのタイムゾーンに引きずられないよう、当月は JST の「今日」から切り出す。
  const month = (new URL(req.url).searchParams.get("month") ?? "").trim() || getTodayJstDateString().slice(0, 7);
  if (!MONTH_PATTERN.test(month)) {
    return NextResponse.json({ ok: false, error: "月の指定が不正です（YYYY-MM）" }, { status: 400 });
  }

  // 料金は環境変数で上書き可能。モデルを切り替えたときに費用表示だけ古いまま残るのを防ぐ。
  const inputPer1M = Number(process.env.NAKANO_PRICE_INPUT_PER_1M ?? 5);
  const outputPer1M = Number(process.env.NAKANO_PRICE_OUTPUT_PER_1M ?? 25);
  const usdPerJpy = Number(process.env.NAKANO_USD_JPY ?? 155);
  // キャッシュは通常入力と単価が違う。読み出しは約1/10、書き込みは1時間TTLで約2倍。
  // 知識ブロックにキャッシュを効かせている以上、入力の大半はキャッシュ読み出しになるので、
  // ここを通常入力の単価で計算すると概算費用が実際の10倍近くに膨らむ。
  const cacheReadPer1M = Number(process.env.NAKANO_PRICE_CACHE_READ_PER_1M ?? inputPer1M * 0.1);
  const cacheWritePer1M = Number(process.env.NAKANO_PRICE_CACHE_WRITE_PER_1M ?? inputPer1M * 2);

  try {
    const usage = await loadNakanoUsageForMonth(month);
    const usd =
      (usage.inputTokens / 1_000_000) * inputPer1M +
      (usage.cacheReadTokens / 1_000_000) * cacheReadPer1M +
      (usage.cacheWriteTokens / 1_000_000) * cacheWritePer1M +
      (usage.outputTokens / 1_000_000) * outputPer1M;
    const yen = usd * usdPerJpy;
    // 環境変数に数値でない値が入ると NaN が画面に出てしまうので 0 に倒す。
    const estimatedYen = Number.isFinite(yen) ? Math.round(yen) : 0;
    return NextResponse.json({ ok: true, usage, estimatedYen });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
