/**
 * 中野くんの概算費用。
 *
 * 管理画面と費用アラートCron の2箇所で使うので、単価と計算をここに1本化する。
 * 別々に持つと、モデルを切り替えたときに片方だけ古い単価のまま残る。
 */

/** トークン数だけを見て費用を出すための最小の形。NakanoUsage もこれを満たす */
export type NakanoTokenCounts = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
};

export type NakanoPricing = {
  inputPer1M: number;
  cacheReadPer1M: number;
  cacheWritePer1M: number;
  outputPer1M: number;
  usdPerJpy: number;
};

/**
 * 1日あたりの費用がこの円を超えたら Slack に知らせる。
 * 「1日1,000円までは今のモデル、超えたら下位モデルを試す」という運用ルールに合わせた既定値。
 */
export const NAKANO_DAILY_YEN_ALERT_DEFAULT = 1000;

export function readNakanoDailyYenAlert(): number {
  const raw = Number(process.env.NAKANO_DAILY_YEN_ALERT ?? NAKANO_DAILY_YEN_ALERT_DEFAULT);
  return Number.isFinite(raw) && raw > 0 ? raw : NAKANO_DAILY_YEN_ALERT_DEFAULT;
}

/**
 * 単価。既定は Claude Opus 5。環境変数で上書きできるようにしてあるのは、
 * モデルを切り替えたときに費用表示だけ古い単価のまま残るのを防ぐため。
 *
 * キャッシュは通常入力と単価が違う（読み出しは約1/10、書き込みは1時間TTLで約2倍）。
 * ここを通常入力の単価で計算すると、概算費用が実際の10倍近くに膨らむ。
 */
export function readNakanoPricing(): NakanoPricing {
  const num = (v: string | undefined, fallback: number) => {
    const n = Number(v ?? fallback);
    return Number.isFinite(n) ? n : fallback;
  };
  const inputPer1M = num(process.env.NAKANO_PRICE_INPUT_PER_1M, 5);
  return {
    inputPer1M,
    cacheReadPer1M: num(process.env.NAKANO_PRICE_CACHE_READ_PER_1M, inputPer1M * 0.1),
    cacheWritePer1M: num(process.env.NAKANO_PRICE_CACHE_WRITE_PER_1M, inputPer1M * 2),
    outputPer1M: num(process.env.NAKANO_PRICE_OUTPUT_PER_1M, 25),
    usdPerJpy: num(process.env.NAKANO_USD_JPY, 155),
  };
}

/** 概算費用（円）。丸めないので、呼び出し側で用途に応じて丸める */
export function estimateNakanoYen(counts: NakanoTokenCounts, pricing: NakanoPricing): number {
  const usd =
    (counts.inputTokens / 1_000_000) * pricing.inputPer1M +
    (counts.cacheReadTokens / 1_000_000) * pricing.cacheReadPer1M +
    (counts.cacheWriteTokens / 1_000_000) * pricing.cacheWritePer1M +
    (counts.outputTokens / 1_000_000) * pricing.outputPer1M;
  const yen = usd * pricing.usdPerJpy;
  // 環境変数に数値でない値が入ると NaN が画面に出てしまうので 0 に倒す。
  return Number.isFinite(yen) ? yen : 0;
}

/**
 * キャッシュが効いた割合（0〜1）。効いていない日は1問あたりの費用が跳ね上がるので、
 * 費用が高いときに最初に見る数字になる。読み書きが0件の日は null。
 */
export function nakanoCacheHitRate(counts: NakanoTokenCounts): number | null {
  const total = counts.cacheReadTokens + counts.cacheWriteTokens;
  if (total <= 0) return null;
  return counts.cacheReadTokens / total;
}
