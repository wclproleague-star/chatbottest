'use client';

import { Button, Field, Input, Textarea, Toast, cx } from '@sentrybot/ui';
import { useActionState, useState } from 'react';
import { addAnswer, pasteDocument, uploadDocument } from './actions';
import type { KnowledgeState } from './actions';

// The three ways in: upload, paste, Q&A. One at a time, as tabs. Each form
// waits while Sentry reads the document, then a toast says what happened;
// errors sit under the form in one sentence.

type Tab = 'upload' | 'paste' | 'qa';
const TABS: { key: Tab; label: string }[] = [
  { key: 'upload', label: 'Upload' },
  { key: 'paste', label: 'Paste' },
  { key: 'qa', label: 'Q&A' },
];

export function KnowledgeForms({ guildId }: { guildId: string }) {
  const [tab, setTab] = useState<Tab>('paste');
  const [upload, uploadAction, uploading] = useActionState<KnowledgeState, FormData>(
    uploadDocument,
    null,
  );
  const [paste, pasteAction, pasting] = useActionState<KnowledgeState, FormData>(
    pasteDocument,
    null,
  );
  const [qa, qaAction, adding] = useActionState<KnowledgeState, FormData>(addAnswer, null);
  const states = { upload, paste, qa };
  const state = states[tab];
  const latest = [upload, paste, qa]
    .filter((s): s is NonNullable<KnowledgeState> => Boolean(s?.ok))
    .sort((a, b) => b.id - a.id)[0];

  return (
    <section className="mt-12">
      <div role="tablist" aria-label="How to add knowledge" className="flex gap-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cx(
              'text-ui -mb-px border-b-2 pb-2 transition-colors',
              tab === t.key
                ? 'border-green text-ink'
                : 'text-ink-soft hover:text-ink border-transparent',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="border-hairline mt-0 border-t pt-6">
        {tab === 'upload' && (
          <form action={uploadAction} className="max-w-[60ch] space-y-5">
            <input type="hidden" name="guild_id" value={guildId} />
            <Field label="File" help="A .txt, .md or .pdf, up to 20 MB.">
              <Input
                type="file"
                name="file"
                accept=".txt,.md,.markdown,.pdf"
                required
                className="file:text-ui file:text-ink file:mr-3 file:border-0 file:bg-transparent file:p-0 file:font-medium"
              />
            </Field>
            <Submit pending={uploading} idle="Upload" busy="Reading it" />
          </form>
        )}
        {tab === 'paste' && (
          <form action={pasteAction} className="max-w-[60ch] space-y-5">
            <input type="hidden" name="guild_id" value={guildId} />
            <Field label="Title" help="Optional. The first line stands in if you leave it empty.">
              <Input name="title" maxLength={120} placeholder="Server rules" />
            </Field>
            <Field label="Text">
              <Textarea
                name="text"
                required
                minLength={20}
                placeholder="Paste rules, guides, schedules, anything members ask about."
              />
            </Field>
            <Submit pending={pasting} idle="Add" busy="Reading it" />
          </form>
        )}
        {tab === 'qa' && (
          <form action={qaAction} className="max-w-[60ch] space-y-5">
            <input type="hidden" name="guild_id" value={guildId} />
            <Field label="A member asks">
              <Input name="question" required maxLength={300} placeholder="When is check-in?" />
            </Field>
            <Field label="Sentry answers">
              <Textarea
                name="answer"
                required
                className="min-h-28"
                placeholder="An hour before the bracket, in #announcements."
              />
            </Field>
            <Submit pending={adding} idle="Add answer" busy="Reading it" />
          </form>
        )}
        {state?.error && <p className="text-ui mt-4 max-w-[60ch]">{state.error}</p>}
      </div>

      <Toast id={latest?.id ?? 0} message={latest?.ok ?? null} />
    </section>
  );
}

function Submit({ pending, idle, busy }: { pending: boolean; idle: string; busy: string }) {
  return (
    <div className="flex justify-end">
      <Button type="submit" disabled={pending} className="disabled:opacity-40">
        {pending ? busy : idle}
      </Button>
    </div>
  );
}
