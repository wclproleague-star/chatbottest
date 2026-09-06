// Which role somebody meant, out of everything the server actually has.
//
// Kalvard only ever hands out the roles the owner marked as self-serve, and
// that does not change. What changes here is what it knows: it can see every
// role on the server, so it can tell a role it does not hand out from a role
// that does not exist.
//
// And it does not ask people to type a name the way Discord stores it. Members
// write "ttk" for Train To Kill, "saphire" for Sapphire, "the qualifiers role"
// for Qualifiers players. Each of those has one obvious reading, and the
// honest thing is to put that reading back as a question — "you mean Train To
// Kill?" — rather than answer a request nobody made or deny a role that is
// right there. It never picks for them: one near match is a question, several
// are a list, and nothing is nothing.

export type RoleMatch =
  /** One of the owner's self-serve roles: Kalvard's to give, after the proof. */
  | { kind: 'self_serve'; role: { id: string; name: string } }
  /** A real role on this server that Kalvard does not hand out. */
  | { kind: 'not_mine'; role: { id: string; name: string } }
  /** Nothing named exactly, but these are what they probably meant. */
  | { kind: 'did_you_mean'; candidates: { id: string; name: string }[] }
  /** Nothing on this server comes close. */
  | { kind: 'unknown' };

/**
 * Whether the message is asking for something, rather than mentioning it.
 *
 * A near match is only ever put back as a question when somebody was asking:
 * "train to kill was fun yesterday" names a role and requests nothing, and
 * answering it with "you mean Train to kill?" would be Kalvard interrupting a
 * conversation it was not in.
 */
export function asksForRole(message: string): boolean {
  const text = fold(message);
  const words = new Set(text.split(/[^a-z0-9]+/).filter(Boolean));
  if (words.has('role') || words.has('roles')) return true;
  for (const word of words) if (ASKING.has(word)) return true;
  // The openings a request usually starts with, which are two words, not one.
  return OPENINGS.some((opening) => text.includes(opening));
}

/**
 * Whether this conversation is about getting a role at all.
 *
 * The message itself, or anything the member said earlier in the same
 * conversation: "yes please" is an answer to the question before it, not a new
 * subject. Everything that only makes sense while somebody is trying to get a
 * role hangs off this — without it, a question about registering for a
 * tournament comes back as a menu of roles.
 */
export function aboutARole(message: string, earlier: unknown[]): boolean {
  if (asksForRole(message)) return true;
  return earlier.some((turn) => {
    if (!turn || typeof turn !== 'object') return false;
    const said = turn as { role?: unknown; text?: unknown };
    return said.role === 'user' && typeof said.text === 'string' && asksForRole(said.text);
  });
}

/**
 * The verbs a request is put in, in both languages, matched as whole words.
 *
 * A set of words rather than one long pattern: the word boundaries in a
 * pattern like that are exactly what gets mangled on the way through a shell,
 * and a boundary that quietly turned into a control character would make this
 * function answer no to everything without failing a type check.
 */
const ASKING = new Set([
  'give',
  'gimme',
  'grant',
  'add',
  'assign',
  'want',
  'need',
  'donne',
  'donnez',
  'passe',
  'mets',
  'met',
  'veux',
  'voudrais',
  'aimerais',
]);

const OPENINGS = ['can i', 'could i', 'may i', 'i want', 'i need', 'je veux', 'je peux', 'puis je'];

/** More than this is not a shortlist, it is the role list read out. */
const MOST_CANDIDATES = 3;

/**
 * The role named in a message, if exactly one is, and otherwise the ones it
 * could have been.
 *
 * Exact names first: a member who typed the name in full has already been
 * clear. Two exact names is a question rather than a request, and picking one
 * would be guessing at which.
 */
export function whichRole(
  message: string,
  selfServe: { id: string; name: string }[],
  allRoles: { id: string; name: string }[],
): RoleMatch {
  const everything = longest(named(message, allRoles));
  if (everything.length > 1) return { kind: 'unknown' };
  if (everything.length === 1) {
    const role = everything[0]!;
    return selfServe.some((r) => r.id === role.id)
      ? { kind: 'self_serve', role }
      : { kind: 'not_mine', role };
  }

  const near = nearest(message, allRoles);
  return near.length > 0 ? { kind: 'did_you_mean', candidates: near } : { kind: 'unknown' };
}

/**
 * The roles a text names, as whole words, longest first and nothing twice.
 *
 * "Do you want Fast Forward Test?" names Fast Forward Test and not Fast
 * Forward, even though the shorter name sits inside the longer one. Live,
 * reading it as both is what let a question about the wrong role through: it
 * looked as though every reading had been named.
 */
export function namedRoles(
  text: string,
  roles: { id: string; name: string }[],
): { id: string; name: string }[] {
  // Longest names first, and each one found is struck out of the text
  // before the shorter ones are looked for, so a name only counts where it
  // stands on its own.
  let left = fold(text);
  const out: { id: string; name: string }[] = [];
  for (const role of [...named(text, roles)].sort((a, b) => b.name.length - a.name.length)) {
    let seen = false;
    for (const form of new Set([fold(role.name), plain(role.name)].filter(Boolean))) {
      const pattern = new RegExp(`(^|[^a-z0-9])(${escape(form)})([^a-z0-9]|$)`, 'g');
      if (!pattern.test(left)) continue;
      seen = true;
      left = left.replace(pattern, (_, before: string, hit: string, after: string) => {
        return before + ' '.repeat(hit.length) + after;
      });
    }
    if (seen) out.push(role);
  }
  return out;
}

