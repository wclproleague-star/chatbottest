// The checks that need the database but not the model.
//
// Two people saving settings at once, and a document that arrives carrying
// somebody's phone number. Both are things you cannot test with a pure
// function and should not have to test by hand.
//
//   pnpm --filter @kalvard/core eval:db

import process from 'node:process';
import { fileURLToPath } from 'node:url';

for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(fileURLToPath(new URL(`../../../${file}`, import.meta.url)));
  } catch {
    // Not present.
  }
}

const { ingest } = await import('./ingest');
const { approveDocument, saveSettings } = await import('./settings');
const { forgetPerson } = await import('./forget');
const { serviceClient } = await import('./supabase');
const { embed } = await import('./gemini');

const GUILD = '900000000000000002';
const DOCUMENT = '00000000-0000-4000-8000-00000000c009';
const db = serviceClient();
let failed = 0;

function check(what: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${what}${ok || !detail ? '' : `: ${detail}`}`);
  if (!ok) failed++;
}

console.log(['', 'two people editing the settings'].join(String.fromCharCode(10)));
{
  const { data: before } = await db
    .from('guild_settings')
    .select('updated_at, max_reply_chars')
    .eq('guild_id', GUILD)
    .maybeSingle();
  const basedOn = before?.updated_at ?? null;
  const original = before?.max_reply_chars ?? 900;

  const mine = await saveSettings(GUILD, { max_reply_chars: 850 }, basedOn);
  check('the first save goes through', mine.ok);

  // The second person still holds the version they opened the page with.
  const theirs = await saveSettings(GUILD, { max_reply_chars: 700 }, basedOn);
  check('the second is refused', !theirs.ok && theirs.reason === 'conflict');
  check(
    'they are told what to do',
    !theirs.ok && theirs.reason === 'conflict' && theirs.message.includes('Reload'),
  );

  const { data: after } = await db
    .from('guild_settings')
    .select('max_reply_chars')
    .eq('guild_id', GUILD)
    .maybeSingle();
  check('nothing was overwritten', after?.max_reply_chars === 850);

  const fresh = mine.ok ? mine.updatedAt : null;
  const retry = await saveSettings(GUILD, { max_reply_chars: original }, fresh);
  check('reloading and saving again works', retry.ok);
}

console.log(['', 'a document carrying personal details'].join(String.fromCharCode(10)));
{
  await db.from('documents').upsert({
    id: DOCUMENT,
    guild_id: GUILD,
    title: 'Captains list',
    source_type: 'paste',
    raw_text:
      'Team Baguette captain: kestrel, kestrel@example.com, +33 6 12 34 56 78. Call him about scheduling.',
    status: 'processing',
  });
  const result = await ingest({ guildId: GUILD, documentId: DOCUMENT });
  check('the personal part is held back', (result.blocked ?? 0) > 0, `blocked ${result.blocked}`);

  const { data: doc } = await db
    .from('documents')
    .select('review_status')
    .eq('id', DOCUMENT)
    .maybeSingle();
  check('the owner is asked to decide', doc?.review_status === 'needs_review');

  const [vector] = await embed(['how do I contact the Baguette captain?'], 'RETRIEVAL_QUERY');
  const { data: hidden } = await db.rpc('match_chunks', {
    guild_id: GUILD,
    query_embedding: JSON.stringify(vector!),
    match_count: 6,
    min_similarity: 0.3,
  });
  const leaked = (hidden ?? []).some((m) => m.content.includes('kestrel@example.com'));
  check('nothing blocked is ever retrieved', !leaked);

  await approveDocument(GUILD, DOCUMENT);
  const { data: shown } = await db.rpc('match_chunks', {
    guild_id: GUILD,
    query_embedding: JSON.stringify(vector!),
    match_count: 6,
    min_similarity: 0.3,
  });
  check(
    'the owner can let it through',
    (shown ?? []).some((m) => m.content.includes('kestrel@example.com')),
  );

  // Left as it was found, so the next run starts from the same place.
  await db.from('documents').delete().eq('id', DOCUMENT);
}

console.log(['', 'one guild cannot see another'].join(String.fromCharCode(10)));
{
  const SEED = '900000000000000001';
  const secret = 'Obsidian Kite';
  const { data: theirs } = await db
    .from('chunks')
    .select('id')
    .eq('guild_id', GUILD)
    .ilike('content', `%${secret}%`);
  check('the fact exists in the other guild', (theirs ?? []).length > 0);

  const [vector] = await embed([`what is the trophy called?`], 'RETRIEVAL_QUERY');
  const { data: leaked } = await db.rpc('match_chunks', {
    guild_id: SEED,
    query_embedding: JSON.stringify(vector!),
    match_count: 6,
    min_similarity: 0.1,
  });
  check(
    'retrieval in this guild never returns it',
    !(leaked ?? []).some((m) => m.content.includes(secret)),
  );
}

console.log(['', 'forgetting a member'].join(String.fromCharCode(10)));
{
  const MEMBER = '424242424242424242';
  const DOC = '00000000-0000-4000-8000-00000000c010';
  await db.from('documents').upsert({
    id: DOC,
    guild_id: GUILD,
    title: 'Roster',
    source_type: 'paste',
    raw_text: ['Team Baguette roster:', 'kestrel, captain', 'ephemera, support'].join(
      String.fromCharCode(10),
    ),
    status: 'processing',
  });
  await ingest({ guildId: GUILD, documentId: DOC });
  await db.from('questions').insert({
    guild_id: GUILD,
    asker_discord_id: MEMBER,
    asker_name: 'ephemera',
    channel_id: 'c1',
    message_id: 'm1',
    bot_message_id: null,
    question: 'when do I play?',
    status: 'pending',
  });
  await db.from('conversations').insert({
    guild_id: GUILD,
    key: `c1:${MEMBER}`,
    turns: [],
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });

  const report = await forgetPerson(GUILD, MEMBER, ['ephemera']);
  check('their questions are gone', report.questions === 1, String(report.questions));
  check('their open conversation is gone', report.conversations === 1);
  check('the roster was edited', report.documents.length === 1);

  const { data: left } = await db
    .from('chunks')
    .select('content')
    .eq('guild_id', GUILD)
    .ilike('content', '%ephemera%');
  check('their name is out of the knowledge', (left ?? []).length === 0);
  const { data: others } = await db
    .from('chunks')
    .select('content')
    .eq('document_id', DOC)
    .ilike('content', '%kestrel%');
  check('everybody else is still there', (others ?? []).length > 0);

  await db.from('documents').delete().eq('id', DOC);
}

console.log(
  failed === 0 ? '\nall database checks passed.' : `\n${failed} database check(s) failed.`,
);
if (failed > 0) process.exitCode = 1;
