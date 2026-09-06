import { Display } from '@sentrybot/ui';

/** A dashboard page's head: display type at 32px and a one-sentence lede in ink soft. No breadcrumbs. */
export function PageTitle({ title, lede }: { title: string; lede: string }) {
  return (
    <div>
      <Display className="[--display-size:32px]">{title}</Display>
      <p className="text-ink-soft mt-3">{lede}</p>
    </div>
  );
}
