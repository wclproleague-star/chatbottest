// A moderator's reply is an answer to one person. Knowledge is not.
//
// Filed word for word, a moderator's "yeah it's fine, just tell me before"
// teaches nothing: it has no subject, its "it" is three messages up, and the
// next member who asks a slightly different question gets that sentence read
// back at them like a parrot. What has to be kept is what the moderator
// actually said was true — the check-in closes an hour before, a substitute is
// allowed if it is declared first — written so a stranger reading it in six
// months knows what it is about without the conversation around it.
//
// So the reply is understood before it is stored: the model turns the exchange
// into standalone statements, and the code refuses anything that added to
// them. Nothing is invented here. A number that was not said is not written, a
// rewrite that runs away with itself is thrown out, and when the model is not
// available or not believable the moderator's own words are kept instead — the
// knowledge is never lost to make it prettier.

import { Type, generateJson } from './gemini';

/** What was understood from a moderator's answer. */
export type Learned = {
  /** What it is about, for the document's title. */
  title: string;
  /** The standalone statements, each true on its own. */
  facts: string[];
  /** What is stored and read into chunks. */
  text: string;
  /** False when the words themselves were kept because nothing else was safe. */
  understood: boolean;
};

/** Longest a single learned statement may be. */
const FACT_MAX = 400;
/** Most statements one answer may become. */
const FACT_LIMIT = 6;

/** Every run of digits in a piece of text. */
export function numbersIn(text: string): string[] {
  return text.match(/\d+/g) ?? [];
}

/**
 * Whether a rewrite stayed inside what was said.
 *
 * The model is good at reading an exchange and bad at resisting a helpful
 * detail, so the one thing checked in code is the one thing that hurts: a
 * figure, a time or a date that appears in the knowledge and was never said.
 * Length is checked too — a paragraph of the model's own reasoning in place of
 * a sentence is not an understanding of anything.
 */
export function keepsOnlyWhatWasSaid(facts: string[], source: string): boolean {
  if (facts.length === 0 || facts.length > FACT_LIMIT) return false;
  const said = new Set(numbersIn(source));
  let total = 0;
  for (const fact of facts) {
    const line = fact.trim();
    if (line.length < 3 || line.length > FACT_MAX) return false;
    total += line.length;
    for (const number of numbersIn(line)) {
      if (!said.has(number)) return false;
    }
  }
  return total <= source.length * 3 + 200;
}

/** The moderator's own words, kept as they were said. */
export function fallback(question: string, answer: string): Learned {
  return {
    title: question.trim().slice(0, 120) || 'What a moderator answered',
    facts: [answer.trim()],
    text: `Q: ${question.trim()}\nA: ${answer.trim()}`,
    understood: false,
  };
}

/** What is written into the document: the statements, then what was asked. */
function compose(title: string, facts: string[], question: string): string {
  return [title, '', ...facts.map((fact) => `- ${fact}`), '', `Asked as: ${question.trim()}`].join(
    '\n',
  );
}

/**
 * The knowledge inside a moderator's answer.
 *
 * The question is given as well as the reply, because half of what a "yes"
 * means lives in what was asked. Dates have already been made absolute before
 * this runs, so "this Sunday" arrives as the day it means and is kept as one.
 */
export async function learnFrom(input: {
  question: string;
  answer: string;
  /** The server, so a statement can name it rather than say "here". */
  guildName?: string;
}): Promise<Learned> {
  const question = input.question.trim();
  const answer = input.answer.trim();
  if (!answer) return fallback(question, answer);
  const source = `${question}\n${answer}`;

  let raw: { title?: string; facts?: string[] };
  try {
    raw = await generateJson<{ title: string; facts: string[] }>({
      system: [
        'A moderator has just answered a member question in a Discord server' +
          (input.guildName ? ` (${input.guildName})` : '') +
          '. Turn that exchange into knowledge the assistant can answer from later.',
        'Write each thing the moderator established as its own statement, complete on its own: no "it", no "there", no "yes" — say what the thing is. Somebody reading the statement a year from now, with none of this conversation in front of them, must understand it.',
        'Keep every name, number, date, time and channel exactly as it was said. Never add a detail that is not in the exchange, however obvious it seems, and never soften or generalise one that is.',
        'Drop the greetings, the thanks, the pings and anything about the conversation itself. If the moderator said something that is not a fact about the server — an instruction to the bot, an aside — leave it out.',
        "Write in the language the moderator wrote in: a French server's knowledge is French, and a fact translated on the way in comes back out translated.",
        'title is a short phrase naming the subject, the way a page in a rulebook is titled. facts is the statements, at most six, usually one or two.',
      ].join(' '),
      messages: [{ role: 'user', text: `Question: ${question}\nModerator: ${answer}` }],
      schema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          facts: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['title', 'facts'],
        propertyOrdering: ['title', 'facts'],
      },
      temperature: 0,
      maxOutputTokens: 600,
    });
  } catch {
    return fallback(question, answer);
  }

  const facts = (raw.facts ?? []).map((fact) => String(fact).trim()).filter(Boolean);
  if (!keepsOnlyWhatWasSaid(facts, source)) return fallback(question, answer);
  const title = (raw.title ?? '').trim().slice(0, 120) || question.slice(0, 120);
  return { title, facts, text: compose(title, facts, question), understood: true };
}
