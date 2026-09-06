import { ButtonLink, Display, Panel, Surface, TextLink } from '@sentrybot/ui';
import { TopBar } from '@/components/dashboard/top-bar';
import { guildIconUrl } from '@/lib/discord';
import { supabaseServer } from '@/lib/supabase/server';
import { ClaimButton } from './claim-button';

// Your servers. Signed out: one sentence and the Discord sign-in. Signed in:
// the servers Discord lists for you, the ones you can manage first, each with
// "Set up" (claim) or "Open" once claimed.

const ERRORS: Record<string, string> = {
  login: "Sign-in didn't finish. Try again.",
  guilds: "Signed in, but Discord's server list didn't load. Sign in again to refresh it.",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const notice = error ? ERRORS[error] : undefined;

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <Shell signedIn={false}>
        <Title lede="Sign in with Discord to see the servers you can set up." />
        {notice && <p className="mt-6 max-w-[60ch]">{notice}</p>}
        <div className="mt-8">
          <ButtonLink href="/auth/login">Sign in with Discord</ButtonLink>
        </div>
      </Shell>
    );
  }

  const [{ data: userGuilds }, { data: memberships }] = await Promise.all([
    supabase
      .from('user_guilds')
      .select('guild_id, guild_name, guild_icon, can_manage')
      .eq('user_id', user.id)
      .order('can_manage', { ascending: false })
      .order('guild_name'),
    supabase.from('guild_members').select('guild_id').eq('user_id', user.id),
  ]);
  const mine = new Set((memberships ?? []).map((m) => m.guild_id));
  const guilds = userGuilds ?? [];

  return (
    <Shell signedIn>
      <Title lede="Servers where you can manage settings come first." />
      {notice && <p className="mt-6 max-w-[60ch]">{notice}</p>}

      {guilds.length === 0 ? (
        <p className="mt-8 max-w-[60ch]">
          No servers here yet. Join one on Discord, then{' '}
          <TextLink href="/auth/login">sign in again</TextLink>.
        </p>
      ) : (
        <Panel className="divide-hairline mt-10 divide-y p-0 px-6">
          {guilds.map((g) => {
            const icon = guildIconUrl(g.guild_id, g.guild_icon, 64);
            const claimed = mine.has(g.guild_id);
            return (
              <div key={g.guild_id} className="flex items-center gap-4 py-4">
                {icon ? (
                  // Discord's own guild icon, as content.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={icon} alt="" width={32} height={32} className="size-8 rounded-full" />
                ) : (
                  <span aria-hidden className="bg-ink/8 size-8 rounded-full" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate">{g.guild_name ?? g.guild_id}</p>
                  <p className="text-ui-sm text-ink-soft">
                    {claimed
                      ? 'Set up'
                      : g.can_manage
                        ? 'Not set up yet'
                        : "You can't manage this server"}
                  </p>
                </div>
                <div className="shrink-0">
                  {claimed ? (
                    <TextLink href={`/setup/${g.guild_id}`}>Open</TextLink>
                  ) : g.can_manage ? (
                    <ClaimButton guildId={g.guild_id} />
                  ) : null}
                </div>
              </div>
            );
          })}
        </Panel>
      )}
    </Shell>
  );
}

function Shell({ signedIn, children }: { signedIn: boolean; children: React.ReactNode }) {
  return (
    <Surface surface="paper" className="min-h-screen">
      <TopBar signedIn={signedIn} />
      <main className="max-w-page mx-auto px-6 pb-24 pt-12">{children}</main>
    </Surface>
  );
}

function Title({ lede }: { lede: string }) {
  return (
    <>
      <Display className="[--display-size:32px]">Your servers</Display>
      <p className="text-ink-soft mt-3 max-w-[60ch]">{lede}</p>
    </>
  );
}
