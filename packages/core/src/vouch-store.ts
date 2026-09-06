// Writing a vouch down, and reading it back.
//
// One roster document per role, created the first time somebody is vouched for
// and grown after that. It goes through ingest like every other document, so
// it is searchable, it shows up in Knowledge with its own status, and an owner
// can correct or delete it exactly as they would anything else Kalvard knows.

import { ingest } from './ingest';
import { serviceClient } from './supabase';
import { appendVouch, onRoster, rosterTitle, vouchDocument } from './vouch';
import type { Vouch } from './vouch';

/**
 * Records that a moderator vouched for somebody, and returns whether anything
 * was written: vouching for a member already on the roster changes nothing.
 */
export async function recordVouch(guildId: string, vouch: Vouch): Promise<boolean> {
  const db = serviceClient();
  const title = rosterTitle(vouch.roleName);
  const { data: existing } = await db
    .from('documents')
    .select('id, raw_text')
    .eq('guild_id', guildId)
    .eq('title', title)
    .eq('source_type', 'mod_answer')
    .maybeSingle();

  if (existing) {
    const next = appendVouch(existing.raw_text ?? '', vouch);
    if (next === (existing.raw_text ?? '')) return false;
    await db
      .from('documents')
      .update({ raw_text: next, status: 'processing' })
      .eq('id', existing.id);
    await reindex(guildId, existing.id);
    return true;
  }

  const fresh = vouchDocument(vouch);
  const { data: created } = await db
    .from('documents')
    .insert({
      guild_id: guildId,
      title: fresh.title,
      source_type: 'mod_answer',
      raw_text: fresh.text,
      status: 'processing',
    })
    .select('id')
    .single();
  if (created) await reindex(guildId, created.id);
  return true;
}

/** Whether a moderator has already vouched for this member for this role. */
export async function isVouched(
  guildId: string,
  memberName: string,
  roleName: string,
): Promise<boolean> {
  if (!memberName.trim() || !roleName.trim()) return false;
  const { data } = await serviceClient()
    .from('documents')
    .select('raw_text')
    .eq('guild_id', guildId)
    .eq('title', rosterTitle(roleName))
    .eq('source_type', 'mod_answer')
    .maybeSingle();
  return onRoster(memberName, data?.raw_text ?? '');
}

/** The roster is knowledge, so it is chunked and embedded like the rest. */
async function reindex(guildId: string, documentId: string): Promise<void> {
  try {
    await ingest({ guildId, documentId });
  } catch (err) {
    // The vouch is saved either way; the search index can be rebuilt.
    console.error(`kalvard: could not index the roster: ${String(err)}`);
  }
}
