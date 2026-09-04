import type { ComponentProps } from 'react';
import { cx } from './cx';

/** Display type. Size, weight, tracking and the 92% width live in tokens.css. */
export function Display({ className, ...props }: ComponentProps<'h1'>) {
  return <h1 className={cx('display', className)} {...props} />;
}
