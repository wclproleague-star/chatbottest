'use client';

import { useEffect, useState } from 'react';
import { Button } from './button';
import { cx } from './cx';

export type InboxState = 'answered' | 'waiting';

export type InboxRowProps = {
  question: string;
  asker: string;
  channel: string;
  draft: string;
  almostKnew: string;
  state: InboxState;
  /** The bot's line that appears beneath the draft once approved. */
  followUp: string;
  /** Hovering Approve previews the green state; tapping commits it. */
  previewOnHover?: boolean;
};

/**
 * The inbox row: question, bot draft, what it almost knew, Approve.
 * Approve on a waiting row: the rule and button crossfade to green in 180ms,
 * then the follow-up line fades in beneath, 180ms later. Reduced motion
 * renders the end state.
 */
export function InboxRow({
  question,
  asker,
  channel,
  draft,
  almostKnew,
  state,
  followUp,
  previewOnHover = true,
}: InboxRowProps) {
  const [approved, setApproved] = useState(state === 'answered');
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setApproved(true);
  }, []);

  const green = approved || preview;
  const wasWaiting = state === 'waiting';

  return (
    <div
      data-state={green ? 'answered' : 'waiting'}
      className="border-(color:--state) duration-(--duration-approve) ease-standard grid gap-4 border-l-2 py-5 pl-4 transition-colors md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto] md:gap-6"
    >
      <div>
        <p className="text-ui">{question}</p>
        <p className="text-ui-sm text-ink-soft mt-1">
          {asker} in #{channel}
        </p>
      </div>

      <div>
        <p className="text-ui-sm text-ink-soft">Draft</p>
        <p className="text-ui mt-1">{draft}</p>
        {green && wasWaiting && (
          <p
            className="fade-in text-ui text-(--state) mt-2"
            style={{ animationDelay: 'var(--duration-approve)' }}
          >
            {followUp}
          </p>
        )}
      </div>

      <div>
        <p className="text-ui-sm text-ink-soft">What it almost knew</p>
        <p className="text-ui-sm text-ink-soft mt-1">{almostKnew}</p>
      </div>

      <div className={cx('md:justify-self-end', !wasWaiting && 'hidden md:block md:w-0')}>
        {wasWaiting && !approved && (
          <Button
            onClick={() => setApproved(true)}
            onMouseEnter={previewOnHover ? () => setPreview(true) : undefined}
            onMouseLeave={previewOnHover ? () => setPreview(false) : undefined}
          >
            Approve
          </Button>
        )}
      </div>
    </div>
  );
}