/**
 * Of several exact matches, the ones whose names nothing else contains.
 *
 * A server with both "Fast Forward" and "Fast Forward Test" is ordinary, and
 * a message naming the second names the first as well. That is not an
 * ambiguity: the longer name is the one that was typed. Two names that merely
 * both appear, neither inside the other, still is one.
 */
function longest(matches: { id: string; name: string }[]): { id: string; name: string }[] {
  return matches.filter(
    (role) =>
      !matches.some((other) => other.id !== role.id && fold(other.name).includes(fold(role.name))),
  );
}

/**
 * The roles a message could have meant, best first.
 *
 * Three ways people write a name that is not the name: its initials, a part of
 * it, and a near spelling of it. Each scores differently so the surer reading
 * comes first, and only the best score is offered — a message that matches one
 * role by its initials should not also offer three it merely resembles.
 *
 * A message that looks like none of them returns nothing. There is always a
 * closest role in a list of a hundred, and offering it would be inventing a
 * request.
 */
export function nearest(
  message: string,
  roles: { id: string; name: string }[],
): { id: string; name: string }[] {
  // Two letters are enough to be initials ("ff"), and nothing else: a
  // two-letter word is never a piece of a name or a near spelling of one.
  const words = fold(message)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2 && !STOP.has(word));
  if (words.length === 0) return [];

  const scored: { role: { id: string; name: string }; score: number }[] = [];
  for (const role of roles) {
    const name = fold(role.name);
    if (!name) continue;
    const parts = name.split(/[^a-z0-9]+/).filter(Boolean);
    const initials = parts.map((part) => part[0]).join('');

    let score = 0;
    for (const word of words) {
      // Initials, which is how a long name actually gets written. "ff" is as
      // much Fast Forward Test as Fast Forward: a server that has both gets
      // asked which, not a guess at one.
      if (parts.length > 1 && (word === initials || initials.startsWith(word))) {
        score = Math.max(score, 3);
      } else if (word.length < 3) continue;
      // One of its words, or a long enough piece of it.
      else if (parts.includes(word)) score = Math.max(score, 2);
      else if (word.length >= 4 && name.includes(word)) score = Math.max(score, 2);
      // A near spelling of one of its words.
      else if (parts.some((part) => close(word, part))) score = Math.max(score, 1);
    }
    if (score > 0) scored.push({ role, score });
  }
  if (scored.length === 0) return [];

  // Best score only, shortest name first: the shorter name is the one the
  // words covered more completely.
  scored.sort((a, b) => b.score - a.score || a.role.name.length - b.role.name.length);
  const best = scored[0]!.score;
  return scored
    .filter((entry) => entry.score === best)
    .slice(0, MOST_CANDIDATES)
    .map((entry) => entry.role);
}

/** Words that are in every request and name no role, in both languages. */
const STOP = new Set([
  'the',
  'role',
  'roles',
  'give',
  'gimme',
  'can',
  'get',
  'got',
  'have',
  'want',
  'need',
  'please',
  'and',
  'for',
  'you',
  'your',
  'this',
  'that',
  'with',
  'what',
  'moi',
  'donne',
  'peux',
  'avoir',
  'stp',
  'svp',
  'les',
  'des',
  'une',
  'rôle',
  'role',
  // Words that point at the list, not at a name on it.
  'other',
  'others',
  'autre',
  'autres',
  'which',
  'else',
  'all',
  'any',
  'mean',
  'yes',
  'yeah',
  'nope',
  'non',
  'oui',
  'not',
  'pas',
  'keep',
  'saying',
]);

/**
 * Every role whose name appears in the message, as a whole word.
 *
 * Servers decorate role names — "Streamer 📺", "Staff 📞" — and nobody types
 * the emoji. Typing the name without it is typing the name, so both the stored
 * name and its undecorated form count as exact.
 */
function named(
  message: string,
  roles: { id: string; name: string }[],
): { id: string; name: string }[] {
  const text = fold(message);
  return roles.filter((role) => {
    const forms = new Set([fold(role.name), plain(role.name)].filter(Boolean));
    for (const form of forms) {
      // A whole word, so "ttk" does not match inside "attack" and a two-word
      // role still matches the two words in order.
      if (new RegExp(`(^|[^a-z0-9])${escape(form)}([^a-z0-9]|$)`).test(text)) return true;
    }
    return false;
  });
}

/** The name with its decoration taken off: letters, digits and single spaces. */
function plain(name: string): string {
  return fold(name)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** One edit apart for a short word, two for a long one. */
function close(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 2) return false;
  const allowed = Math.min(a.length, b.length) >= 7 ? 2 : 1;
  return distance(a, b) <= allowed;
}

/** Levenshtein, over two rows rather than a whole matrix. */
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost);
    }
    previous = row;
  }
  return previous[b.length]!;
}

/** Lower case, accents removed, so "Modérateur" matches "moderateur". */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(
      new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g'),
      '',
    )
    .trim();
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
