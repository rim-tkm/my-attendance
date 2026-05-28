export type NetworkRetryOptions = {
  /** 既定 3（初回含め最大試行回数） */
  maxAttempts?: number;
  /** 再試行前の待ち（ms）。試行ごとに 1,2,3… 倍される */
  baseDelayMs?: number;
  /** 1 回あたりの最大待ち時間（ms）。超えたらタイムアウトとして再試行 */
  perAttemptTimeoutMs?: number;
};

const NETWORK_TIMEOUT_ERROR = "NETWORK_RETRY_TIMEOUT";

function runWithOptionalTimeout<T>(fn: () => Promise<T>, timeoutMs?: number): Promise<T> {
  if (timeoutMs == null || timeoutMs <= 0) return fn();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(NETWORK_TIMEOUT_ERROR)), timeoutMs);
    fn()
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

/**
 * 通信系の一時失敗向けに、最大 `maxAttempts` 回まで `fn` を再試行する。
 */
export async function withNetworkRetry<T>(fn: () => Promise<T>, options?: NetworkRetryOptions): Promise<T> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
  const baseDelayMs = Math.max(0, options?.baseDelayMs ?? 500);
  const perAttemptTimeoutMs = options?.perAttemptTimeoutMs;
  let last: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runWithOptionalTimeout(fn, perAttemptTimeoutMs);
    } catch (e) {
      last = e;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
      }
    }
  }
  throw last;
}

export { NETWORK_TIMEOUT_ERROR };
