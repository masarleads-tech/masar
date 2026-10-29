/** Runs `fn` with a time limit. The signal tells the work to stop; the promise rejects with TimeoutError. */
export class TimeoutError extends Error {}

export async function withTimeout<T>(ms: number, parent: AbortSignal | undefined, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort(parent?.reason);
  parent?.addEventListener("abort", onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(ctrl.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { ctrl.abort(); reject(new TimeoutError(`timed out after ${Math.round(ms / 1000)}s`)); }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", onAbort);
  }
}

export const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason ?? new Error("aborted")); }, { once: true });
});

/** Fetch that retries rate limits and server errors with exponential backoff, honouring Retry-After. */
export async function fetchWithBackoff(fetchFn: typeof fetch, url: string, init: RequestInit = {}, opts: { retries?: number; baseMs?: number } = {}): Promise<Response> {
  const retries = opts.retries ?? 2, base = opts.baseMs ?? 800;
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(url, init);
    if (attempt >= retries || !(res.status === 429 || res.status >= 500)) return res;
    const after = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 30_000) : base * 2 ** attempt, init.signal ?? undefined);
  }
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
