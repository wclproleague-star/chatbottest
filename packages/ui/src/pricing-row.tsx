import type { ComponentProps } from 'react';
import { cx } from './cx';

/** One pricing row: name, one sentence, price. Reads like a menu. */
export function PricingRow({
  name,
  line,
  price,
  className,
}: {
  name: string;
  line: string;
  price: string;
  className?: string;
}) {
  return (
    <div
      className={cx('flex flex-col gap-1 py-5 md:flex-row md:items-baseline md:gap-8', className)}
    >
      <div className="font-medium md:w-40 md:shrink-0">{name}</div>
      <p className="text-(--surface-fg-soft) md:flex-1">{line}</p>
      <div className="md:text-right">{price}</div>
    </div>
  );
}

/** Stacks pricing rows with hairlines between them. */
export function PricingList({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('divide-(color:--surface-hairline) divide-y', className)} {...props} />;
}
