// "but where" is about whatever was just said.
//
// A member asked what the weather was like, was told, asked "oh in paris
// right?", was told, and then wrote "but where". Kalvard answered "PPG is on
// Fast Forward": it went looking for a subject, found the member's own roles
// sitting in its context, and answered a question nobody had asked. From the
// outside that reads as the bot having no short memory at all, which is the
// worst thing a conversation can look like.
//
// The conversation was there the whole time. What was missing is the rule that
// a message too short to carry its own subject takes the subject of the line
// before it — the way people talk, where "but where" after a weather reading
// is about the weather and about nothing else.

/**
 * Words that ask for a missing piece rather than naming a subject.
 *
 * The end of each is marked by "no letter follows" rather than by a word
 * boundary: an accented letter is not a word character, so a boundary after
 * "où" never matches and the French half of this quietly did nothing.
 */
const ASKS_FOR_A_DETAIL =
  /^(?:where|when|which|who|why|how|what|whose|où|ou|quand|qui|quoi|quel|quelle|combien|comment|pourquoi)(?!\p{L})/u;

/** Openers that lean on the sentence before them rather than starting one. */
const LEANS_BACK = /^(?:but|and|so|then|ok|okay|oh|et|mais|donc|alors|bah|ben|non|no|si)(?!\p{L})/u;

/** How many words a message may have and still be leaning on the last one. */
const SHORT = 6;

/**
 * Whether this message is too short to carry its own subject.
 *
 * Deliberately narrow. A message that names anything — a role, a place, a
 * tournament — is a subject of its own and is left alone; this catches the
 * fragments that are only meaningful after something else: "but where", "and
 * when", "which one", "ok but why".
 */
export function isElliptical(message: string): boolean {
  const said = message
    .toLowerCase()
    .replace(/[?!.,;:"()]/g, ' ')
    .trim();
  if (!said) return false;
  const words = said.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > SHORT) return false;

  // Strip the openers, then ask whether what is left is only a question word.
  let rest = words;
  while (rest.length > 0 && LEANS_BACK.test(rest[0] ?? '')) rest = rest.slice(1);
  if (rest.length === 0) return false;
  if (!ASKS_FOR_A_DETAIL.test(rest[0] ?? '')) return false;
  // "where is the bracket posted" names its subject; "but where" does not.
  return rest.length <= 2;
}

/**
 * The line the prompt carries when a fragment arrives.
 *
 * It states the one thing the model got wrong on its own: the subject is
 * settled already, and the member's roles are not it.
 */
export function carryOn(lastSaid: string): string {
  const said = lastSaid.trim().slice(0, 300);
  if (!said) return '';
  return `- Their message is a fragment, not a new question: it is about what you just said ("${said}"). Answer it on that subject, or ask for the one detail it is missing. It is not about the member, their roles, their team or their channels, and nothing in the knowledge changes that.`;
}
