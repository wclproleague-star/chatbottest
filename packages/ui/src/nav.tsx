import { cx } from './cx';
import { Wordmark } from './wordmark';

export type NavState = 'sky' | 'paper';

const LINKS: { href: string; label: string; always?: boolean }[] = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/servers', label: 'Set up your bot', always: true },
];

/**
 * The nav in both states. Over the sky: transparent, star white. On paper: a
 * 40px ink pill with a 12px backdrop blur. Positioning belongs to line 7.
 * Below md only the wordmark and "Set up your bot" fit; the rest hides.
 */
export function Nav({ state, className }: { state: NavState; className?: string }) {
  const links = LINKS.map((l) => (
    <a
      key={l.href}
      href={l.href}
      className={cx(
        'text-ui duration-(--duration-hover) ease-standard transition-opacity hover:opacity-70',
        !l.always && 'hidden md:inline',
      )}
    >
      {l.label}
    </a>
  ));

  if (state === 'sky') {
    return (
      <nav className={cx('text-star flex h-16 items-center justify-between', className)}>
        <a href="/" className="text-ui">
          <Wordmark />
        </a>
        <div className="flex items-center gap-6">{links}</div>
      </nav>
    );
  }

  return (
    <nav
      className={cx(
        'bg-ink/85 text-star inline-flex h-10 items-center gap-6 rounded-full pl-4 pr-4 backdrop-blur-[12px]',
        className,
      )}
    >
      <a href="/" className="text-ui">
        <Wordmark />
      </a>
      {links}
    </nav>
  );
}
