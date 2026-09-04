import type { ComponentProps, CSSProperties } from 'react';
import { cx } from './cx';

/** Display type width, on the family's width axis. The default lives in tokens.css. */
export type DisplayWidth = '84%' | '92%' | '100%';

export const DISPLAY_WIDTHS: { width: DisplayWidth; label: string }[] = [
  { width: '84%', label: 'Narrow' },
  { width: '92%', label: 'Slight' },
  { width: '100%', label: 'Full' },
];

export function Display({
  width,
  className,
  style,
  ...props
}: ComponentProps<'h1'> & { width?: DisplayWidth }) {
  const vars = width ? ({ '--display-width': width } as CSSProperties) : undefined;
  return <h1 className={cx('display', className)} style={{ ...vars, ...style }} {...props} />;
}
