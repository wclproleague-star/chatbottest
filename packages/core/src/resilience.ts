// What to do when something the bot depends on is down.
//
// The rule everywhere: never hang, never guess, never wake a moderator over an
// outage. A dependency that fails is Kalvard's problem and the member is told
// so in one honest line; the failure is recorded with its class so an owner can
// see that Monday's silence was the model, not the knowledge.

/** What went wrong, in the only categories worth telling apart. */
export type ErrorClass =
  'timeout' | 'rate_limited' | 'unavailable' | 'permission' | 'not_found' | 'unknown';

/** How a failing call is retried: three tries, backing off, with jitter. */
export type RetryOptions = {
  attempts: number;
  baseMs: number;
  /** The longest any single attempt may take before it is abandoned. */
  timeoutMs: number;
};

export const DEFAULT_RETRY: RetryOptions = { attempts: 3, baseMs: 400, timeoutMs: 20_000 };

/** The class of a failure, from whatever the library threw. */
export function classify(error: unknown): ErrorClass {
  const status =
    typeof error === 'object' && error !== null
      ? Number(
          (error as { status?: unknown; code?: unknown }).status ??
            (error as { code?: unknown }).code ??
            NaN,
        )
      : NaN;
  const text = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (status === 429 || text.includes('rate limit') || text.includes('too many requests')) {
    return 'rate_limited';
  }
  if (
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('aborted') ||
    status === 408
  ) {
    return 'timeout';
  }
  if (status === 403 || text.includes('missing permissions') || text.includes('forbidden')) {
    return 'permission';
  }
  if (status === 404 || text.includes('unknown channel') || text.includes('unknown role')) {
    return 'not_found';
  }
  if (
    (status >= 500 && status < 600) ||
    text.includes('fetch failed') ||
    text.includes('unavailable') ||
    text.includes('econnrefused') ||
    text.includes('enotfound')
  ) {
    return 'unavailable';
  }
  return 'unknown';
}

/** Whether trying again could plausibly work. A permission never fixes itself. */
export function worthRetrying(kind: ErrorClass): boolean {
  return kind === 'timeout' || kind === 'rate_limited' || kind === 'unavailable';
}

/** How long to wait before attempt n, backing off with a little jitter. */
export function backoffMs(attempt: number, baseMs: number, random = Math.random): number {
  const flat = baseMs * 2 ** (attempt - 1);
  return Math.round(flat * (0.7 + random() * 0.6));
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Runs something that talks to another system, with a deadline on each try and
 * a backoff between them. A failure that cannot be fixed by waiting is thrown
 * straight away rather than retried three times for nothing.
 */
export async function withRetry<T>(
  work: (signal: AbortSignal) => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const { attempts, baseMs, timeoutMs } = { ...DEFAULT_RETRY, ...options };
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await work(AbortSignal.timeout(timeoutMs));
    } catch (error) {
      last = error;
      const kind = classify(error);
      if (!worthRetrying(kind) || attempt === attempts) break;
      await sleep(backoffMs(attempt, baseMs));
    }
  }
  throw last;
}

/**
 * What a member is told when Kalvard itself is broken. Short, honest, no
 * moderators: they cannot fix an outage, and being paged for one is noise.
 */
export function outageReply(kind: ErrorClass): string {
  switch (kind) {
    case 'timeout':
    case 'unavailable':
      return 'Something on my side is not answering right now. Try me again in a minute.';
    case 'rate_limited':
      return 'I am being asked a lot at once. Give me a minute and ask again.';
    default:
      return 'Something went wrong on my side. Try me again in a minute.';
  }
}
