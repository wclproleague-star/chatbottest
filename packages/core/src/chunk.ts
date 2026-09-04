// Splits a document into ~400-token chunks with ~60 tokens of overlap, keeping
// each chunk under the heading(s) it belongs to.

export type Chunk = { content: string; tokenCount: number };

export type ChunkOptions = { maxTokens?: number; overlapTokens?: number };

/** One token is taken as four characters. Sizing only; nothing depends on exactness. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

type Paragraph = {
  /** Every open heading, outermost first, joined by newlines. */
  context: string;
  /** The innermost open heading line, or ''. */
  heading: string;
  text: string;
};

const HEADING = /^(#{1,6})\s+(.*\S)\s*$/;

function toParagraphs(text: string): Paragraph[] {
  const open: { level: number; line: string }[] = [];
  const out: Paragraph[] = [];
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/);

  for (const block of blocks) {
    let buffer: string[] = [];
    const flush = () => {
      if (buffer.length === 0) return;
      out.push({
        context: open.map((h) => h.line).join('\n'),
        heading: open.at(-1)?.line ?? '',
        text: buffer.join('\n'),
      });
      buffer = [];
    };
    for (const raw of block.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const match = HEADING.exec(line);
      if (match) {
        flush();
        const level = (match[1] ?? '').length;
        while (open.length > 0 && (open.at(-1)?.level ?? 0) >= level) open.pop();
        open.push({ level, line });
      } else {
        buffer.push(line);
      }
    }
    flush();
  }
  return out;
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter(Boolean);
}

function splitOversized(paragraph: Paragraph, maxTokens: number): Paragraph[] {
  if (estimateTokens(paragraph.text) <= maxTokens) return [paragraph];
  const out: Paragraph[] = [];
  let buffer = '';
  for (const sentence of sentences(paragraph.text)) {
    if (buffer && estimateTokens(`${buffer} ${sentence}`) > maxTokens) {
      out.push({ ...paragraph, text: buffer });
      buffer = sentence;
    } else {
      buffer = buffer ? `${buffer} ${sentence}` : sentence;
    }
  }
  if (buffer) out.push({ ...paragraph, text: buffer });
  return out;
}

/** The last sentences of a paragraph, up to about `budget` tokens. */
function tail(text: string, budget: number): string {
  const out: string[] = [];
  let used = 0;
  for (const sentence of sentences(text).reverse()) {
    const cost = estimateTokens(sentence);
    if (out.length > 0 && used + cost > budget) break;
    out.unshift(sentence);
    used += cost;
    if (used >= budget) break;
  }
  return out.join(' ');
}

export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const maxTokens = options.maxTokens ?? 400;
  const overlapTokens = options.overlapTokens ?? 60;
  const paragraphs = toParagraphs(text).flatMap((p) => splitOversized(p, maxTokens));

  const chunks: Chunk[] = [];
  const state: { parts: string[]; lastContext: string | null; previous: Paragraph | null } = {
    parts: [],
    lastContext: null,
    previous: null,
  };

  const render = () => state.parts.join('\n\n');
  const emit = () => {
    const content = render().trim();
    if (content) chunks.push({ content, tokenCount: estimateTokens(content) });
    state.parts = [];
    state.lastContext = null;
  };
  // A chunk opens with the full heading trail; a section change inside a chunk
  // shows only the new innermost heading.
  const add = (paragraph: Paragraph) => {
    if (state.parts.length === 0) {
      if (paragraph.context) state.parts.push(paragraph.context);
    } else if (paragraph.context !== state.lastContext && paragraph.heading) {
      state.parts.push(paragraph.heading);
    }
    state.parts.push(paragraph.text);
    state.lastContext = paragraph.context;
    state.previous = paragraph;
  };

  for (const paragraph of paragraphs) {
    const wouldBe = state.parts.length > 0 ? `${render()}\n\n${paragraph.text}` : paragraph.text;
    if (state.parts.length > 0 && estimateTokens(wouldBe) > maxTokens) {
      emit();
      const previous = state.previous;
      if (previous) {
        const overlap = tail(previous.text, overlapTokens);
        if (overlap) add({ ...previous, text: overlap });
      }
    }
    add(paragraph);
  }
  emit();
  return chunks;
}
