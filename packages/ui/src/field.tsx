import type { ComponentProps, ReactNode } from 'react';
import { cx } from './cx';

/**
 * Form pieces for the dashboard. Labels above in ink soft 14px; fields 44px
 * tall, radius 8px, hairline border, green focus ring; help text only when
 * needed, ink soft. Errors are inline, ink, one sentence.
 */

const fieldClass =
  'text-ui text-ink placeholder:text-ink-soft/70 border-hairline focus-visible:outline-green w-full rounded-lg border bg-panel px-3 outline-offset-2 focus-visible:outline-2 disabled:opacity-40';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cx(fieldClass, 'h-11', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cx(fieldClass, 'min-h-44 resize-y py-3', className)} {...props} />;
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
