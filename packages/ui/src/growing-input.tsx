'use client';

import type { ComponentProps } from 'react';
import { useLayoutEffect, useRef } from 'react';
import { cx } from './cx';

/**
 * One line that grows as you type. A box that starts three lines tall asks for
 * three lines; most answers here are one sentence, and the box should say so
 * and then get out of the way when they are not.
 */
export function GrowingInput({
  className,
  maxRows = 8,
  onInput,
  ...props
}: ComponentProps<'textarea'> & { maxRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function grow(node: HTMLTextAreaElement | null) {
    if (!node) return;
    const line = parseFloat(getComputedStyle(node).lineHeight) || 22;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, line * maxRows + 24)}px`;
  }

  useLayoutEffect(() => grow(ref.current), [props.value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      onInput={(e) => {
        grow(e.currentTarget);
        onInput?.(e);
      }}
      className={cx(
        'text-ui text-ink placeholder:text-ink-soft/70 border-hairline focus-visible:outline-green bg-panel w-full resize-none overflow-hidden rounded-lg border px-3 py-2.5 outline-offset-2 focus-visible:outline-2 disabled:opacity-40',
        className,
      )}
      {...props}
    />
  );
}
