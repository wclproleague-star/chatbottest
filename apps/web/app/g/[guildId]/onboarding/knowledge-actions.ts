'use server';

// Giving the bot something to know, during setup.
//
// The knowledge step asks for it, and there are three ways in: a file, a
// paste, or a file dropped on the panel at any step. All three end here, and
// all three do the same thing: make a document, read it into chunks, and come
// back with how many pieces it read and the biggest hole in what it says.
//
// The reading happens now rather than at the end of setup, so the owner is
// told "read your rules, 18 pieces" while they are still looking at the
// panel, and so a file that cannot be read is said so at once, with the
// chance to try again.

import { DOCUMENTS_BUCKET, gapIn, ingest, serviceClient } from '@kalvard/core';
import { requireMember } from '@/lib/guild';

export type Added =
  | { ok: true; documentId: string; title: string; pieces: number; gap: string }
  | { ok: false; error: string };

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const UPLOAD_TYPES: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  pdf: 'application/pdf',
};

/** A file: stored, read, chunked, and reported on. */
export async function addKnowledgeFile(form: FormData): Promise<Added> {
  const guildId = String(form.get('guild_id') ?? '');
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'That file was empty.' };
  }
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  const contentType = UPLOAD_TYPES[ext];
  if (!contentType) return { ok: false, error: 'Only .txt, .md and .pdf files can be read.' };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: 'That file is over 20 MB. Split it, or paste the text.' };
  }
  const { user, guild } = await requireMember(guildId);

  const safeName = file.name.replace(/[^\w.-]+/g, '_');
  const path = `${guildId}/${crypto.randomUUID()}/${safeName}`;
  const uploaded = await serviceClient()
    .storage.from(DOCUMENTS_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType });
  if (uploaded.error) return { ok: false, error: 'The upload did not finish.' };

  return read(guildId, guild.name ?? guildId, {
    title: file.name.replace(/\.[^.]+$/, ''),
    source_type: 'upload',
    storage_path: path,
    created_by: user.id,
  });
}

/** A long paste: the same, without the storage. */
export async function addKnowledgePaste(form: FormData): Promise<Added> {
  const guildId = String(form.get('guild_id') ?? '');
  const text = String(form.get('text') ?? '').trim();
  if (text.length < 20) return { ok: false, error: 'Paste at least a few sentences.' };
  const { user, guild } = await requireMember(guildId);
  return read(guildId, guild.name ?? guildId, {
    title: firstLine(text),
    source_type: 'paste',
    raw_text: text,
    created_by: user.id,
  });
}

/** Writes the document, reads it, and says what it found. */
async function read(
  guildId: string,
  guildName: string,
  row: {
    title: string;
    source_type: 'upload' | 'paste';
    raw_text?: string;
    storage_path?: string;
    created_by: string;
  },
): Promise<Added> {
  const db = serviceClient();
  const { data: created, error } = await db
    .from('documents')
    .insert({ guild_id: guildId, status: 'processing', ...row })
    .select('id')
    .single();
  if (error || !created) return { ok: false, error: 'Could not keep that. Try again.' };

  try {
    await ingest({ guildId, documentId: created.id });
  } catch {
    return { ok: false, error: 'That file could not be read. Try another, or paste the text.' };
  }

  const { data: done } = await db
    .from('documents')
    .select('chunk_count, status, error_message, raw_text')
    .eq('id', created.id)
    .maybeSingle();
  if (done?.status === 'error') {
    return { ok: false, error: done.error_message ?? 'That file could not be read.' };
  }
  const pieces = done?.chunk_count ?? 0;
  if (pieces === 0) {
    return { ok: false, error: 'There was no readable text in that. Try another, or paste it.' };
  }

  // The gap is about what was just added, and is asked once, here.
  const gap = await gapIn(row.raw_text ?? done?.raw_text ?? '', guildName);
  return { ok: true, documentId: created.id, title: row.title, pieces, gap };
}

function firstLine(text: string): string {
  return (text.split('\n')[0] ?? '').trim().slice(0, 80) || 'What the server knows';
}
