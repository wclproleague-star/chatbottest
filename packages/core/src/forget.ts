// Forgetting a member, on request.
//
// A member can ask a server to forget them, and the answer cannot be "we would
// rather not". Everything Kalvard holds that is about them goes: the questions
// they asked, the events recording what it did for them, the conversation it
// had open with them, and their name where it appears in the knowledge.
//
// The knowledge is the awkward part. A roster is one document with many names
// in it, so the document is not deleted: the member's own lines are taken out,
// the rest stays, and the document is re-indexed. What Kalvard cannot find, it
// says so, rather than reporting a clean sweep it did not do.

import { serviceClient } from './supabase';

export type ForgetReport = {
  questions: number;
  events: number;
  conversations: number;
  /** Documents whose text was edited and re-indexed. */
  documents: string[];
  /** Documents that mention them and could not be edited automatically. */
  needsAHuman: string[];
};

/**
 * Removes a member from a guild's memory. `names` are what they are called in
 * the knowledge: their Discord name, their nickname, whatever a roster uses.
 */
export async function forgetPerson(
  guildId: string,
  discordUserId: string,
  names: string[] = [],
): Promise<ForgetReport> {
  const db = serviceClient();
  const report: ForgetReport = {
    questions: 0,
    events: 0,
    conversations: 0,
    documents: [],
    needsAHuman: [],
  };

  const { data: questions } = await db
    .from('questions')
    .delete()
    .eq('guild_id', guildId)
    .eq('asker_discord_id', discordUserId)
    .select('id');
  report.questions = questions?.length ?? 0;

  // Events are keyed by what they recorded, so both shapes are swept.
  for (const column of ['userId', 'askerId']) {
    const { data: events } = await db
      .from('bot_events')
      .delete()
      .eq('guild_id', guildId)
      .contains('payload', { [column]: discordUserId })
      .select('id');
    report.events += events?.length ?? 0;
  }

  const { data: open } = await db
    .from('conversations')
    .delete()
    .eq('guild_id', guildId)
    .like('key', `%:${discordUserId}`)
    .select('key');
  report.conversations = open?.length ?? 0;

  const wanted = [discordUserId, ...names.map((n) => n.trim()).filter(Boolean)];
  const { data: documents } = await db
    .from('documents')
    .select('id, title, raw_text')
    .eq('guild_id', guildId);
  const { ingest } = await import('./ingest');
  for (const doc of documents ?? []) {
    const text = doc.raw_text ?? '';
    if (!text || !wanted.some((name) => text.includes(name))) continue;
    const kept = text
      .split(/\r?\n/)
      .filter((line) => !wanted.some((name) => line.includes(name)))
      .join(String.fromCharCode(10))
      .trim();
    if (!kept) {
      // The whole document was about them.
      await db.from('documents').delete().eq('id', doc.id);
      report.documents.push(doc.title ?? doc.id);
      continue;
    }
    if (wanted.some((name) => kept.includes(name))) {
      // Their name survives inside a sentence rather than on its own line.
      report.needsAHuman.push(doc.title ?? doc.id);
      continue;
    }
    await db.from('documents').update({ raw_text: kept, status: 'processing' }).eq('id', doc.id);
    await ingest({ guildId, documentId: doc.id });
    report.documents.push(doc.title ?? doc.id);
  }

  await db.from('bot_events').insert({
    guild_id: guildId,
    type: 'settings_issue',
    payload: {
      forgot: discordUserId,
      questions: report.questions,
      events: report.events,
      documents: report.documents,
      needsAHuman: report.needsAHuman,
      at: new Date().toISOString(),
    },
  });
  return report;
}
