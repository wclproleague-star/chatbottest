import { cx } from './cx';

/** A loading block: hairline grey, radius 6px, no shimmer. Content replaces it in place. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('bg-hairline rounded-md', className)} />;
}
