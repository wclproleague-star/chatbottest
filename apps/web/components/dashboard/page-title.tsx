import { Display } from '@kalvard/ui';
import { Beacon } from '@/components/beacon/beacon';
import type { Light } from '@/components/sky/beacon';

/**
 * A dashboard page's head.
 *
 * Two shapes, and a page picks one. `bare` is the title and its lede, with the
 * vard's state as a line of text underneath: the state still gets said, and
 * nothing competes with the title. `beside` puts the object at 96px next to a
 * two-line head, which is the only size at which it reads as the thing it is
 * rather than as a stray mark.
 *
 * There is no third shape. A 64px beacon beside a 32px title reads as an
 * accident, which is exactly what it was.
 */
export function PageTitle({
  title,
  lede,
  light,
  standing,
  shape = 'bare',
}: {
  title: string;
  lede: string;
  light?: Light;
  /** What the light means, in words. Required whenever there is a light. */
  standing?: string;
  shape?: 'bare' | 'beside';
}) {
  const head = (
    <div className="min-w-0">
      <Display className="[--display-size:32px]">{title}</Display>
      <p className="text-ink-soft mt-3">{lede}</p>
    </div>
  );

  if (!light || shape === 'bare') {
    return (
      <div>
        {head}
        {light && standing && <p className="text-ui text-star/70 mt-3">{standing}</p>}
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
