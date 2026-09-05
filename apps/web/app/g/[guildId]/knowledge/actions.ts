'use server';

import { DOCUMENTS_BUCKET, ingest, serviceClient } from '@sentrybot/core';
import { revalidatePath } from 'next/cache';
import { requireMember } from '@/lib/guild';

// Adding knowledge: paste, upload, or a question with its answer. Each makes
// a document and reads it into chunks before returning, so the list shows
// the result. Writes run as the service role after the membership check;
// the document keeps the member as its author.

export type KnowledgeState = { ok?: string; error?: string; id: number } | null;

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const UPLOAD_TYPES: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  pdf: 'application/pdf',
};

export async function pasteDocument(
  _prev: KnowledgeState,
  form: FormData,
): Promise<KnowledgeState> {
  const guildId = String(form.get('guild_id') ?? '');
  const title = String(form.get('title') ?? '').trim();
  const text = String(form.get('text') ?? '').trim();
  if (text.length < 20) return fail('Paste at least a few sentences.');
  const { user } = await requireMember(guildId);
  return add(guildId, {
    title: title || firstLine(text),
    source_type: 'paste',
    raw_text: text,
    created_by: user.id,
  });
}

export async function uploadDocument(
  _prev: KnowledgeState,
  form: FormData,
): Promise<KnowledgeState> {
  const guildId = String(form.get('guild_id') ?? '');
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return fail('Choose a file first.');
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  const contentType = UPLOAD_TYPES[ext];
  if (!contentType) return fail('Upload a .txt, .md or .pdf file.');
  if (file.size > MAX_UPLOAD_BYTES)
    return fail('That file is over 20 MB. Split it or paste the text.');
  const { user } = await requireMember(guildId);

  const safeName = file.name.replace(/[^\w.-]+/g, '_');
  const path = `${guildId}/${crypto.randomUUID()}/${safeName}`;
  const uploaded = await serviceClient()
    .storage.from(DOCUMENTS_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType });
  if (uploaded.error) return fail('The upload did not finish. Try again.');

  return add(guildId, {
    title: file.name.replace(/\.[^.]+$/, ''),
    source_type: 'upload',
    storage_path: path,
    created_by: user.id,
  });
}

export async function addAnswer(_prev: KnowledgeState, form: FormData): Promise<KnowledgeState> {
  const guildId = String(form.get('guild_id') ?? '');
  const question = String(form.get('question') ?? '').trim();
  const answer = String(form.get('answer') ?? '').trim();
  if (!question) return fail('Write the question a member would ask.');
  if (!answer) return fail('Write the answer Sentry should give.');
  const { user } = await requireMember(guildId);
  return add(guildId, {
    title: question,
    source_type: 'qa',
    raw_text: `Q: ${question}\nA: ${answer}`,
    created_by: user.id,
  });
}

type NewDocument = {
  title: string;
  source_type: 'paste' | 'upload' | 'qa';
  raw_text?: string;
  storage_path?: string;
  created_by: string;
};

async function add(guildId: string, doc: NewDocument): Promise<KnowledgeState> {
  const svc = serviceClient();
  const inserted = await svc
    .from('documents')
    .insert({ guild_id: guildId, status: 'processing', ...doc })
    .select('id')
    .single();
  if (inserted.error || !inserted.data) return fail('Could not save it. Try again in a moment.');

  try {
    const { chunkCount } = await ingest({ guildId, documentId: inserted.data.id });
    revalidatePath(`/g/${guildId}/knowledge`);
    return {
      ok: `Added to what Sentry knows, in ${chunkCount} ${chunkCount === 1 ? 'piece' : 'pieces'}.`,
      id: Date.now(),
    };
  } catch (err) {
    revalidatePath(`/g/${guildId}/knowledge`);
    const message = err instanceof Error ? err.message : 'unknown reason';
    return fail(`Saved, but Sentry could not read it: ${message}`);
  }
}

function fail(error: string): KnowledgeState {
  return { error, id: Date.now() };
}

function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim()) ?? 'Pasted text';
  return line.trim().slice(0, 80);
}
