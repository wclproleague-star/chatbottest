import type { ReactNode } from 'react';
import { cx } from './cx';

export type ThreadRole = 'member' | 'sentry' | 'mod';
export type ThreadState = 'answered' | 'waiting';

/**
 * One message in the thread. 15px, line-height 1.45, sender name in ink soft
 * above. A 2px left rule in the state colour on Sentry's messages only; the
 * others keep a transparent rule so the text lines up.
 */
export function ThreadMessage({
  role,
  name,
  state,
  typing,
  children,
}: {
  role: ThreadRole;
  name: string;
  state?: ThreadState;
  typing?: boolean;
  children?: ReactNode;
}) {
  const sentry = role === 'sentry';
  return (
    <div
      data-state={sentry ? (state ?? 'answered') : undefined}
      className={cx(
        'duration-(--duration-approve) ease-standard border-l-2 pl-3 transition-colors',
        sentry ? 'border-(color:--state)' : 'border-transparent',
      )}
    >
      {/* Ink soft on a white panel; a glass panel sets --thread-name to star white at 55%. */}
      <div className="text-ui-sm text-[var(--thread-name,var(--color-ink-soft))]">{name}</div>
      <p className={cx('text-thread', typing && 'cursor')}>{children}</p>
    </div>
  );
}
