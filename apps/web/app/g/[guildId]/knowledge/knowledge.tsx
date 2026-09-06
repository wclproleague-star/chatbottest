import { Section, Sections } from '@sentrybot/ui';
import { PageTitle } from '@/components/dashboard/page-title';
import { KnowledgeForms } from './knowledge-forms';

// Knowledge: what Sentry answers from. The score in a word, the ways to add
// more, and the documents with their status. Separate from the queries that
// fill it, so it can be looked at without a Discord session behind it.

export type Document = {
  id: string;
  title: string | null;
  sourceType: string;
  status: string;
  chunkCount: number | null;
  error: string | null;
  addedAt: string;
};

const SOURCE: Record<string, string> = {
  upload: 'Upload',
  paste: 'Pasted',
  qa: 'Q&A',
  mod_answer: 'Mod answer',
  channel: 'Channel',
};

export function Knowledge({
  guildId,
  chunks,
  documents,
}: {
  guildId: string;
  chunks: number;
  documents: Document[];
}) {
  const score = scoreFor(chunks);

  return (
    <div>
      <PageTitle
        title="Knowledge"
        lede="What Sentry answers from. Add rules, guides and answers; it reads them in about a minute."
      />

      <div className="mt-10">
        <Sections>
          <Section heading="How much it knows">
            <p className="text-[20px] font-medium">{score.word}</p>
            <p className="text-ink-soft">{score.sentence}</p>
          </Section>

          <KnowledgeForms guildId={guildId} />

          <Section heading="What it has read">
            {documents.length === 0 ? (
              <p className="text-ink-soft">
                Nothing here yet. Paste your rules above to give Sentry its first answers.
              </p>
            ) : (
              <ul className="divide-hairline -my-4 divide-y">
                {documents.map((d) => (
                  <li key={d.id} className="py-4">
                    <p className="text-ink">{d.title ?? 'Untitled'}</p>
                    <p className="text-ui-sm text-ink-soft mt-0.5">
                      {SOURCE[d.sourceType] ?? d.sourceType}
                      {' · '}
                      {statusLine(d.status, d.chunkCount, d.error)}
                      {' · '}
                      {d.addedAt}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </Sections>
      </div>
    </div>
  );
}

export function scoreFor(chunks: number): { word: string; sentence: string } {
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
