import type { ComponentProps } from 'react';
import { cx } from './cx';

/** 44px tall, 10px radius, no shadow, no gradient, no arrow. Ink on paper, star white on night. Hover shifts 6% in 120ms. */
export const buttonClass =
  'inline-flex h-11 shrink-0 items-center justify-center rounded-button bg-(--button-bg) px-5 text-ui font-medium text-(--button-fg) transition-colors duration-(--duration-hover) ease-standard hover:bg-(--button-bg-hover)';

export function Button({ className, type = 'button', ...props }: ComponentProps<'button'>) {
  return <button type={type} className={cx(buttonClass, className)} {...props} />;
}

export function ButtonLink({ className, ...props }: ComponentProps<'a'>) {
  return <a className={cx(buttonClass, className)} {...props} />;
}
