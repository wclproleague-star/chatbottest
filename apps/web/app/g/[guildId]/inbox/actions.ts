'use server';

// The inbox: what Kalvard could not answer, and what a moderator does about it.
//
// Answering here does three things at once, and all three matter: the member
// gets their answer in the channel they asked in, the question stops waiting,
// and the answer becomes knowledge so nobody has to type it again. Dismissing
// does the first two and none of the third.

import { ingest, serviceClient } from '@kalvard/core';
import { revalidatePath } from 'next/cache';
import { displayName, requireMember } from '@/lib/guild';

export type InboxState = { ok?: string; error?: string; id: number } | null;

const MAX_ANSWER = 900;

export async function answerQuestion(_prev: InboxState, form: FormData): Promise<InboxState> {
  const guildId = String(form.get('guild_id') ?? '');
  const questionId = String(form.get('question_id') ?? '');
  const answer = String(form.get('answer') ?? '')
    .trim()
    .slice(0, MAX_ANSWER);
  if (answer.length < 2) return fail('Write an answer first.');

  const { user } = await requireMember(guildId);
  const db = serviceClient();

  // Only a question that is still waiting: two moderators answering at once
  // must not both post, and the first one wins.
  const { data: claimed } = await db
    .from('questions')
    .update({
      status: 'answered',
      answer,
      answered_by: displayName(user),
      answered_via: 'dashboard',
      answered_at: new Date().toISOString(),
    })
    .eq('id', questionId)
    .eq('guild_id', guildId)
    .eq('status', 'pending')
    .select('id, question')
    .maybeSingle();
  if (!claimed) return fail('Somebody answered that one already.');

  // Knowledge, so the next member who asks gets it from Kalvard.
  const { data: doc } = await db
    .from('documents')
    .insert({
      guild_id: guildId,
      title: claimed.question.slice(0, 120),
      source_type: 'mod_answer',
      raw_text: `Q: ${claimed.question}\nA: ${answer}`,
      status: 'processing',
      created_by: user.id,
    })
    .select('id')
    .single();
  if (doc) {
    try {
      await ingest({ guildId, documentId: doc.id });
    } catch {
      // The answer still stands and still reaches the member; the knowledge
      // can be rebuilt from the document, which is already saved.
    }
  }

  // The bot watches for this and posts the answer in the original channel.
  await db.from('bot_events').insert({
    guild_id: guildId,
    type: 'approved',
    payload: { questionId, answered_via: 'dashboard', answeredBy: displayName(user) },
  });

  revalidatePath(`/g/${guildId}/inbox`);
  return {
    ok: 'Answered. Kalvard is posting it in the channel, and it knows it now.',
    id: Date.now(),
  };
}

export async function dismissQuestion(_prev: InboxState, form: FormData): Promise<InboxState> {
  const guildId = String(form.get('guild_id') ?? '');
  const questionId = String(form.get('question_id') ?? '');
  await requireMember(guildId);
  const { error } = await serviceClient()
    .from('questions')
    .update({ status: 'dismissed' })
    .eq('id', questionId)
    .eq('guild_id', guildId)
    .eq('status', 'pending');
  if (error) return fail('Could not dismiss that one. Try again.');
  revalidatePath(`/g/${guildId}/inbox`);
  return { ok: 'Dismissed. Nothing was posted and nothing was learned.', id: Date.now() };
}

function fail(error: string): InboxState {
  return { error, id: Date.now() };
}
