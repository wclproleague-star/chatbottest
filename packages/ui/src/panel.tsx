import type { ComponentProps } from 'react';
import { cx } from './cx';

/** White, ink text on either surface. The only thing with a shadow, besides the inbox panel it also builds. */
export function Panel({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cx(
        'rounded-panel bg-panel text-ink shadow-(--surface-panel-shadow) p-6',
        className,
      )}
      {...props}
    />
  );
}
