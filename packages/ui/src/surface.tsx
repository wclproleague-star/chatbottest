import type { ComponentProps } from 'react';
import { cx } from './cx';

export type SurfaceName = 'paper' | 'night';

/** Sets the surface tokens for everything inside: paper (ink on paper) or night (star white on night). */
export function Surface({
  surface,
  className,
  ...props
}: ComponentProps<'div'> & { surface: SurfaceName }) {
  return (
    <div
      data-surface={surface}
      className={cx('bg-(--surface-bg) text-(--surface-fg)', className)}
      {...props}
    />
  );
}
