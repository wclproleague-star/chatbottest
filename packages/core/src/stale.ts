// Anything about the world outside the server moves, and Kalvard's copy of it
// does not.
//
// The prompt asks for the caveat, and the model usually writes it: "the
// current patch is 6.2, though that may have changed". Usually is the problem.
// A member asking which patch is live gets a bare number roughly one time in
// six, believes it, and turns up to a match on the wrong build — and the one
// answer where the caveat is missing is exactly the one that does harm.
//
// So the caveat is not left to phrasing. When a conversation reply is about
// something that moves and does not already say so, the sentence is added
// here, in the language the reply is written in. Nothing is removed and the
// reply's own words are untouched.

/** Subjects whose answer is out of date the week after it is given. */
const MOVES =
  /\b(patch|m[ée]ta|meta|version|tier ?list|classement|ranking|leaderboard|prix|price|co[uû]te?|news|actualit|mise ?[àa] ?jour|update|current|actuel|derni[eè]re?|latest|nerf|buff|banlist|ban ?list)\b/i;

/** What a caveat looks like, however it was phrased. */
const ALREADY_SAID =
  /\b(out of date|may have changed|might have changed|no longer|not be current|check|v[ée]rifie|pas ?[àa] ?jour|plus ?[àa] ?jour|peut avoir chang|a pu changer|susceptible de changer|confirme)\b/i;

/** French, near enough, from the words only French sentences carry. */
function readsFrench(text: string): boolean {
  return /\b(le|la|les|des|une|un|est|sont|c'est|tu|je|pour|avec|dans|sur|pas|plus|mais|donc)\b/i.test(
    text,
  );
}

/**
 * The reply, with the one sentence added that keeps it honest.
 *
 * `question` is read as well as the reply: "what's the current patch?"
 * answered with a bare number says nothing about patches on its own.
 */
export function withStaleness(reply: string, question: string): string {
  const said = reply.trim();
  if (!said) return reply;
  if (!MOVES.test(`${question} ${said}`)) return said;
  if (ALREADY_SAID.test(said)) return said;
  const caveat = readsFrench(said)
    ? "Ça bouge vite par contre, vérifie que c'est toujours à jour."
    : 'That moves fast though, so check it is still current.';
  return `${said} ${caveat}`;
}
