import { generateJson, Type } from './gemini';
import { serviceClient } from './supabase';

export type SuggestInput = { guildId: string };
export type SuggestResult = {
  /** Five questions a member would likely ask that the knowledge answers. */
  questions: string[];
  /** One plausible question the knowledge cannot answer; empty when there is no knowledge. */
  unanswerable: string;
};

/** How many chunks the model reads. */
const SAMPLE = 20;
/** How many chunks to fetch before sampling; the table cannot order randomly through the client. */
const POOL = 200;

const SYSTEM = `You write test questions for a Discord server's assistant, from excerpts of the knowledge it answers from.
Write 5 short, natural questions a server member would plausibly ask that these excerpts answer.
Then write 1 plausible member question, on the same server's topics, that the excerpts do not answer.
Questions are one sentence each, in the language of the excerpts, no numbering, no quotes.`;

/**
 * Reads a random sample of the guild's chunks and returns 5 likely member
 * questions plus 1 the knowledge cannot answer. With no chunks, both are empty.
 */
export async function suggestQuestions({ guildId }: SuggestInput): Promise<SuggestResult> {
  const { data, error } = await serviceClient()
    .from('chunks')
    .select('content')
    .eq('guild_id', guildId)
    .limit(POOL);
  if (error) throw new Error(`Could not read chunks: ${error.message}`);
  if (!data || data.length === 0) return { questions: [], unanswerable: '' };

  const sample = shuffle(data.map((c) => c.content)).slice(0, SAMPLE);
  const out = await generateJson<{ questions: string[]; unanswerable: string }>({
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        text: sample.map((c, i) => `[${i + 1}]\n${c}`).join('\n\n'),
      },
    ],
    schema: {
      type: Type.OBJECT,
      properties: {
        questions: { type: Type.ARRAY, items: { type: Type.STRING }, minItems: '5', maxItems: '5' },
        unanswerable: { type: Type.STRING },
      },
      required: ['questions', 'unanswerable'],
      propertyOrdering: ['questions', 'unanswerable'],
    },
    temperature: 0.7,
  });
  return {
    questions: out.questions
      .map((q) => q.trim())
      .filter(Boolean)
      .slice(0, 5),
    unanswerable: out.unanswerable.trim(),
  };
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
