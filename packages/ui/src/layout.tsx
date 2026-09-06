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

/** The content column: centred, 1200px, gutters on a phone. */
export function Column({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('mx-auto w-full max-w-[1200px]', className)} {...props} />;
}

/**
 * Two columns from 1024 up, one below.
 *
 * A dashboard at 1440 with one 720px column is two thirds empty, and empty is
 * not calm, it is unfinished. What goes left is what you act on; what goes
 * right is what you look at.
 */
export function Split({
  left,
  right,
  className,
}: {
  left: ReactNode;
  right: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]', className)}>
      <div className="min-w-0 space-y-6">{left}</div>
      <div className="min-w-0 space-y-6">{right}</div>
    </div>
  );
}

/** Panels down a page. */
export function Sections({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('space-y-6', className)} {...props} />;
}

/**
 * One subject: a white panel, its heading in ink at 20px, its fields inside.
 * `footer` is where a Save or a pair of buttons goes, bottom right.
 */
export function Section({
  heading,
  lede,
  footer,
  tone = 'secondary',
  children,
  className,
}: {
  heading: string;
  lede?: string;
  footer?: ReactNode;
  /**
   * The one panel a page is about sits a shade above the others. Every page
   * has exactly one; if two look primary, neither is.
   */
  tone?: 'primary' | 'secondary';
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        'rounded-panel text-ink shadow-(--surface-panel-shadow) p-6',
        tone === 'primary' ? 'bg-raised' : 'bg-panel',
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
