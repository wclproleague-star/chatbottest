import type { ComponentProps } from 'react';
import { cx } from './cx';

/** 44px tall, 10px radius, no shadow, no gradient, no arrow. Ink on paper, star white on night. Hover shifts 6% in 120ms. */
const base =
  'inline-flex h-11 shrink-0 items-center justify-center rounded-button px-5 text-ui font-medium shadow-[inset_0_1px_0_rgb(255_255_255/0.08)] outline-offset-2 transition-[background-color,transform] duration-(--duration-hover) ease-standard focus-visible:outline-2 focus-visible:outline-green active:scale-[0.98] active:duration-[80ms] disabled:opacity-40';

/** Primary: the surface's own contrast. Secondary: a hairline outline, nothing filled. */
const VARIANT = {
  primary: 'bg-(--button-bg) text-(--button-fg) hover:bg-(--button-bg-hover)',
  secondary: 'border-hairline text-ink hover:bg-ink/5 border bg-transparent',
} as const;

export type ButtonVariant = keyof typeof VARIANT;

export const buttonClass = `${base} ${VARIANT.primary}`;

export function Button({
  className,
  variant = 'primary',
  type = 'button',
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant }) {
  return <button type={type} className={cx(base, VARIANT[variant], className)} {...props} />;
}

export function ButtonLink({
  className,
  variant = 'primary',
  ...props
}: ComponentProps<'a'> & { variant?: ButtonVariant }) {
  return <a className={cx(base, VARIANT[variant], className)} {...props} />;
}
