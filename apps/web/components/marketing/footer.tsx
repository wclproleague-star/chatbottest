import { Wordmark } from '@kalvard/ui';

// The footer: the tagline, the links, and the story in one line. This is one
// of exactly three places the story is told; the others are the About page and
// the launch film. It is never in a headline and never in hero copy.

const LINKS: [string, string][] = [
  ['How it works', '/how-it-works'],
  ['Pricing', '/pricing'],
  ['About', '/about'],
  ['Set up your bot', '/servers'],
];

export function Footer() {
  return (
    <footer className="mx-auto max-w-[1120px] px-6 pb-12 pt-24 lg:px-0">
      <div className="flex flex-wrap items-start justify-between gap-8">
        <div className="max-w-[52ch]">
          <p className="text-ink text-[20px]">Got it. Next time I&apos;ll know.</p>
          <p className="text-ink-soft text-ui-sm mt-3">
            Named after the vard, the stone beacons that kept watch on Norway&apos;s coast. Stand
            still, stay lit, wake the right person.
          </p>
        </div>
        <ul className="text-ui-sm text-ink-soft space-y-2">
          {LINKS.map(([label, href]) => (
            <li key={href}>
              <a href={href} className="hover:text-ink transition-colors">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </div>
      <div className="border-hairline text-ui-sm text-ink-soft mt-10 flex items-center justify-between border-t pt-6">
        <span className="text-ink">
          <Wordmark />
        </span>
        <span>{new Date().getFullYear()}</span>
      </div>
    </footer>
  );
}
