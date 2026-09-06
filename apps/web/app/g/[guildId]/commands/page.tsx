import { serviceClient } from '@sentrybot/core';
import { Panel } from '@sentrybot/ui';
import { PageTitle } from '@/components/dashboard/page-title';
import { formatDate } from '@/lib/format';
import { requireMember } from '@/lib/guild';
import { Commands } from './commands-form';

// Command mode: say what you want, read the plan, decide. Underneath it, what
// has been asked for before and what came of it, because a command that
// changed the server has to be answerable for afterwards.

export default async function Page({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  await requireMember(guildId);
  const { data: history } = await serviceClient()
    .from('commands')
    .select('id, request, asked_by_name, status, plan, ran, created_at')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .limit(20);

  return (
    <div>
      <PageTitle
        title="Commands"
        lede="Tell Sentry what to change. It shows you the plan first, and nothing happens until you confirm."
      />
      <Commands guildId={guildId} />

      {(history ?? []).length > 0 && (
        <section className="mt-16 max-w-[60ch]">
          <h2 className="text-ui-sm text-ink-soft">What has been asked for</h2>
          <Panel className="divide-hairline mt-3 divide-y p-0">
            {(history ?? []).map((row) => {
              const ran = (row.ran ?? []) as { sentence: string; ok: boolean; detail: string }[];
              const planned = (row.plan ?? []) as { sentence: string }[];
              return (
                <div key={row.id} className="p-5">
                  <p className="text-thread text-ink">{row.request}</p>
                  <p className="text-ui-sm text-ink-soft mt-1">
                    {row.asked_by_name ?? 'somebody'} · {formatDate(row.created_at)} · {row.status}
                  </p>
                  {ran.length > 0 ? (
                    <ul className="text-ui-sm text-ink-soft mt-2 space-y-1">
                      {ran.map((step, i) => (
                        <li key={i}>
                          {step.ok ? '' : 'stopped: '}
                          {step.detail}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ul className="text-ui-sm text-ink-soft mt-2 space-y-1">
                      {planned.map((step, i) => (
                        <li key={i}>{step.sentence}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </Panel>
        </section>
      )}
    </div>
  );
}
