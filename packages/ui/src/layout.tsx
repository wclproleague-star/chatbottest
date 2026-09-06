import type { ComponentProps, ReactNode } from 'react';
import { cx } from './cx';

/**
 * The dashboard's shape, in three pieces, so no screen has to decide it again.
 *
 * A page is one centred column, not a left-glued sheet that grows with the
 * window: reading a form is reading, and a line of text has a width past which
 * it stops being one. Inside the column, subjects are panels, and a field
 * never floats on the paper on its own, because a field with nothing around it
 * belongs to nothing.
 */

/** The content column: centred, 720px, gutters on a phone. */
export function Column({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('mx-auto w-full max-w-[720px]', className)} {...props} />;
}

/** Panels down a page, 32px apart. */
export function Sections({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('space-y-8', className)} {...props} />;
}

/**
 * One subject: a white panel, its heading in ink at 20px, its fields inside.
 * `footer` is where a Save or a pair of buttons goes, bottom right.
 */
export function Section({
  heading,
  lede,
  footer,
  children,
  className,
}: {
  heading: string;
  lede?: string;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        'rounded-panel bg-panel text-ink shadow-(--surface-panel-shadow) p-6',
        className,
      )}
    >
      <h2 className="text-[20px] font-medium">{heading}</h2>
      {lede && <p className="text-ui-sm text-ink-soft mt-1">{lede}</p>}
      <div className="mt-5 space-y-5">{children}</div>
      {footer && <div className="mt-6 flex items-center justify-end gap-4">{footer}</div>}
    </section>
  );
}
