// Turning a moderator's answer into knowledge, and finding the question that
// was already asked.

import { alreadyWaiting, embed, ingest, learnFrom } from '@kalvard/core';
import type { Learned } from '@kalvard/core';
import { serviceClient } from '@kalvard/core/supabase';

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
  /** The space, so a statement can name it rather than say "here". */
  spaceName?: string;
}): Promise<Learned | null> {
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
  if (!updated.data) return null;

  // What the moderator meant, not the sentence they typed.
  const learned = await learnFrom({
    question: input.question,
    answer: input.answer,
    spaceName: input.spaceName,
  });
  const doc = await db
    .from('documents')
    .insert({
      guild_id: input.guildId,
      title: learned.title,
      source_type: 'mod_answer',
      raw_text: learned.text,
      status: 'processing',
      created_by: null,
    })
    .select('id')
    .single();
  if (doc.error || !doc.data) {
    console.error(`kalvard: could not file the mod answer: ${doc.error?.message}`);
    return learned;
  }
  try {
    await ingest({ guildId: input.guildId, documentId: doc.data.id });
  } catch (err) {
    console.error(`kalvard: could not read the mod answer: ${String(err)}`);
  }
  return learned;
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

export type PendingMatch = {
  id: string;
  link: string | null;
  question: string;
  /** Whether it is waiting in the channel this message arrived in. */
  sameChannel: boolean;
};

/**
 * The pending question this message is another go at, if there is one.
 *
 * Similarity alone decided this, at one strict bar, and it let a member wake
 * the moderators three times in a minute by rewording the same claim. The bar
 * still stands for a question asked cold; inside one live exchange — the same
 * person, the same channel, the last half hour — a looser match or a plain
 * "yes, but" is the same person pushing, and the rule for that lives in core
 * where the checks can reach it.
 */
export async function findPending(
  guildId: string,
  question: string,
  asked: { channelId: string; askerId: string },
): Promise<PendingMatch | null> {
  const { data } = await serviceClient()
    .from('questions')
    .select('id, channel_id, bot_message_id, question, asker_discord_id, created_at')
    .eq('guild_id', guildId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(20);
  const pending = (data ?? []).filter((q) => q.channel_id && q.bot_message_id);
  if (pending.length === 0) return null;

  const vectors = await embed([question, ...pending.map((p) => p.question)], 'RETRIEVAL_QUERY');
  const [asking, ...others] = vectors;
  if (!asking) return null;

  const now = Date.now();
  let best: (typeof pending)[number] | null = null;
  let bestScore = 0;
  for (let i = 0; i < others.length; i++) {
    const row = pending[i];
    const vector = others[i];
    if (!row || !vector) continue;
    const similarity = dot(asking, vector);
    const same = alreadyWaiting(
      {
        similarity,
        sameChannel: row.channel_id === asked.channelId,
        sameAsker: row.asker_discord_id === asked.askerId,
        minutesAgo: (now - new Date(row.created_at).getTime()) / 60_000,
      },
      question,
    );
    if (same && similarity > bestScore) {
      bestScore = similarity;
      best = row;
    }
  }
  if (!best) return null;
  return {
    id: best.id,
    link: `https://discord.com/channels/${guildId}/${best.channel_id}/${best.bot_message_id}`,
    question: best.question,
    sameChannel: best.channel_id === asked.channelId,
  };
}

/** The vectors are unit length, so the dot product is the cosine. */
function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}
