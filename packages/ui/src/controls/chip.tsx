'use client';

import { cx } from '../cx';

/**
 * A channel or a role, as the thing it is.
 *
 * A list of ticks says "form". A row of pills says "these are your channels",
 * which is what a Discord server actually looks like, and picking three of
 * twenty is a glance rather than a scan. Off is a hairline; on is an amber
 * hairline with the faintest fill, so a chosen one reads from across the room
 * without shouting.
 *
 * It is a button, not a checkbox: the value travels in a hidden input so the
 * form still posts what it always posted.
 */
export function Chip({
  name,
  value,
  label,
  prefix,
  on,
  onToggle,
}: {
  name: string;
  value: string;
  label: string;
  /** '#' for a channel, nothing for a role. */
  prefix?: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      {on && <input type="hidden" name={name} value={value} />}
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={on}
        className={cx(
          'text-ui inline-flex h-8 items-center gap-1 rounded-full border px-3 transition-colors',
          'focus-visible:outline-green outline-offset-2 focus-visible:outline-2',
          on
            ? 'border-amber bg-amber/10 text-ink'
            : 'border-hairline text-ink-soft hover:text-ink hover:border-ink-soft/40',
        )}
      >
        {prefix && <span className={on ? 'text-amber' : 'text-ink-soft'}>{prefix}</span>}
        {label}
      </button>
    </>
  );
}

/** The row of them, wrapping across the panel. */
export function Chips({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}
