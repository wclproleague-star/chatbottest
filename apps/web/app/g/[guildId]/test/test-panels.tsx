'use client';

// The test page in two columns: the conversation on the left, and on the right
// the questions to try and the ones you have tried.
//
// A page with one box in the middle of 1440 is mostly empty, and empty reads
// as unfinished. What goes on the right is not filler: generated questions are
// the fastest way to find out what the knowledge does not cover, and the list
// of what you just asked is how you go back and ask it again after a change.

import { Button, Section } from '@kalvard/ui';
import { TestChat } from './test-chat';

export function TestPanels({ guildId, botName }: { guildId: string; botName: string }) {
  return (
    <TestChat
      guildId={guildId}
      botName={botName}
      aside={(parts) => (
        <>
          <Section
            heading="Questions to try"
            lede="Written from your knowledge, plus one it cannot answer."
          >
            {parts.note && <p className="text-ui text-ink-soft">{parts.note}</p>}
            {parts.suggestions && parts.suggestions.length > 0 && (
              <ul className="divide-hairline -my-2 divide-y">
                {parts.suggestions.map((q) => (
                  <li key={q}>
                    <button
                      type="button"
                      onClick={() => parts.ask(q)}
                      className="text-ui text-ink hover:bg-raised -mx-3 block w-full rounded-lg px-3 py-3 text-left transition-colors"
                    >
                      {q}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!parts.suggestions && !parts.note && (
              <p className="text-ink-faint text-[13px]">Nothing generated yet.</p>
            )}
            <div className="flex justify-end">
              <Button variant="secondary" onClick={parts.generate} disabled={parts.suggesting}>
                {parts.suggesting ? 'Thinking of questions' : 'Generate questions'}
              </Button>
            </div>
          </Section>

          <Section heading="What you have asked">
            {parts.recent.length === 0 ? (
              <p className="text-ink-faint text-[13px]">
                Nothing yet. The last five show up here, so you can ask one again after a change.
              </p>
            ) : (
              <ul className="divide-hairline -my-2 divide-y">
                {parts.recent.map((q, i) => (
                  <li key={`${q}-${i}`}>
                    <button
                      type="button"
                      onClick={() => parts.ask(q)}
                      className="text-ui text-ink hover:bg-raised -mx-3 block w-full rounded-lg px-3 py-3 text-left transition-colors"
                    >
                      {q}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    />
  );
}
