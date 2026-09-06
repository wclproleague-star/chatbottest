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

/**
 * A field is the answer, so it is set at reading size and in the reading
 * colour. It sits below the panel it is in and takes an amber edge on focus,
 * the same amber the rest of the dashboard uses for a thing that is on.
 */
const fieldClass =
  'text-ui text-ink placeholder:text-ink-soft/60 border-field-line focus:border-amber rounded-lg border bg-field px-3.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.03)] outline-none transition-colors disabled:opacity-40';

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
      className={cx(fieldClass, WIDTH[width], 'min-h-28 resize-y p-4', className)}
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
      <span className="text-ink-soft/60 mb-2 block text-[13px] leading-[1.3]">{label}</span>
      {children}
      {help && !error && (
        <span className="text-ink-soft/60 mt-2 block text-[13px] leading-[1.4]">{help}</span>
      )}
      {error && <span className="text-ui text-ink mt-2 block">{error}</span>}
    </label>
  );
}
