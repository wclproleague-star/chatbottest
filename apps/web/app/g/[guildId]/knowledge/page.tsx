import { Panel } from '@sentrybot/ui';
import { PageTitle } from '@/components/dashboard/page-title';
import { requireMember } from '@/lib/guild';
import { formatDate } from '@/lib/format';
import { KnowledgeForms } from './knowledge-forms';

// Knowledge: what Sentry answers from. The score in a word, the ways to add
// more, and the documents with their status.

const SOURCE: Record<string, string> = {
  upload: 'Upload',
  paste: 'Pasted',
  qa: 'Q&A',
  mod_answer: 'Mod answer',
  channel: 'Channel',
};

export default async function Page({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const { supabase } = await requireMember(guildId);

  const [{ data: documents }, { count }] = await Promise.all([
    supabase
      .from('documents')
      .select('id, title, source_type, status, error_message, chunk_count, created_at')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false }),
    supabase.from('chunks').select('id', { count: 'exact', head: true }).eq('guild_id', guildId),
  ]);
  const chunks = count ?? 0;
  const score = scoreFor(chunks);

  return (
    <div className="max-w-[880px]">
      <PageTitle
        title="Knowledge"
        lede="What Sentry answers from. Add rules, guides and answers; it reads them in about a minute."
      />

      <section className="mt-12" aria-label="Knowledge score">
        <p className="text-[20px] font-medium">{score.word}</p>
        <p className="text-ink-soft mt-1 max-w-[60ch]">{score.sentence}</p>
      </section>

      <KnowledgeForms guildId={guildId} />

      <section className="mt-12" aria-label="Documents">
        {!documents || documents.length === 0 ? (
          <p className="text-ink-soft max-w-[60ch]">
            Nothing here yet. Paste your rules above to give Sentry its first answers.
          </p>
        ) : (
          <Panel className="divide-hairline divide-y p-0 px-6 shadow-none">
            {documents.map((d) => (
              <div key={d.id} className="py-4">
                <p className="truncate">{d.title ?? 'Untitled'}</p>
                <p className="text-ui-sm text-ink-soft mt-0.5">
                  {SOURCE[d.source_type] ?? d.source_type}
                  {' · '}
                  {statusLine(d.status, d.chunk_count, d.error_message)}
                  {' · '}
                  {formatDate(d.created_at)}
                </p>
              </div>
            ))}
          </Panel>
        )}
      </section>
    </div>
  );
}

function scoreFor(chunks: number): { word: string; sentence: string } {
  if (chunks < 10) {
    return {
      word: 'Thin',
      sentence: `${chunks === 0 ? 'No' : chunks} ${chunks === 1 ? 'piece' : 'pieces'} of knowledge. Sentry will send most questions to a moderator until there is more here.`,
    };
  }
  if (chunks <= 50) {
    return {
      word: 'Decent',
      sentence: `${chunks} pieces of knowledge. Sentry can answer the common questions and will ask about the rest.`,
    };
  }
  return {
    word: 'Solid',
    sentence: `${chunks} pieces of knowledge. Sentry can answer most questions on its own.`,
  };
}

function statusLine(status: string, chunks: number | null, error: string | null): string {
  if (status === 'ready') return `Ready, ${chunks ?? 0} ${chunks === 1 ? 'piece' : 'pieces'}`;
  if (status === 'processing') return 'Reading';
  return `Could not read it${error ? `: ${error}` : ''}`;
}
