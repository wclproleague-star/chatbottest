'use client';

// Where it answers, who it wakes, what it may look up, what it may spend, and
// the danger zone. Two of these can be got wrong quietly, so both are said in
// words rather than left to a toggle: what happens when it is not sure, and
// whether it answers anything outside this server at all.

import { Button, Field, Input, Panel, Textarea } from '@sentrybot/ui';
import { useActionState } from 'react';
import { deleteEverything, removeBot, saveGuildSettings } from './actions';
import { SourcesPanel } from './sources-panel';
import type { SettingsState } from './actions';

type Named = { id: string; name: string };

export function SettingsForm({
  guildId,
  guildName,
  basedOn,
  channels,
  roles,
  values,
  sources,
  issues,
}: {
  guildId: string;
  guildName: string;
  basedOn: string | null;
  channels: Named[];
  roles: Named[];
  values: {
    allowedChannelIds: string[];
    modRoleId: string;
    modChannelId: string;
    introChannelId: string;
    introMessage: string;
    fallbackMode: string;
    scope: string;
    timezone: string;
    memberBurst: number;
    monthlyAnswers: number;
  };
  sources: { id: string; name: string; answers: string; kind: string; address: string }[];
  issues: { setting: string; id: string }[];
}) {
  const [state, act, pending] = useActionState<SettingsState, FormData>(saveGuildSettings, null);

  return (
    <div className="mt-10 max-w-[880px]">
      {issues.length > 0 && (
        <Panel className="border-amber mb-10 max-w-[60ch] border-l-2 shadow-none">
          <p className="text-thread text-ink">
            Some of these point at something that no longer exists in Discord.
          </p>
          <ul className="text-ui-sm text-ink-soft mt-2 space-y-1">
            {issues.map((issue) => (
              <li key={`${issue.setting}-${issue.id}`}>
                {issue.setting.replace(/_/g, ' ')} · {issue.id}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <form action={act} className="max-w-[60ch] space-y-6">
        <input type="hidden" name="guild_id" value={guildId} />
        <input type="hidden" name="based_on" value={basedOn ?? ''} />

        <Field
          label="Where may it answer?"
          help="Leave all unticked and it answers anywhere it is mentioned."
        >
          {channels.length === 0 ? (
            <p className="text-ui-sm text-ink-soft">
              Sentry has not read your channels yet. Add it to the server first.
            </p>
          ) : (
            <div className="space-y-2">
              {channels.map((c) => (
                <label key={c.id} className="text-ui text-ink flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="allowed_channel_ids"
                    value={c.id}
                    defaultChecked={values.allowedChannelIds.includes(c.id)}
                  />
                  #{c.name}
                </label>
              ))}
            </div>
          )}
        </Field>

        <Field label="Who does it wake when it is not sure?">
          <select
            name="mod_role_id"
            defaultValue={values.modRoleId}
            className="border-hairline text-ui text-ink bg-panel h-11 w-full rounded-lg border px-3"
          >
            <option value="">Nobody</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="How should it wake them?">
          <select
            name="fallback_mode"
            defaultValue={values.fallbackMode}
            className="border-hairline text-ui text-ink bg-panel h-11 w-full rounded-lg border px-3"
          >
            <option value="ping_role">Mention the role in the channel</option>
            <option value="quiet_queue">Say nothing, just wait in the inbox</option>
          </select>
        </Field>

        <Field
          label="Where should it report quietly?"
          help="Harassment, slurs and scams are never answered in public. They go here."
        >
          <select
            name="mod_channel_id"
            defaultValue={values.modChannelId}
            className="border-hairline text-ui text-ink bg-panel h-11 w-full rounded-lg border px-3"
          >
            <option value="">Nowhere, just record it</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="May it answer things that are not about this server?">
          <select
            name="scope"
            defaultValue={values.scope}
            className="border-hairline text-ui text-ink bg-panel h-11 w-full rounded-lg border px-3"
          >
            <option value="open">Yes, general questions too</option>
            <option value="server_only">No, this server only</option>
          </select>
        </Field>

        <Field
          label="What time is it where the server lives?"
          help="An IANA name, such as Europe/Paris."
        >
          <Input name="timezone" defaultValue={values.timezone} placeholder="Europe/Paris" />
        </Field>

        <Field label="Where should it introduce itself?">
          <select
            name="intro_channel_id"
            defaultValue={values.introChannelId}
            className="border-hairline text-ui text-ink bg-panel h-11 w-full rounded-lg border px-3"
          >
            <option value="">Nowhere</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="What should it say when it arrives?">
          <Textarea name="intro_message" rows={3} defaultValue={values.introMessage} />
        </Field>

        <Field
          label="How many messages may one member send in half a minute?"
          help="Past this it goes quiet for them, and only for them."
        >
          <Input
            name="member_burst"
            type="number"
            min={2}
            max={60}
            defaultValue={values.memberBurst}
          />
        </Field>

        <Field label="How many questions may it answer a month?">
          <Input
            name="monthly_answers"
            type="number"
            min={50}
            max={100000}
            step={50}
            defaultValue={values.monthlyAnswers}
          />
        </Field>

        {state?.error && <p className="text-ui text-ink">{state.error}</p>}
        {state?.ok && !state.error && <p className="text-ui text-ink-soft">{state.ok}</p>}
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving' : 'Save changes'}
        </Button>
      </form>

      <SourcesPanel guildId={guildId} sources={sources} />

      <DangerZone guildId={guildId} guildName={guildName} />
    </div>
  );
}

function DangerZone({ guildId, guildName }: { guildId: string; guildName: string }) {
  const [removeState, remove, removing] = useActionState<SettingsState, FormData>(removeBot, null);
  const [deleteState, wipe, deleting] = useActionState<SettingsState, FormData>(
    deleteEverything,
    null,
  );

  return (
    <section className="mt-16 max-w-[60ch]">
      <h2 className="text-ui-sm text-ink-soft">Danger zone</h2>

      <form action={remove} className="mt-4">
        <input type="hidden" name="guild_id" value={guildId} />
        <p className="text-body text-ink">
          Stop it answering, and keep everything. Your knowledge waits thirty days.
        </p>
        <div className="mt-3 flex gap-3">
          <Input name="confirm" placeholder="Type remove" aria-label="Type remove to confirm" />
          <Button type="submit" disabled={removing}>
            {removing ? 'Removing' : 'Remove bot'}
          </Button>
        </div>
        {removeState?.error && <p className="text-ui text-ink mt-2">{removeState.error}</p>}
        {removeState?.ok && <p className="text-ui text-ink-soft mt-2">{removeState.ok}</p>}
      </form>

      <form action={wipe} className="mt-10">
        <input type="hidden" name="guild_id" value={guildId} />
        <input type="hidden" name="guild_name" value={guildName} />
        <p className="text-body text-ink">
          Delete everything: the knowledge, the questions, the settings. This cannot be undone.
        </p>
        <div className="mt-3 flex gap-3">
          <Input
            name="confirm"
            placeholder={`Type ${guildName}`}
            aria-label={`Type ${guildName} to confirm`}
          />
          <Button type="submit" disabled={deleting}>
            {deleting ? 'Deleting' : 'Delete all data'}
          </Button>
        </div>
        {deleteState?.error && <p className="text-ui text-ink mt-2">{deleteState.error}</p>}
      </form>
    </section>
  );
}
