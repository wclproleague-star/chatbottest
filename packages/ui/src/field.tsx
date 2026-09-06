import type { ComponentProps, ReactNode } from 'react';
import { cx } from './cx';

/**
 * Form pieces for the dashboard. Labels above in ink soft 14px; fields 44px
 * tall, radius 8px, hairline border, green focus ring; help text only when
 * needed, ink soft. Errors are inline, ink, one sentence.
 *
 * A field is as wide as what goes in it, never as wide as the column. A name
 * is three words, a number is three digits, and a box stretched to the full
 * width of the page is a lie about how much you are expected to type.
 */

/** How wide a field is, by what it holds. */
export type FieldWidth = 'short' | 'number' | 'select' | 'full';

const WIDTH: Record<FieldWidth, string> = {
  short: 'w-full max-w-[320px]',
  number: 'w-full max-w-[120px]',
  select: 'w-full max-w-[420px]',
  full: 'w-full',
};

const fieldClass =
  'text-ui text-ink placeholder:text-ink-soft/70 border-field-line focus-visible:outline-green rounded-lg border bg-field px-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] outline-offset-2 focus-visible:outline-2 disabled:opacity-40';

export function Input({
  className,
  width = 'short',
  ...props
}: ComponentProps<'input'> & { width?: FieldWidth }) {
  return <input className={cx(fieldClass, WIDTH[width], 'h-11', className)} {...props} />;
}

export function Textarea({
  className,
  width = 'full',
  ...props
}: ComponentProps<'textarea'> & { width?: FieldWidth }) {
  return (
    <textarea
      className={cx(fieldClass, WIDTH[width], 'min-h-24 resize-y py-3', className)}
      {...props}
    />
  );
}

export function Field({
  label,
  help,
  error,
  children,
  className,
}: {
  label: string;
  help?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('block', className)}>
      <span className="text-ui-sm text-ink-soft mb-1.5 block">{label}</span>
      {children}
      {help && !error && <span className="text-ui-sm text-ink-soft mt-1.5 block">{help}</span>}
      {error && <span className="text-ui-sm text-ink mt-1.5 block">{error}</span>}
    </label>
  );
}
