'use client';

// Your servers, as the night watch sees them.
//
// This is the first screen of the product proper, so it says what the product
// is: a row of sentries standing in the dark, each one showing what it is
// doing right now. The light is not decoration here, it is the state — dark
// for one that was never set up, amber for one watching, green for one that
// answered somebody in the last hour, breathing for one carrying something
// out — and the line under the name is the same fact in words, because a
// colour on its own is a thing you have to be taught.
//
// Servers you cannot manage are not your business and take one row, not
// fourteen.

import { ButtonLink, Surface, cx } from '@kalvard/ui';
import { useState } from 'react';
import { Beacon } from '@/components/beacon/beacon';
import { NightSky } from '@/components/dashboard/night-sky';
import { TopBar } from '@/components/dashboard/top-bar';
import type { Light } from '@/components/sky/beacon';
import { ClaimButton } from './claim-button';

export type ServerCard = {
  guildId: string;
  name: string;
  icon: string | null;
  /** Claimed by somebody here: it has a dashboard to open. */
  claimed: boolean;
  light: Light;
  /** One true line: what it did this week, or that it is not set up. */
  line: string;
};

export function Servers({
  manageable,
  others,
  notice,
}: {
  manageable: ServerCard[];
  others: { guildId: string; name: string }[];
  notice?: string;
}) {
  return (
    <Shell>
      <Head lede={lit(manageable)} />
      {notice && <p className="text-body text-star/80 mt-6">{notice}</p>}

      {manageable.length === 0 ? (
        <p className="text-body text-star/70 mt-10 max-w-[52ch]">
          No servers you can manage. Join one on Discord, or ask its owner for the settings
          permission, then sign in again.
        </p>
      ) : (
        <ul className="mt-12 space-y-3">
          {manageable.map((server) => (
            <li key={server.guildId}>
              <Card server={server} />
            </li>
          ))}
        </ul>
      )}

      {others.length > 0 && <Others others={others} />}
    </Shell>
  );
}

/** How many are actually keeping watch, said before anything else. */
function lit(servers: ServerCard[]): string {
  const watching = servers.filter((s) => s.light !== 'off').length;
  if (servers.length === 0) return 'Nothing to keep watch over yet.';
  if (watching === 0) return 'No vards lit yet. Set one up and it starts watching.';
  return `${watching} ${watching === 1 ? 'vard' : 'vards'} watching.`;
}

function Card({ server }: { server: ServerCard }) {
  return (
    <div className="bg-panel rounded-panel flex flex-wrap items-center gap-x-5 gap-y-4 p-5">
      <Beacon
        light={server.light}
        className="h-16 w-10 shrink-0"
        label={LABEL[server.light]}
        height={0.9}
      />

      <div className="min-w-0 flex-1 basis-40">
        <div className="flex items-center gap-3">
          {server.icon ? (
            // Discord's own guild icon, as content.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={server.icon}
              alt=""
              width={28}
              height={28}
              className="size-7 shrink-0 rounded-full"
            />
          ) : (
            <span aria-hidden className="bg-raised size-7 shrink-0 rounded-full" />
          )}
          <p className="text-ink truncate text-[24px] font-medium leading-tight">{server.name}</p>
        </div>
        <p className="text-ui text-ink-soft mt-1.5">{server.line}</p>
      </div>

      {/* On a phone the action takes its own line, full width, rather than
          squeezing the name into three characters. */}
      <div className="shrink-0 max-sm:w-full">
        {server.claimed ? (
          <ButtonLink
            href={`/g/${server.guildId}/overview`}
            className="max-sm:w-full max-sm:justify-center"
          >
            Open
          </ButtonLink>
        ) : (
          <ClaimButton guildId={server.guildId} />
        )}
      </div>
    </div>
  );
}

const LABEL: Record<Light, string> = {
  off: 'Not set up',
  amber: 'Watching',
  working: 'Working now',
  green: 'Answered recently',
};

/** The rest of Discord, behind one line. */
function Others({ others }: { others: { guildId: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-ui text-star/60 hover:text-star underline underline-offset-4"
      >
        {others.length} other {others.length === 1 ? 'server' : 'servers'} you&apos;re a member of
      </button>
      {open && (
        <ul className={cx('mt-4 space-y-2')}>
          {others.map((o) => (
            <li key={o.guildId} className="text-ui text-star/70">
              {o.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Shell({
  signedIn = true,
  children,
}: {
  signedIn?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Surface surface="night" theme="dark" className="relative min-h-screen overflow-hidden">
      <NightSky />
      <div className="relative">
        <TopBar signedIn={signedIn} />
        <main className="max-w-page mx-auto px-6 pb-24 pt-10">{children}</main>
      </div>
    </Surface>
  );
}

/** Signed out: one sentence and the way in, on the same headland. */
export function SignedOut({ notice }: { notice?: string }) {
  return (
    <Shell signedIn={false}>
      <Head lede="Sign in with Discord to see the servers you can set up." />
      {notice && <p className="text-body text-star/80 mt-6">{notice}</p>}
      <div className="mt-8">
        <ButtonLink href="/auth/login">Sign in with Discord</ButtonLink>
      </div>
    </Shell>
  );
}

function Head({ lede }: { lede: string }) {
  return (
    <>
      <h1 className="display text-star" style={{ ['--display-size' as string]: '48px' }}>
        Your servers
      </h1>
      <p className="text-body text-star/70 mt-3 max-w-[64ch]">{lede}</p>
    </>
  );
}
