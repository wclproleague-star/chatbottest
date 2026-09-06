// Whether a new message continues the conversation, or starts one.
//
// An open conversation exists so a follow-up lands in the same turn: somebody
// asked which role, and "yes" is the answer to that rather than a new request.
// It is not a leash. A member who says hello, or asks about something else
// entirely, has changed the subject, and carrying the old turns into the new
// one makes Kalvard answer a question nobody asked — which is exactly what
// "salut bg" coming back as "what tournament role do you want?" was.
//
// Kept deterministic on purpose. Whether to drop what was said before is a
// decision about the shape of the conversation, and the model is the last
// thing that should be asked whether its own previous question still stands.

/** Yes and no, in both languages, as people actually type them. */
const AGREEING = new Set([
  'yes',
  'yeah',
  'yep',
  'ye',
  'sure',
  'ok',
  'okay',
  'please',
  'exactly',
  'oui',
  'ouais',
  'ok',
  'daccord',
  "d'accord",
  'exactement',
  'carrement',
  'no',
  'nope',
  'non',
  'nan',
]);

/** Words that carry no subject, so sharing one means nothing. */
const EMPTY = new Set([
  'the',
  'that',
  'this',
  'what',
  'which',
  'want',
  'you',
  'your',
  'and',
  'for',
  'with',
  'have',
  'role',
  'roles',
  'like',
  'give',
  'them',
  'they',
  'does',
  'about',
  'quel',
  'quelle',
  'veux',
  'avec',
  'pour',
  'rôle',
]);

/**
 * Whether this message answers what was last asked.
 *
 * Three ways it can: it is a yes or a no, it repeats one of the words the
 * question was about, or it is short enough to be a fragment of an answer
 * rather than a sentence of its own.
 */
export function answersTheQuestion(message: string, earlier: unknown[]): boolean {
  const lastAsked = lastModelTurn(earlier);
  if (!lastAsked) return false;

  const words = terms(message);
  if (words.length === 0) return false;
  if (words.every((word) => AGREEING.has(word))) return true;

  // Only words long enough to be a subject. "do" appears in every question
  // ever asked, and sharing it says nothing about what a message is about.
  const asked = new Set(terms(lastAsked).filter((word) => word.length >= 4 && !EMPTY.has(word)));
  return words.some((word) => word.length >= 4 && asked.has(word));
}

function lastModelTurn(earlier: unknown[]): string | null {
  for (let i = earlier.length - 1; i >= 0; i--) {
    const turn = earlier[i];
    if (!turn || typeof turn !== 'object') continue;
    const said = turn as { role?: unknown; text?: unknown };
    if (said.role === 'model' && typeof said.text === 'string') return said.text;
  }
  return null;
}

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(
      new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g'),
      '',
    )
    .split(/[^a-z0-9']+/)
    .filter((word) => word.length >= 2);
}
