'use client';

import { InboxRow, Panel, cx } from '@sentrybot/ui';
import type { InboxRowProps, InboxTransition } from '@sentrybot/ui';
import { useState } from 'react';

const TRANSITIONS: { id: InboxTransition; label: string; note: string }[] = [
  {
    id: 'plain',
    label: 'Plain',
    note: 'Rule and button crossfade together; the follow-up fades in with them.',
  },
  {
    id: 'sequenced',
    label: 'Sequenced',
    note: 'Rule turns green first, then the follow-up fades in 180ms later.',
  },
  {
    id: 'replace',
    label: 'Replace',
    note: 'Approve crossfades into a green "Approved"; the follow-up fades in beneath.',
  },
];

/** Three real rows. Two green, one amber. Placeholder copy until line 13. */
const ROWS: Omit<InboxRowProps, 'transition'>[] = [
  {
    question: 'where do I find the map pool?',
    asker: 'kestrel',
    channel: 'help',
    draft: "It's pinned in #match-info.",
    almostKnew:
      'Roles and channels: #match-info holds the map pool, reschedule requests and casting requests.',
    state: 'answered',
    followUp: 'Added to what I know.',
  },
  {
    question: 'what if the other captain ignores my reschedule request?',
    asker: 'juno',
    channel: 'help',
    draft:
      'Reschedules need both captains to agree, asked in #match-info 48 hours ahead. If they will not reply, that is one for the mods.',
    almostKnew:
      'Tournament format: reschedule requests go to #match-info at least 48 hours before the match and need both captains to agree.',
    state: 'waiting',
    followUp: 'Added to what I know.',
  },
  {
    question: 'can I stream my own matches?',
    asker: 'mara',
    channel: 'general',
    draft: 'Yes. Post the link in #self-promo only.',
    almostKnew: 'Server rules: post your own streams and videos in #self-promo only.',
    state: 'answered',
    followUp: 'Added to what I know.',
  },
];

export function InboxDemo() {
  const [transition, setTransition] = useState<InboxTransition>('plain');
  const current = TRANSITIONS.find((t) => t.id === transition) ?? TRANSITIONS[0]!;

  return (
    <div>
      <div className="text-ui mb-4 flex flex-wrap items-baseline gap-x-5 gap-y-2">
        {TRANSITIONS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTransition(t.id)}
            className={cx(
              'underline-offset-[3px]',
              t.id === transition ? 'underline' : 'text-(--surface-fg-soft) hover:underline',
            )}
          >
            {t.label}
          </button>
        ))}
        <span className="text-ui-sm text-(--surface-fg-soft)">{current.note}</span>
      </div>
      <Panel key={transition} className="divide-(color:--surface-hairline) divide-y py-1">
        {ROWS.map((row) => (
          <InboxRow key={row.question} {...row} transition={transition} />
        ))}
      </Panel>
    </div>
  );
}
