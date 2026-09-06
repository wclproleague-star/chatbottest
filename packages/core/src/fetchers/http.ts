// Fetching from somebody else's server, safely.
//
// A data source is a URL an owner typed into a form, and this process can
// reach the database and the internal network. So the rules are not about
// politeness: https only, no credentials in the URL, no redirect to another
// host, no private or loopback address, a hard deadline, and a cap on how much
// is read. A source that breaks one of those does not fetch; the loop then
// says plainly that it could not look it up.

/** How long any one source may take before it is abandoned. */
export const DEFAULT_TIMEOUT_MS = 4000;
/** The most any source may return. Beyond this the answer is unusable anyway. */
const MAX_BYTES = 512_000;

export class SourceError extends Error {}

/** Whether a hostname points somewhere this process should never call. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal'))
    return true;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd')) return true;
  const parts = host.split('.');
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    const [a = 0, b = 0] = parts.map(Number) as [number, number, number, number];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    // The cloud metadata address, which is the one that actually gets stolen.
    if (a === 169 && b === 254) return true;
  }
  return false;
}

/** The URL an owner gave, checked before anything is sent to it. */
export function safeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SourceError('That is not a URL.');
  }
  if (url.protocol !== 'https:') throw new SourceError('The address has to start with https.');
  if (url.username || url.password) {
    throw new SourceError('Put credentials in a header, not in the address.');
  }
  if (isPrivateHost(url.hostname)) {
    throw new SourceError('That address is on a private network, so Kalvard will not call it.');
  }
  return url;
}

/**
 * One GET, with a deadline, no redirects off the host, and a size cap. Returns
 * the parsed JSON, or throws a SourceError saying what a person should do.
 */
export async function getJson(
  raw: string,
  options: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<unknown> {
  const url = safeUrl(raw);
  const response = await fetch(url, {
    headers: { accept: 'application/json', ...(options.headers ?? {}) },
    redirect: 'manual',
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    throw new SourceError(
      /timeout|abort/i.test(message) ? 'It did not answer in time.' : 'It could not be reached.',
    );
  });

  if (response.status >= 300 && response.status < 400) {
    throw new SourceError('It redirected somewhere else, so Kalvard stopped.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new SourceError('It refused the request. Check the key.');
  }
  if (!response.ok) throw new SourceError(`It answered ${response.status}.`);

  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) throw new SourceError('It sent back more than Kalvard will read.');
  const text = (await response.text()).slice(0, MAX_BYTES);
  try {
    return JSON.parse(text);
  } catch {
    throw new SourceError('It did not send back JSON.');
  }
}
