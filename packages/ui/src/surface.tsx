import type { ComponentProps } from 'react';
import { cx } from './cx';

export type SurfaceName = 'paper' | 'night';

/**
 * Sets the surface tokens for everything inside: paper (ink on paper) or
 * night (star white on night). `transparent` keeps the tokens but paints no
 * background, for content that sits over the sky.
 */
export function Surface({
  surface,
  transparent,
  className,
  ...props
}: ComponentProps<'div'> & { surface: SurfaceName; transparent?: boolean }) {
  return (
    <div
      data-surface={surface}
      className={cx(!transparent && 'bg-(--surface-bg)', 'text-(--surface-fg)', className)}
      {...props}
    />
  );
}
