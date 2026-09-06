import { Display } from '@kalvard/ui';
import { Beacon } from '@/components/beacon/beacon';
import type { Light } from '@/components/sky/beacon';

/**
 * A dashboard page's head: display type at 32px and a one-sentence lede in ink
 * soft. No breadcrumbs.
 *
 * A page may put the vard beside its title, and when it does the light is
 * the real state of this server rather than an ornament: what it is doing now,
 * said in a colour and in words underneath.
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
  const head = (
    <div>
      <Display className="[--display-size:32px]">{title}</Display>
      <p className="text-ink-soft mt-3">{lede}</p>
      {light && standing && <p className="text-ui text-star/70 mt-2">{standing}</p>}
    </div>
  );

  if (!light) return head;
  return (
    <div className="flex items-start gap-5">
      <Beacon
        light={light}
        className="h-16 w-10 shrink-0"
        height={0.95}
        label={standing ?? 'Kalvard'}
      />
      <div className="min-w-0">{head}</div>
    </div>
  );
}
