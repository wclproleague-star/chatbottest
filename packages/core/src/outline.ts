// A rulebook has sections. A PDF does not.
//
// The chunker already keeps a paragraph under the headings it belongs to, so
// a piece of knowledge arrives at the model saying what it is about. That only
// works when the headings are marked, which they are in what somebody types
// into the dashboard and never are in what comes out of a PDF or a Word file:
// there, "4.2 Substitutes" is just another line, and the paragraph beneath it
// is stored as "A substitute must be declared before check-in closes" with
// nothing saying which competition, which stage, or which rule it qualifies.
// Retrieved on its own six months later, that is a sentence nobody can act on.
//
// So the structure the document already has is found before it is chunked, and
// marked. Nothing is rewritten and nothing is summarised: a heading is a line
// that was already there, and the only change is the hashes in front of it.
// That matters for a rulebook — an organisation's rules are theirs, word for
// word, and a paraphrase of a rule is not the rule.
//
// It is deliberately conservative. A document whose headings cannot be told
// apart from its sentences is left exactly as it came, because a wrong outline
// is worse than none: it would file paragraphs under a section they are not in.

const NL = String.fromCharCode(10);
const CRLF = new RegExp(String.fromCharCode(13) + String.fromCharCode(10) + '?', 'g');

/** A line longer than this is prose, whatever it looks like. */
const HEADING_MAX = 80;
/**
 * Past this share of lines, the guesses are wrong and none of them are kept.
 * It applies only to the unnumbered ones: "4.2 Substitutes" says what it is,
 * and a roster of one name per line does not.
 */
const TOO_MANY = 0.3;

/** "4.2", "4.2.1", "Article 7", "Section 3" and the like, at the start. */
const NUMBERED =
  /^(?:(?:article|section|chapter|annexe|annex|partie|part)\s+)?(\d+(?:\.\d+)*)[.)]?\s+(\S.*)$/i;
/** A line already marked as a heading. */
const MARKED = /^#{1,6}\s+\S/;
/** Sentences end; headings do not. */
const ENDS_A_SENTENCE = /[.!?,;:]$/;

/** Whether a line is written in capitals, ignoring digits and punctuation. */
function shouts(line: string): boolean {
  const letters = line.replace(/[^\p{L}]/gu, '');
  if (letters.length < 3) return false;
  return letters === letters.toUpperCase();
}

/** How deep a numbered heading sits: "4" is a section, "4.2.1" a clause. */
function depthOf(number: string): number {
  return Math.min(6, 1 + number.split('.').length);
}

/**
 * The heading level of a line, or 0 when it is not one.
 *
 * `before` is the line above and `after` the next line with anything on it,
 * since a heading is usually followed by a blank line and then its paragraph.
 * A line in the middle of a paragraph is not a heading however short it is.
 */
export function headingLevel(line: string, before: string, after: string): number {
  return numberedLevel(line) || guessedLevel(line, before, after);
}

/** A heading that names its own number, which is not a guess. */
function numberedLevel(line: string): number {
  const text = line.trim();
  if (!text || text.length > HEADING_MAX || MARKED.test(text)) return 0;
  const numbered = NUMBERED.exec(text);
  if (numbered?.[1] && numbered[2] && !ENDS_A_SENTENCE.test(text)) return depthOf(numbered[1]);
  return 0;
}

/** A heading read from how the line sits on the page, which is. */
function guessedLevel(line: string, before: string, after: string): number {
  const text = line.trim();
  if (!text || text.length > HEADING_MAX) return 0;
  if (MARKED.test(text)) return 0;

  // Unnumbered: it has to stand alone to be believed. Nothing on the line
  // above, something below it, no closing punctuation, and either capitals or
  // a line short enough to be a title.
  if (before.trim()) return 0;
  if (!after.trim()) return 0;
  if (ENDS_A_SENTENCE.test(text)) return 0;
  if (shouts(text)) return 2;
  const words = text.split(/\s+/).length;
  if (words <= 8 && /^[\p{Lu}\p{N}]/u.test(text)) return 3;
  return 0;
}

/** The next line below `i` with anything on it. */
function nextWritten(lines: string[], i: number): string {
  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j] ?? '';
    if (line.trim()) return line;
  }
  return '';
}

/** What was found, for the one line an owner is shown about their upload. */
export type Outline = { text: string; headings: string[] };

/**
 * The same text with the headings it already had marked as headings.
 *
 * Every line comes back exactly as it went in, apart from the hashes; nothing
 * is dropped, reordered or reworded.
 */
export function markHeadings(text: string): Outline {
  const lines = text.replace(CRLF, NL).split(NL);
  const levels = new Map<number, number>();
  const sure: number[] = [];
  const guessed: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const numbered = numberedLevel(line);
    const level = numbered || guessedLevel(line, lines[i - 1] ?? '', nextWritten(lines, i));
    if (level > 0) {
      levels.set(i, level);
      (numbered ? sure : guessed).push(i);
    }
  }

  const written = lines.filter((line) => line.trim()).length;
  // The guesses stand together or not at all: a document where every other
  // line looks like a heading is a list, and filing a paragraph under the
  // wrong section is worse than filing it under none.
  const keepGuesses = written > 0 && guessed.length / written <= TOO_MANY;
  const found = [...sure, ...(keepGuesses ? guessed : [])].sort((a, b) => a - b);
  if (found.length === 0) return { text, headings: [] };

  const out = [...lines];
  const headings: string[] = [];
  for (const i of found) {
    const level = levels.get(i) ?? 2;
    const line = (lines[i] ?? '').trim();
    out[i] = `${'#'.repeat(level)} ${line}`;
    headings.push(line);
  }
  // A heading needs a blank line before it, or the chunker reads it as part of
  // the paragraph above.
  return { text: out.join(NL), headings };
}

/**
 * A document ready to be chunked: its own title at the top, its own headings
 * marked. The title is the one thing added, and it is the document's own.
 */
export function prepare(title: string | null, text: string): Outline {
  const marked = markHeadings(text);
  const name = (title ?? '').trim();
  if (!name || marked.text.trimStart().startsWith(`# ${name}`)) return marked;
  return { text: `# ${name}${NL}${NL}${marked.text}`, headings: marked.headings };
}
