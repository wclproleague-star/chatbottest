import { Display } from '@kalvard/ui';

/**
 * A dashboard page's head: the title and one sentence.
 *
 * The vard used to stand here on five of the seven pages, which made it
 * decoration: a light that means the same thing on every screen means nothing
 * on any of them. It lives where it says something instead — in the sidebar,
 * where it is the server's state, and on the two pages where it is actually
 * doing something while you watch.
 */
export function PageTitle({ title, lede }: { title: string; lede: string }) {
  return (
    <div>
      <Display className="[--display-size:32px]">{title}</Display>
      <p className="text-ink-soft mt-3">{lede}</p>
    </div>
  );
}
