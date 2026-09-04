import type { ComponentProps } from 'react';
import { cx } from './cx';

export function TextLink({ className, ...props }: ComponentProps<'a'>) {
  return (
    <a
      className={cx(
        'text-ui duration-(--duration-hover) ease-standard hover:text-(--surface-fg-soft) underline decoration-1 underline-offset-[3px] transition-colors',
        className,
      )}
      {...props}
    />
  );
}
