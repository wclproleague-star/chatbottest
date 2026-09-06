import { Display } from '@kalvard/ui';
import { Beacon } from '@/components/beacon/beacon';
import type { Light } from '@/components/sky/beacon';

/**
 * A dashboard page's head.
 *
 * A page with a vard puts it at 96px beside a two-line head: the title, and
 * what the light means in words. That is the only size at which the object
 * reads as the thing it is rather than as a stray mark, and the two lines are
 * what give it something to stand next to.
 *
 * A page without one is the title and its lede, and nothing else.
 */
export function PageTitle({
  title,
  lede,
  light,
  standing,
}: {
  title: string;
  lede: string;
  light?: Light;
  /** What the light means, in words. Required whenever there is a light. */
  standing?: string;
}) {
  if (!light) {
    return (
      <div>
        <Display className="[--display-size:32px]">{title}</Display>
        <p className="text-ink-soft mt-3">{lede}</p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-6">
      <Beacon
        light={light}
        className="h-24 w-14 shrink-0"
        height={0.95}
        label={standing ?? 'Kalvard'}
      />
      <div className="min-w-0">
        <Display className="[--display-size:32px]">{title}</Display>
        <p className="text-ui text-star/70 mt-2">{standing ?? lede}</p>
      </div>
    </div>
  );
}
