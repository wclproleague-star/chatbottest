// Turning a moderator's answer into knowledge, and finding the question that
// was already asked.

import { embed, ingest } from '@kalvard/core';
import { serviceClient } from '@kalvard/core/supabase';

/** Two questions this close in meaning are the same question. */
const SAME_QUESTION = 0.92;

/**
 * Stores a moderator's answer on the pending question, files it as a
 * `mod_answer` document and reads it into chunks, so the next member who asks
 * gets it from Kalvard. Returns the answer that was stored.
 */
export async function recordAnswer(input: {
  guildId: string;
  questionId: string;
  question: string;
  answer: string;
  answeredBy: string;
}): Promise<void> {
  const db = serviceClient();
  const now = new Date().toISOString();

  const updated = await db
    .from('questions')
    .update({
      status: 'answered',
      answer: input.answer,
      answered_by: input.answeredBy,
      answered_via: 'discord',
      answered_at: now,
    })
    .eq('id', input.questionId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  // Another moderator got there first; their answer stands.
  if (!updated.data) return;

  const doc = await db
    .from('documents')
    .insert({
      guild_id: input.guildId,
      title: input.question.slice(0, 120),
      source_type: 'mod_answer',
      raw_text: `Q: ${input.question}\nA: ${input.answer}`,
      status: 'processing',
      created_by: null,
    })
    .select('id')
    .single();
  if (doc.error || !doc.data) {
    console.error(`kalvard: could not file the mod answer: ${doc.error?.message}`);
    return;
  }
  try {
    await ingest({ guildId: input.guildId, documentId: doc.data.id });
  } catch (err) {
    console.error(`kalvard: could not read the mod answer: ${String(err)}`);
  }
}

/**
 * Closes a pending question with what was done about it, filing nothing: the
 * moderator's reply was an instruction, and the thing it caused (a role, a
 * vouch on a roster) is already on record.
 */
export async function settleQuestion(input: {
  questionId: string;
  answer: string;
  answeredBy: string;
}): Promise<boolean> {
  const { data } = await serviceClient()
    .from('questions')
    .update({
      status: 'answered',
      answer: input.answer,
      answered_by: input.answeredBy,
      answered_via: 'discord',
      answered_at: new Date().toISOString(),
    })
    .eq('id', input.questionId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  return Boolean(data);
}

export type PendingMatch = { id: string; link: string | null; question: string };

/**
 * A pending question in this guild that means the same thing, if there is one.
 * The pending questions are embedded on demand; there are rarely many.
 */
export async function findPending(guildId: string, question: string): Promise<PendingMatch | null> {
  const { data } = await serviceClient()
    .from('questions')
    .select('id, channel_id, bot_message_id, question')
    .eq('guild_id', guildId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(20);
  const pending = (data ?? []).filter((q) => q.channel_id && q.bot_message_id);
  if (pending.length === 0) return null;

  const vectors = await embed([question, ...pending.map((p) => p.question)], 'RETRIEVAL_QUERY');
  const [asked, ...others] = vectors;
  if (!asked) return null;
  let bestRow: (typeof pending)[number] | null = null;
  let bestScore = 0;
  for (let i = 0; i < others.length; i++) {
    const row = pending[i];
    const vector = others[i];
    if (!row || !vector) continue;
    const score = dot(asked, vector);
    if (score > bestScore) {
      bestScore = score;
      bestRow = row;
    }
  }
  if (!bestRow || bestScore < SAME_QUESTION) return null;
  const link = `https://discord.com/channels/${guildId}/${bestRow.channel_id}/${bestRow.bot_message_id}`;
  return { id: bestRow.id, link, question: bestRow.question };
}

/** The vectors are unit length, so the dot product is the cosine. */
function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}
