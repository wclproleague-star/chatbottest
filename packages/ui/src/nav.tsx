import { cx } from './cx';
import { Wordmark } from './wordmark';

/**
 * The nav, top centre, max 560px wide, 40px tall. Over the sky it is
 * transparent with star white text; as the ink pill it gains night at 85%
 * with a 12px backdrop blur, radius 20, star white text. Items: wordmark
 * left; "How it works", "Pricing" and "Set up your bot", the only filled
 * item, right. Below 768px only the wordmark and "Set up your bot" remain.
 * Positioning belongs to the page.
 */
export function Nav({ pill, className }: { pill: boolean; className?: string }) {
  return (
    <nav
      className={cx(
        'text-star duration-(--duration-approve) ease-standard flex h-10 w-full max-w-[560px] items-center justify-between rounded-full pl-4 pr-1.5 transition-[background-color,backdrop-filter]',
        pill ? 'bg-ink/85 backdrop-blur-[12px]' : 'bg-transparent',
        className,
      )}
    >
      <a href="/" className="text-ui">
        <Wordmark />
      </a>
      <div className="flex items-center gap-5">
        <a
          href="/how-it-works"
          className="text-ui duration-(--duration-hover) ease-standard hidden transition-opacity hover:opacity-70 md:inline"
        >
          How it works
        </a>
        <a
          href="/pricing"
          className="text-ui duration-(--duration-hover) ease-standard hidden transition-opacity hover:opacity-70 md:inline"
        >
          Pricing
        </a>
        <a
          href="/servers"
          className="text-ui-sm bg-star text-night duration-(--duration-hover) ease-standard inline-flex h-7 items-center rounded-full px-3 font-medium transition-colors hover:bg-[color-mix(in_srgb,var(--color-star)_94%,var(--color-ink))]"
        >
          Set up your bot
        </a>
      </div>
    </nav>
  );
}
