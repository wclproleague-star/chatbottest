import { chunkText } from './chunk';
import { recordConflicts } from './conflicts';
import { parseLimits } from './limits';
import type { Limits } from './limits';
import { findPersonal, personalSummary } from './personal';
import type { Database } from './database.types';
import { extractText } from './extract';
import { prepare } from './outline';
import { describeDocument } from './describe';
import { embed } from './gemini';
import { DOCUMENTS_BUCKET, serviceClient } from './supabase';

type DocumentRow = Database['public']['Tables']['documents']['Row'];

export type IngestInput = { guildId: string; documentId: string };
/** This guild's limits, over the defaults. */
async function guildLimits(guildId: string): Promise<Limits> {
  const { data } = await serviceClient()
    .from('guild_settings')
    .select('limits')
    .eq('guild_id', guildId)
    .maybeSingle();
  return parseLimits(data?.limits);
}

export type IngestResult = {
  documentId: string;
  chunkCount: number;
  /** How many contradictions this document has with what was already known. */
  conflicts?: number;
  /** How many chunks are held back because they carry personal details. */
  blocked?: number;
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
    // A rulebook out of a PDF has sections and no way to say so. They are
    // found and marked before chunking, so every piece of knowledge carries
    // the document and the section it came from. The words are untouched.
    const chunks = chunkText(prepare(doc.title, text).text);
    if (chunks.length === 0) throw new Error('The document has no text to index.');

    // Two caps, both settings with defaults, both stated in what they mean to
    // an owner rather than in bytes: one document, and one guild's total.
    const limits = await guildLimits(guildId);
    if (text.length > limits.maxDocumentChars) {
      throw new Error(
        `This document is ${Math.round(text.length / 1000)}k characters and the limit is ${Math.round(limits.maxDocumentChars / 1000)}k. Split it into a few smaller ones, by topic, and Kalvard will answer better from them anyway.`,
      );
    }
    const { count: held } = await serviceClient()
      .from('chunks')
      .select('id', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .neq('document_id', documentId);
    if ((held ?? 0) + chunks.length > limits.maxGuildChunks) {
      throw new Error(
        `This would take the server past what it can hold (${limits.maxGuildChunks} pieces of knowledge). Remove a document you no longer need, or ask for a higher limit.`,
      );
    }

    const vectors = await embed(
      chunks.map((c) => c.content),
      'RETRIEVAL_DOCUMENT',
    );
    if (vectors.length !== chunks.length) {
      throw new Error(`Embedded ${vectors.length} of ${chunks.length} chunks.`);
    }
    // A chunk carrying somebody's phone number or address is stored but never
    // retrieved: the owner decides in the dashboard whether it may be used.
    const personal = chunks.map((chunk) => findPersonal(chunk.content));
    const rows = chunks.map((chunk, i) => ({
      guild_id: guildId,
      document_id: documentId,
      content: chunk.content,
      token_count: chunk.tokenCount,
      embedding: JSON.stringify(vectors[i]),
      blocked: (personal[i] ?? []).length > 0,
      blocked_reason: personalSummary(personal[i] ?? []) || null,
    }));

    const cleared = await db.from('chunks').delete().eq('document_id', documentId);
    if (cleared.error) throw new Error(`Could not clear old chunks: ${cleared.error.message}`);

    for (let start = 0; start < rows.length; start += INSERT_BATCH) {
      const inserted = await db.from('chunks').insert(rows.slice(start, start + INSERT_BATCH));
      if (inserted.error) throw new Error(`Could not insert chunks: ${inserted.error.message}`);
    }

    // What this document is, so a paragraph out of it is read the way the
    // document intends. The owner's own note wins; otherwise it is worked out
    // here, once, and a document without one is no worse off than before.
    const summary = doc.summary?.trim()
      ? doc.summary
      : await describeDocument({
          title: doc.title,
          text,
          sourceType: doc.source_type,
        }).catch(() => '');

    const done = await db
      .from('documents')
      .update({
        summary: summary || null,
        status: 'ready',
        chunk_count: rows.length,
        error_message: null,
        // Something personal was found, so the owner is asked before any of it
        // is used. A document with nothing in it needs no decision.
        review_status: rows.some((r) => r.blocked) ? 'needs_review' : 'ok',
      })
      .eq('id', documentId);
    if (done.error) throw new Error(`Could not mark the document ready: ${done.error.message}`);

    // Whether this document disagrees with what the guild already knows is
    // worked out here, once, rather than on every question that touches it.
    const conflicts = await recordConflicts(guildId, documentId);
    const blocked = rows.filter((r) => r.blocked).length;
    return { documentId, chunkCount: rows.length, conflicts, blocked };
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
