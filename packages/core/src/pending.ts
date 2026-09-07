// A question already waiting on a moderator is one question, however many
// times it is said.
//
// Live, a member said the same thing four different ways inside a minute —
// "yes another tournament in november", "oh yes i confirm another tournament
// is in november", "yes", "yes but there is a tournament on november" — and
// Kalvard woke the moderators for each of them, repeating one sentence back
// word for word. Measured afterwards, the paraphrases sat at 0.907 and 0.874
// against the first: real restatements, under the 0.92 that decides two
// questions are the same one.
//
// Raising that bar for everybody is wrong: 0.92 is what makes a question
// asked in another channel a week later the same question, and it should stay
// strict there. What the old test missed is the conversation. The same person,
// in the same channel, a minute later, pressing the same point, is not asking
// a second question — they are asking again, which is what people do when
// nobody has answered yet. So the context decides the bar, and a member
// insisting is never a second moderator ping.

/** Two questions this close in meaning are the same question, anywhere. */
export const SAME_QUESTION = 0.92;
/** In one live exchange, this close is the same question too. */
export const SAME_EXCHANGE = 0.75;
/** How long an exchange stays live, in minutes. */
export const EXCHANGE_MINUTES = 30;

/** A pending question, and how it sits against the message just received. */
export type Waiting = {
  /** Cosine between the two, 0 to 1. */
  similarity: number;
  sameChannel: boolean;
  sameAsker: boolean;
  /** How long ago the pending question was asked, in minutes. */
  minutesAgo: number;
};

/**
 * Somebody saying the same thing again rather than asking something new.
 *
 * Short, and made of the words people use to press a point: yes, no, but, I
 * confirm. It is only ever consulted alongside a pending question from the
 * same person in the same channel minutes ago, so it can afford to be plain.
 */
export function pressing(message: string): boolean {
  const said = message.trim().toLowerCase();
  if (!said || said.length > 80) return false;
  const opener =
    /^(yes|yeah|yep|yup|ye|oui|ouais|si|no|non|nope|ok|okay|d'accord|but|mais|and|et|i confirm|je confirme|c'est|cest|bah|ben|bro)\b/;
  return opener.test(said);
}

/**
 * Whether this message is a question the moderators already have.
 *
 * Two ways it can be. Anywhere, at any time, near-identical wording: that is
 * the old rule and it is unchanged. Or inside one live exchange — same
 * channel, same person, the last half hour — where a loose match or a plain
 * "yes, but" is the same person pushing on the same thing.
 */
export function alreadyWaiting(waiting: Waiting, message: string): boolean {
  if (waiting.similarity >= SAME_QUESTION) return true;
  const live = waiting.sameChannel && waiting.sameAsker && waiting.minutesAgo <= EXCHANGE_MINUTES;
  if (!live) return false;
  return waiting.similarity >= SAME_EXCHANGE || pressing(message);
}

/**
 * Two lines that say the same thing, whatever the spacing and the case.
 *
 * The mod tag is taken out on both sides, because one sentence goes out as a
 * role mention when the moderators may be pinged and as the words "the
 * moderators" when they may not. Those are the same sentence, and posting the
 * second because the first wore a mention is the repetition all over again.
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/<@[!&]?\d+>/g, ' ')
    .replace(/\b(?:the |les )?mod(?:erator|érateur)s?\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Whether Kalvard has just said this.
 *
 * It repeated one sentence three times in a minute because nothing stopped
 * it. A bot that says the same thing twice is a bot people mute, so the line
 * is checked against what it last said in that channel before it goes out.
 */
export function saidAlready(reply: string, recent: string[]): boolean {
  const line = normalise(reply);
  if (!line) return false;
  return recent.some((said) => normalise(said) === line);
}
