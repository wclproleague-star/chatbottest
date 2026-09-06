'use client';

// The dashboard's navigation. From 1024px a 240px sidebar: wordmark and the
// server's name at the top, the pages in ink soft with the current one in ink
// behind a 2px green rule, then the way back to your servers and sign out.
// Below 1024px it collapses to a top bar with a menu that opens the same list.

import { Wordmark, cx } from '@kalvard/ui';
import { Beacon } from '../beacon/beacon';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const PAGES = [
  ['overview', 'Overview'],
  ['knowledge', 'Knowledge'],
  ['personality', 'Personality'],
  ['inbox', 'Inbox'],
  ['commands', 'Commands'],
  ['settings', 'Settings'],
  ['test', 'Test'],
] as const;

export function Sidebar({ guildId, guildName }: { guildId: string; guildName: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = pathname.split('/')[3] ?? '';

  const list = (
    <ul className="space-y-1">
      {PAGES.map(([slug, label]) => {
        const active = slug === current;
        return (
          <li key={slug}>
            <a
              href={`/g/${guildId}/${slug}`}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'text-ui block border-l-2 py-1.5 pl-3 transition-colors',
                active
                  ? 'border-green text-ink'
                  : 'text-ink-soft hover:text-ink border-transparent',
              )}
            >
              {label}
            </a>
          </li>
        );
      })}
    </ul>
  );

  const footer = (
    <div className="text-ui-sm text-ink-soft flex items-center gap-4">
      <a href="/servers" className="hover:text-ink transition-colors">
        Your servers
      </a>
      <form action="/auth/signout" method="post">
        <button type="submit" className="hover:text-ink transition-colors">
          Sign out
        </button>
      </form>
    </div>
  );

  return (
    <>
      <aside className="border-hairline hidden h-screen w-60 shrink-0 flex-col border-r px-6 py-6 lg:sticky lg:top-0 lg:flex">
        <div className="flex items-center gap-3">
          <Beacon light="amber" className="h-10 w-[27px] shrink-0" label="Kalvard, watching" />
          <div className="min-w-0">
            <a href="/" className="text-ui text-ink">
              <Wordmark />
            </a>
            <p className="text-ui-sm text-ink-soft mt-1 truncate">{guildName}</p>
          </div>
        </div>
        <nav className="mt-10 flex-1" aria-label="Pages">
          {list}
        </nav>
        {footer}
      </aside>

      <header className="border-hairline border-b px-6 lg:hidden">
        <div className="flex h-14 items-center justify-between">
          <div className="min-w-0">
            <a href="/" className="text-ui text-ink">
              <Wordmark />
            </a>
            <span className="text-ui-sm text-ink-soft ml-3 truncate">{guildName}</span>
          </div>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="dashboard-menu"
            onClick={() => setOpen((o) => !o)}
            className="text-ui text-ink h-11 px-2"
          >
            {open ? 'Close' : 'Menu'}
          </button>
        </div>
        <nav id="dashboard-menu" hidden={!open} className="space-y-6 pb-6" aria-label="Pages">
          {list}
          {footer}
        </nav>
      </header>
    </>
  );
}
