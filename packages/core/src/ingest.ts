import { chunkText } from './chunk';
import { recordConflicts } from './conflicts';
import type { Database } from './database.types';
import { extractText } from './extract';
import { embed } from './gemini';
import { DOCUMENTS_BUCKET, serviceClient } from './supabase';

type DocumentRow = Database['public']['Tables']['documents']['Row'];

export type IngestInput = { guildId: string; documentId: string };
export type IngestResult = {
  documentId: string;
  chunkCount: number;
  /** How many contradictions this document has with what was already known. */
  conflicts?: number;
};

const INSERT_BATCH = 100;

/**
 * Turns one document into embedded chunks and marks it ready, or marks it
 * error with the reason. Re-running replaces the document's previous chunks.
 */
export async function ingest({ guildId, documentId }: IngestInput): Promise<IngestResult> {
  const db = serviceClient();

  const loaded = await db
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .eq('guild_id', guildId)
    .maybeSingle();
  if (loaded.error)
    throw new Error(`Could not load document ${documentId}: ${loaded.error.message}`);
  if (!loaded.data) throw new Error(`Document ${documentId} does not exist in guild ${guildId}.`);
  const doc = loaded.data;

  await db
    .from('documents')
    .update({ status: 'processing', error_message: null })
    .eq('id', documentId);

  try {
    const text = await loadText(doc);
    const chunks = chunkText(text);
    if (chunks.length === 0) throw new Error('The document has no text to index.');

    const vectors = await embed(
      chunks.map((c) => c.content),
      'RETRIEVAL_DOCUMENT',
    );
    if (vectors.length !== chunks.length) {
      throw new Error(`Embedded ${vectors.length} of ${chunks.length} chunks.`);
    }
    const rows = chunks.map((chunk, i) => ({
      guild_id: guildId,
      document_id: documentId,
      content: chunk.content,
      token_count: chunk.tokenCount,
      embedding: JSON.stringify(vectors[i]),
    }));

    const cleared = await db.from('chunks').delete().eq('document_id', documentId);
    if (cleared.error) throw new Error(`Could not clear old chunks: ${cleared.error.message}`);

    for (let start = 0; start < rows.length; start += INSERT_BATCH) {
      const inserted = await db.from('chunks').insert(rows.slice(start, start + INSERT_BATCH));
      if (inserted.error) throw new Error(`Could not insert chunks: ${inserted.error.message}`);
    }

    const done = await db
      .from('documents')
      .update({ status: 'ready', chunk_count: rows.length, error_message: null })
      .eq('id', documentId);
    if (done.error) throw new Error(`Could not mark the document ready: ${done.error.message}`);

    // Whether this document disagrees with what the guild already knows is
    // worked out here, once, rather than on every question that touches it.
    const conflicts = await recordConflicts(guildId, documentId);
    return { documentId, chunkCount: rows.length, conflicts };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .from('documents')
      .update({ status: 'error', error_message: message })
      .eq('id', documentId);
    throw err;
  }
}

async function loadText(doc: DocumentRow): Promise<string> {
  if (doc.raw_text?.trim()) return doc.raw_text;
  if (!doc.storage_path) {
    throw new Error('The document has neither pasted text nor an uploaded file.');
  }
  const { data, error } = await serviceClient()
    .storage.from(DOCUMENTS_BUCKET)
    .download(doc.storage_path);
  if (error || !data) {
    throw new Error(`Could not download ${doc.storage_path}: ${error?.message ?? 'no data'}`);
  }
  return extractText(new Uint8Array(await data.arrayBuffer()), doc.storage_path);
}
