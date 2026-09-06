import { serviceClient } from '@kalvard/core';
import { Section, Split } from '@kalvard/ui';
import { PageTitle } from '@/components/dashboard/page-title';
import { formatDate } from '@/lib/format';
import { requireMember } from '@/lib/guild';
import { Commands } from './commands-form';

// Command mode: say what you want, read the plan, decide. Underneath it, what
// has been asked for before and what came of it, because a command that
// changed the server has to be answerable for afterwards.

/** One example per action a server has switched on, so nobody starts at a blank box. */
const EXAMPLES: Record<string, string> = {
  create_channel: 'crée un channel #finale-wcl dans la catégorie Matchs',
  allow_roles: 'donne accès à #finale-wcl aux rôles Joueur et Caster',
  set_private: 'passe #finale-wcl en privé',
  post_message: 'poste dans #annonces que le check-in ouvre à 17h',
  pin_message: 'épingle le dernier message de #annonces',
  assign_role: 'donne le rôle Joueur à tous ceux du roster Fast Forward',
  archive_channel: 'archive #finale-wcl',
};

const FALLBACK = [
  'crée un channel #finale-wcl et mets les rôles Joueur et Caster dedans',
  'poste dans #annonces que le check-in ouvre à 17h',
  'archive #vieux-matchs',
  'épingle le règlement dans #général',
];

export default async function Page({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  await requireMember(guildId);
  const db = serviceClient();

  const [{ data: history }, { data: settings }] = await Promise.all([
    db
      .from('commands')
      .select('id, request, asked_by_name, status, plan, ran, created_at')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false })
      .limit(20),
    db.from('guild_settings').select('allowed_actions').eq('guild_id', guildId).maybeSingle(),
  ]);

  const allowed = (settings?.allowed_actions ?? []) as string[];
  const examples = allowed
    .map((action) => EXAMPLES[action])
    .filter((line): line is string => Boolean(line));
  const shown = [...examples, ...FALLBACK].slice(0, 4);

  return (
    <div>
      <PageTitle
        title="Commands"
        lede="Tell Kalvard what to change. It shows you the plan first, and nothing happens until you confirm."
      />
      <div className="mt-10">
        <Split
          left={<Commands guildId={guildId} examples={shown} />}
          right={
            <Section heading="What has been asked for" lede="Every command, and what came of it.">
              {(history ?? []).length === 0 && (
                <p className="text-ink-faint text-[13px]">
                  Nothing yet. What you confirm here is written down, so a change to the server can
                  always be answered for.
                </p>
              )}
              {(history ?? []).length > 0 && (
                <ul className="divide-hairline -my-4 divide-y">
                  {(history ?? []).map((row) => {
                    const ran = (row.ran ?? []) as { ok: boolean; detail: string }[];
                    const planned = (row.plan ?? []) as { sentence: string }[];
                    const lines: string[] =
                      ran.length > 0
                        ? ran.map((step) => (step.ok ? step.detail : `stopped: ${step.detail}`))
                        : planned.map((step) => step.sentence);
                    const steps = lines.length;
                    return (
                      <li key={row.id} className="py-4">
                        <p className="text-ui text-ink">{row.request}</p>
                        <p className="text-ink-faint mt-1 text-[13px]">
                          {outcome(row.status, ran.length > 0)} · {steps}{' '}
                          {steps === 1 ? 'step' : 'steps'} · {row.asked_by_name ?? 'somebody'} ·{' '}
                          {formatDate(row.created_at)}
                        </p>
                        <ul className="text-ink-faint mt-2 space-y-1 text-[13px]">
                          {lines.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          }
        />
      </div>
    </div>
  );
}

/** What became of it, in one word rather than a status name. */
function outcome(status: string, hasRun: boolean): string {
  if (hasRun) return 'Ran';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'planned') return 'Waiting on the bot';
  return 'Not run';
}
