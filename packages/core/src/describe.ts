// What a document is, so a paragraph out of it can be read properly.
//
// Retrieval hands the model a piece of text and an id. The piece does not say
// what it was cut out of, and the same words mean different things depending:
// "the delay is three minutes" is a rule in the official rulebook and a
// suggestion in a draft somebody pasted to argue about. Worse, an old season's
// schedule and this one's look identical from the inside.
//
// So each document carries one or two sentences saying what it is and what it
// covers, written once when it is read in, and shown beside every chunk that
// comes back from it. The owner's own words win when they gave any: nobody
// knows a server's documents better than the person who runs it.

import { Type, generateJson } from './gemini';

/**
 * Under this, the document is its own note: two lines of text say what they
 * are by being read. Above it, a paragraph out of the middle does not.
 */
const TOO_SHORT = 80;
/** How much of a document the note is written from. */
const SAMPLE = 6000;
/** A note longer than this is not a note. */
const NOTE_MAX = 300;

/** Whether what came back is a note about the document rather than an essay. */
export function usable(note: string): boolean {
  const line = note.trim();
  if (line.length < 15 || line.length > NOTE_MAX) return false;
  // The model occasionally answers with the document instead of describing it.
  return !line.includes('\n\n');
}

/**
 * One or two sentences saying what a document is and what it covers.
 *
 * Returns an empty string rather than a guess: a document with no note is
 * shown to the model exactly as it is today, which is no worse than before.
 */
export async function describeDocument(input: {
  title: string | null;
  text: string;
  /** Where it came from, which says a lot on its own. */
  sourceType?: string | null;
}): Promise<string> {
  const text = input.text.trim();
  if (text.length < TOO_SHORT) return '';
  const sample =
    text.length <= SAMPLE
      ? text
      : `${text.slice(0, SAMPLE * 0.75)}\n[...]\n${text.slice(-SAMPLE * 0.25)}`;

  try {
    const raw = await generateJson<{ note: string }>({
      system: [
        'You are cataloguing one document a Discord community gave its assistant, so that a single paragraph pulled out of it later can be read the way the document intends.',
        'Write one or two sentences: what kind of document this is, and what it covers. Name the competition, the season, the team or the period when the document names them.',
        'Say what it is, never what it says: no rules, no dates, no results, no advice. Somebody reading your sentence must not be able to mistake it for the content.',
        'Nothing you cannot see in the text. If it is unclear what the document is, say what it appears to be in the same short form, and nothing more.',
        'Plain sentences. No preamble, no "this document".',
      ].join(' '),
      messages: [
        {
          role: 'user',
          text: [
            `Title: ${input.title ?? '(none)'}`,
            input.sourceType ? `Given as: ${input.sourceType}` : '',
            '',
            sample,
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      schema: {
        type: Type.OBJECT,
        properties: { note: { type: Type.STRING } },
        required: ['note'],
        propertyOrdering: ['note'],
      },
      temperature: 0.2,
      maxOutputTokens: 300,
    });
    const note = tidy((raw.note ?? '').trim());
    return usable(note) ? note : '';
  } catch {
    return '';
  }
}

/**
 * The opening the model cannot help writing, taken off.
 *
 * Asked for what a document is, it answers "This is a schedule..." however
 * plainly it was asked not to. The sentence is right; the first three words
 * are noise beside every chunk, so they go here rather than in another round
 * of asking it more firmly.
 */
function tidy(note: string): string {
  const cut = note
    .replace(/^(?:this|the)\s+(?:document|file|text|page)\s+/i, '')
    .replace(/^(?:this\s+)?(?:is|appears to be)\s+/i, '');
  const line = cut === note ? note : cut.charAt(0).toUpperCase() + cut.slice(1);
  return line.trim();
}

/** The line a chunk carries so the model knows what it was cut out of. */
export function sourceLine(title: string | null, summary: string | null): string {
  const name = (title ?? '').trim();
  const note = (summary ?? '').trim();
  if (!name && !note) return '';
  if (!note) return `from "${name}"`;
  if (!name) return note;
  return `from "${name}": ${note}`;
}
