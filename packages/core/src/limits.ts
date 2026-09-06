// The limits that keep one member, or one runaway loop, from costing everyone
// else. All of them are settings with defaults rather than constants in the
// code, so an owner can loosen or tighten them without a deploy.
//
// These are pure functions on purpose: they are the part of the system that
// must be checkable without a network, a model or a database.

/** What a guild may do, and what one member may do to it. */
export type Limits = {
  /** Messages one member may send in the window before Kalvard stops replying. */
  memberBurst: number;
  memberWindowMs: number;
  /** How long the member is ignored once they pass it. */
  memberCooldownMs: number;
  /** The longest member message the model ever sees. */
  maxMessageChars: number;
  /** How many questions Kalvard answers for one guild in a calendar month. */
  monthlyAnswers: number;
  /** How many times an hour it may ping the mod role. 0 is no cap. */
  modPingsPerHour: number;
  /** The longest single document that may be ingested. */
  maxDocumentChars: number;
  /** How much a guild may hold in total, in chunks. */
  maxGuildChunks: number;
};

export const DEFAULT_LIMITS: Limits = {
  memberBurst: 8,
  memberWindowMs: 30_000,
  memberCooldownMs: 60_000,
  maxMessageChars: 2000,
  monthlyAnswers: 2000,
  modPingsPerHour: 0,
  maxDocumentChars: 200_000,
  maxGuildChunks: 5000,
};

type Window = { hits: number[]; until: number };
const windows = new Map<string, Window>();

/**
 * Whether to answer this member now. Twenty messages in thirty seconds is not
 * a conversation, and answering all of them is how a bot becomes the problem:
 * past the burst the member is quiet for the cooldown, and told once.
 */
export function allowMessage(
  key: string,
  limits: Limits = DEFAULT_LIMITS,
  now: number = Date.now(),
): { allowed: boolean; sayWhy: boolean } {
  const window = windows.get(key) ?? { hits: [], until: 0 };
  if (now < window.until) {
    windows.set(key, window);
    return { allowed: false, sayWhy: false };
  }
  const hits = window.hits.filter((at) => now - at < limits.memberWindowMs);
  hits.push(now);
  if (hits.length > limits.memberBurst) {
    windows.set(key, { hits: [], until: now + limits.memberCooldownMs });
    // The first refusal is spoken, so the member knows why it went quiet.
    return { allowed: false, sayWhy: true };
  }
  windows.set(key, { hits, until: 0 });
  // Whatever has gone cold is dropped, so the map cannot grow without bound.
  if (windows.size > 5000) {
    for (const [k, w] of windows) {
      if (w.hits.every((at) => now - at > limits.memberWindowMs) && now > w.until)
        windows.delete(k);
    }
  }
  return { allowed: true, sayWhy: false };
}

/** The guild's limits: whatever it set, over the defaults. */
export function parseLimits(value: unknown): Limits {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_LIMITS;
  const row = value as Record<string, unknown>;
  const number = (key: keyof Limits): number => {
    const found = row[key];
    return typeof found === 'number' && Number.isFinite(found) && found > 0
      ? found
      : DEFAULT_LIMITS[key];
  };
  return {
    memberBurst: number('memberBurst'),
    memberWindowMs: number('memberWindowMs'),
    memberCooldownMs: number('memberCooldownMs'),
    maxMessageChars: number('maxMessageChars'),
    monthlyAnswers: number('monthlyAnswers'),
    modPingsPerHour: number('modPingsPerHour'),
    maxDocumentChars: number('maxDocumentChars'),
    maxGuildChunks: number('maxGuildChunks'),
  };
}

/** Forgets a member's history. Used by the forget-me flow and by the tests. */
export function forgetMember(key: string): void {
  windows.delete(key);
}

/** The first instant of the month a date falls in, in UTC. Quotas run monthly. */
export function monthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * The message as the model should see it. A member who pastes three thousand
 * characters is answered on the first part of it rather than not at all, and
 * the cut is marked so the model knows something was left out.
 */
export function forModel(text: string, limits: Limits = DEFAULT_LIMITS): string {
  const trimmed = text.trim();
  if (trimmed.length <= limits.maxMessageChars) return trimmed;
  return `${trimmed.slice(0, limits.maxMessageChars)}… [truncated: the member sent ${trimmed.length} characters]`;
}
