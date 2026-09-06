import { serviceClient } from '@kalvard/core';
import { guildIconUrl } from '@/lib/discord';
import { supabaseServer } from '@/lib/supabase/server';
import { Servers, SignedOut } from './servers';
import type { ServerCard } from './servers';
import type { Light } from '@/components/sky/beacon';

// Your servers, and what each one's vard is doing. The state on a card is
// read from what actually happened, never from a setting: green means it
// answered somebody in the last hour, and if it did not, it is not green.

const ERRORS: Record<string, string> = {
  login: "Sign-in didn't finish. Try again.",
  guilds: "Signed in, but Discord's server list didn't load. Sign in again to refresh it.",
};

const HOUR = 60 * 60 * 1000;
const WEEK = 7 * 24 * HOUR;

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
  if (!user) return <SignedOut notice={notice} />;

  const [{ data: userGuilds }, { data: memberships }] = await Promise.all([
    supabase
      .from('user_guilds')
      .select('guild_id, guild_name, guild_icon, can_manage')
      .eq('user_id', user.id)
      .order('guild_name'),
    supabase.from('guild_members').select('guild_id').eq('user_id', user.id),
  ]);

  const claimed = new Set((memberships ?? []).map((m) => m.guild_id));
  const all = userGuilds ?? [];
  const mine = all.filter((g) => g.can_manage || claimed.has(g.guild_id));
  const others = all
    .filter((g) => !g.can_manage && !claimed.has(g.guild_id))
    .map((g) => ({ guildId: g.guild_id, name: g.guild_name ?? g.guild_id }));

  const state = await stateOf(mine.filter((g) => claimed.has(g.guild_id)).map((g) => g.guild_id));

  const manageable: ServerCard[] = mine.map((g) => {
    const s = state.get(g.guild_id);
    return {
      guildId: g.guild_id,
      name: g.guild_name ?? g.guild_id,
      icon: guildIconUrl(g.guild_id, g.guild_icon, 64),
      claimed: claimed.has(g.guild_id),
      light: s?.light ?? 'off',
      line: s?.line ?? 'Not set up yet',
    };
  });

  return <Servers manageable={manageable} others={others} notice={notice} />;
}

type State = { light: Light; line: string };

/**
 * What each vard is doing, from what it has actually done. One query per
 * kind of fact across every guild at once, rather than one round trip per
 * card: this page is a list, and a list must not scale badly.
 */
async function stateOf(guildIds: string[]): Promise<Map<string, State>> {
  const out = new Map<string, State>();
  if (guildIds.length === 0) return out;

  const db = serviceClient();
  const weekAgo = new Date(Date.now() - WEEK).toISOString();

  const [{ data: guilds }, { data: answers }, { data: waiting }, { data: running }] =
    await Promise.all([
      db.from('guilds').select('guild_id, setup_completed, bot_installed').in('guild_id', guildIds),
      db
        .from('bot_events')
        .select('guild_id, created_at')
        .in('guild_id', guildIds)
        .eq('type', 'answered')
        .gte('created_at', weekAgo),
      db.from('questions').select('guild_id').in('guild_id', guildIds).eq('status', 'pending'),
      // Confirmed and not yet carried out: the bot is holding it right now.
      db.from('commands').select('guild_id').in('guild_id', guildIds).eq('status', 'planned'),
    ]);

  const week = new Map<string, number>();
  const lastAnswer = new Map<string, number>();
  for (const row of answers ?? []) {
    week.set(row.guild_id, (week.get(row.guild_id) ?? 0) + 1);
    const at = new Date(row.created_at).getTime();
    if (at > (lastAnswer.get(row.guild_id) ?? 0)) lastAnswer.set(row.guild_id, at);
  }
  const pending = new Map<string, number>();
  for (const row of waiting ?? []) pending.set(row.guild_id, (pending.get(row.guild_id) ?? 0) + 1);
  const busy = new Set((running ?? []).map((r) => r.guild_id));

  for (const g of guilds ?? []) {
    const ready = g.setup_completed && g.bot_installed;
    if (!ready) {
      out.set(g.guild_id, {
        light: 'off',
        line: g.bot_installed ? 'Set up, not finished' : 'Not set up yet',
      });
      continue;
    }
    const answered = week.get(g.guild_id) ?? 0;
    const wait = pending.get(g.guild_id) ?? 0;
    const recent = Date.now() - (lastAnswer.get(g.guild_id) ?? 0) < HOUR;
    out.set(g.guild_id, {
      light: busy.has(g.guild_id) ? 'working' : recent ? 'green' : 'amber',
      line: sentence(answered, wait, busy.has(g.guild_id)),
    });
  }
  return out;
}

/** The state again, in words, because a colour is a thing you have to be taught. */
function sentence(answered: number, waiting: number, busy: boolean): string {
  if (busy) return 'Carrying something out right now';
  const first =
    answered === 0
      ? 'Nothing asked this week'
      : `${answered} ${answered === 1 ? 'answer' : 'answers'} this week`;
  if (waiting === 0) return `${first}, nothing waiting on you`;
  return `${first}, ${waiting} waiting on you`;
}
