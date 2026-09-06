'use client';

import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * A row in a list that opens in place.
 *
 * Closed, it is three lines: what was asked, who and where, and one line of
 * what Sentry said. That is enough to decide whether this is the one you deal
 * with now, and a screen of them can be read without scrolling. Open, the same
 * row grows to hold everything the decision needs. Only one is ever open, so
 * the list never becomes a page you have to scroll to get back to.
 *
 * The left rule carries the state: amber while it waits on a person, green
 * once somebody has answered.
 */
export function ExpandingRow({
  title,
  meta,
  preview,
  state,
  open,
  onToggle,
  mark,
  aside,
  children,
}: {
  title: string;
  /** Asker, channel, date: one line, ink soft. */
  meta: ReactNode;
  /** One line of what Sentry said, truncated when closed. */
  preview?: string;
  state: 'waiting' | 'answered';
  open: boolean;
  onToggle: () => void;
  /** Left of the title: on the inbox, the light this row was handed over under. */
  mark?: ReactNode;
  /** A link or two, right of the title. Not part of the toggle. */
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={cx('border-l-2 p-5', state === 'waiting' ? 'border-amber' : 'border-green')}>
      <div className="flex items-start gap-4">
        {mark && <div className="shrink-0 pt-0.5">{mark}</div>}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="min-w-0 flex-1 text-left"
        >
          <span className="text-thread text-ink block">{title}</span>
          <span className="text-ui-sm text-ink-soft mt-1 block">{meta}</span>
          {/* Closed, one line of it; open, the block below says it in full. */}
          {preview && !open && (
            <span className="text-ui-sm text-ink-soft mt-2 block truncate">{preview}</span>
          )}
        </button>
        {aside && <div className="text-ui-sm text-ink-soft shrink-0">{aside}</div>}
      </div>
      {open && children && <div className="fade-in mt-4">{children}</div>}
    </div>
  );
}

/** A labelled block inside an open row: what it almost knew, and the like. */
export function RowBlock({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('border-hairline bg-raised rounded-lg border p-4', className)}>
      <p className="text-ui-sm text-ink-soft">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}
