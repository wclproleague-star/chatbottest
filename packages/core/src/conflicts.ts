// Where the knowledge disagrees with itself.
//
// Two documents can give different times for the same deadline. A model asked
// to spot that while it is also writing a reply will quietly pick one, and asked
// to spot it on every message it says yes some of the time and no the rest. So
// it is looked for once, when a document is ingested, and written down. At
// answer time the lookup is a query, and the tier that follows from it is not a
// judgement at all.

import { embed, generateJson, Type } from './gemini';
import { serviceClient } from './supabase';

/** Two statements in the knowledge that cannot both be true. */
export type Conflict = {
  first: string;
  second: string;
  /** The two chunks that disagree, so a reply can be told to rest on them. */
  chunkA: string;
  chunkB: string;
};

/** How close two chunks must be before it is worth asking whether they clash. */
const NEIGHBOUR_SIMILARITY = 0.6;
const NEIGHBOURS = 4;

/**
 * Looks for contradictions between a freshly ingested document and everything
 * the guild already knows, and records them. Never throws: a conflict that
 * goes unrecorded costs a hedge, and failing an ingest over it would cost the
 * document.
 */
export async function recordConflicts(guildId: string, documentId: string): Promise<number> {
  const db = serviceClient();
  try {
    const { data: mine } = await db
      .from('chunks')
      .select('id, content')
      .eq('document_id', documentId);
    if (!mine || mine.length === 0) return 0;

    let found = 0;
    for (const chunk of mine) {
      const [vector] = await embed([chunk.content], 'RETRIEVAL_QUERY');
      if (!vector) continue;
      const { data: near } = await db.rpc('match_chunks', {
        guild_id: guildId,
        query_embedding: JSON.stringify(vector),
        match_count: NEIGHBOURS,
        min_similarity: NEIGHBOUR_SIMILARITY,
      });
      for (const other of near ?? []) {
        // Itself, and anything in the same document: a document is allowed to
        // qualify itself, and re-ingesting it must not fight its own past.
        if (other.id === chunk.id || other.document_id === documentId) continue;
        const clash = await judge(chunk.content, other.content);
        if (!clash) continue;
        // One row per pair, whichever side was ingested first.
        const [a, b] = [chunk.id, other.id].sort();
        const { error } = await db.from('knowledge_conflicts').upsert(
          {
            guild_id: guildId,
            chunk_a: a!,
            chunk_b: b!,
            first: clash.first,
            second: clash.second,
          },
          { onConflict: 'chunk_a,chunk_b' },
        );
        if (!error) found++;
      }
    }
    return found;
  } catch (err) {
    console.error(`sentry: could not check for conflicts: ${String(err)}`);
    return 0;
  }
}

/** The recorded conflicts touching any of these chunks, still unresolved. */
export async function conflictsFor(guildId: string, chunkIds: string[]): Promise<Conflict[]> {
  if (chunkIds.length === 0) return [];
  const db = serviceClient();
  const { data } = await db
    .from('knowledge_conflicts')
    .select('first, second, chunk_a, chunk_b')
    .eq('guild_id', guildId)
    .eq('resolved', false);
  // Both sides have to be in front of the member for the disagreement to be
  // about what they asked. Whether it bears on the answer is decided later, by
  // whether the reply actually rests on one of them: in a small server every
  // question retrieves everything, so being retrieved proves nothing.
  return (data ?? [])
    .filter((row) => chunkIds.includes(row.chunk_a) && chunkIds.includes(row.chunk_b))
    .map((row) => ({
      first: row.first,
      second: row.second,
      chunkA: row.chunk_a,
      chunkB: row.chunk_b,
    }));
}

/** Whether these two pieces of knowledge state different values for one fact. */
async function judge(a: string, b: string): Promise<Conflict | null> {
  try {
    const out = await generateJson<{ conflict: boolean; first: string; second: string }>({
      system: [
        'You are given two pieces of a knowledge base.',
        'Say whether they state different values for the same fact: two different times, two different deadlines, two different rules for the same case.',
        'Adding detail is not a conflict. Covering different things is not a conflict. Only a direct contradiction counts.',
        'When there is one, first and second are the two statements, quoted short and plainly.',
      ].join(' '),
      messages: [{ role: 'user', text: [a, '---', b].join(String.fromCharCode(10)) }],
      schema: {
        type: Type.OBJECT,
        properties: {
          conflict: { type: Type.BOOLEAN },
          first: { type: Type.STRING },
          second: { type: Type.STRING },
        },
        required: ['conflict', 'first', 'second'],
        propertyOrdering: ['conflict', 'first', 'second'],
      },
      temperature: 0,
    });
    if (!out.conflict || !out.first.trim() || !out.second.trim()) return null;
    // The judge only says whether and what; the caller knows which chunks.
    return { first: out.first.trim(), second: out.second.trim(), chunkA: '', chunkB: '' };
  } catch {
    return null;
  }
}
