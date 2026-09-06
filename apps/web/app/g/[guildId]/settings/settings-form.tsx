'use client';

// Where it answers, who it wakes, and what it may look up: three subjects,
// three panels, each saving on its own. Two of these can be got wrong quietly,
// so both are said in words rather than left to a toggle: what happens when it
// is not sure, and whether it answers anything outside this server at all.
//
// The danger zone keeps its own panel at the bottom and never gets a Save that
// appears on its own: both of those are typed out in full first.

import {
  Button,
  Field,
  FormSection,
  Input,
  Panel,
  Section,
  Sections,
  Select,
  Textarea,
} from '@kalvard/ui';
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

  const note = state?.error ? (
    <p className="text-ui text-ink mr-auto">{state.error}</p>
  ) : state?.ok ? (
    <p className="text-ui text-ink-soft mr-auto">{state.ok}</p>
  ) : null;

  return (
    <div className="mt-10">
      {issues.length > 0 && (
        <Panel className="border-amber mb-8 border-l-2 shadow-none">
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

      <Sections>
        <FormSection heading="Where it answers" action={act} pending={pending} note={note}>
          <Hidden guildId={guildId} basedOn={basedOn} />
          {/* Every panel posts the whole form, so a save from one never blanks
              what somebody set on another. */}
          <Elsewhere values={values} panel="where" />

          <Field
            label="Which channels?"
            help="Leave all unticked and it answers anywhere it is mentioned."
          >
            {channels.length === 0 ? (
              <p className="text-ui-sm text-ink-soft">
                Kalvard has not read your channels yet. Add it to the server first.
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

          <Field label="May it answer things that are not about this server?">
            <Select name="scope" defaultValue={values.scope}>
              <option value="open">Yes, general questions too</option>
              <option value="server_only">No, this server only</option>
            </Select>
          </Field>

          <Field
            label="What time is it where the server lives?"
            help="An IANA name, such as Europe/Paris."
          >
            <Input name="timezone" defaultValue={values.timezone} placeholder="Europe/Paris" />
          </Field>

          <Field label="Where should it introduce itself?">
            <Select name="intro_channel_id" defaultValue={values.introChannelId}>
              <option value="">Nowhere</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </Select>
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
              width="number"
              min={2}
              max={60}
              defaultValue={values.memberBurst}
            />
          </Field>

          <Field label="How many questions may it answer a month?">
            <Input
              name="monthly_answers"
              type="number"
              width="number"
              min={50}
              max={100000}
              step={50}
              defaultValue={values.monthlyAnswers}
            />
          </Field>
        </FormSection>

        <FormSection heading="Who it wakes" action={act} pending={pending} note={note}>
          <Hidden guildId={guildId} basedOn={basedOn} />
          <Elsewhere values={values} panel="who" />

          <Field label="Who does it wake when it is not sure?">
            <Select name="mod_role_id" defaultValue={values.modRoleId}>
              <option value="">Nobody</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="How should it wake them?">
            <Select name="fallback_mode" defaultValue={values.fallbackMode}>
              <option value="ping_role">Mention the role in the channel</option>
              <option value="quiet_queue">Say nothing, just wait in the inbox</option>
            </Select>
          </Field>

          <Field
            label="Where should it report quietly?"
            help="Harassment, slurs and scams are never answered in public. They go here."
          >
            <Select name="mod_channel_id" defaultValue={values.modChannelId}>
              <option value="">Nowhere, just record it</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </Select>
          </Field>
        </FormSection>

        <SourcesPanel guildId={guildId} sources={sources} />

        <DangerZone guildId={guildId} guildName={guildName} />
      </Sections>
    </div>
  );
}

function Hidden({ guildId, basedOn }: { guildId: string; basedOn: string | null }) {
  return (
    <>
      <input type="hidden" name="guild_id" value={guildId} />
      <input type="hidden" name="based_on" value={basedOn ?? ''} />
    </>
  );
}

/**
 * The fields this panel does not show, carried along so the save writes the
 * whole settings row rather than the third of it that happens to be on screen.
 */
function Elsewhere({
  values,
  panel,
}: {
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
  panel: 'where' | 'who';
}) {
  if (panel === 'where') {
    return (
      <>
        <input type="hidden" name="mod_role_id" value={values.modRoleId} />
        <input type="hidden" name="mod_channel_id" value={values.modChannelId} />
        <input type="hidden" name="fallback_mode" value={values.fallbackMode} />
      </>
    );
  }
  return (
    <>
      {values.allowedChannelIds.map((id) => (
        <input key={id} type="hidden" name="allowed_channel_ids" value={id} />
      ))}
      <input type="hidden" name="scope" value={values.scope} />
      <input type="hidden" name="timezone" value={values.timezone} />
      <input type="hidden" name="intro_channel_id" value={values.introChannelId} />
      <input type="hidden" name="intro_message" value={values.introMessage} />
      <input type="hidden" name="member_burst" value={values.memberBurst} />
      <input type="hidden" name="monthly_answers" value={values.monthlyAnswers} />
    </>
  );
}

function DangerZone({ guildId, guildName }: { guildId: string; guildName: string }) {
  const [removeState, remove, removing] = useActionState<SettingsState, FormData>(removeBot, null);
  const [deleteState, wipe, deleting] = useActionState<SettingsState, FormData>(
    deleteEverything,
    null,
  );

  return (
    <Section heading="Danger zone">
      <form action={remove}>
        <input type="hidden" name="guild_id" value={guildId} />
        <p className="text-body text-ink">
          Stop it answering, and keep everything. Your knowledge waits thirty days.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Input name="confirm" placeholder="Type remove" aria-label="Type remove to confirm" />
          <Button type="submit" disabled={removing}>
            {removing ? 'Removing' : 'Remove bot'}
          </Button>
        </div>
        {removeState?.error && <p className="text-ui text-ink mt-2">{removeState.error}</p>}
        {removeState?.ok && <p className="text-ui text-ink-soft mt-2">{removeState.ok}</p>}
      </form>

      <form action={wipe} className="border-hairline border-t pt-5">
        <input type="hidden" name="guild_id" value={guildId} />
        <input type="hidden" name="guild_name" value={guildName} />
        <p className="text-body text-ink">
          Delete everything: the knowledge, the questions, the settings. This cannot be undone.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Input
            name="confirm"
            placeholder={'Type ' + guildName}
            aria-label={'Type ' + guildName + ' to confirm'}
          />
          <Button type="submit" disabled={deleting}>
            {deleting ? 'Deleting' : 'Delete all data'}
          </Button>
        </div>
        {deleteState?.error && <p className="text-ui text-ink mt-2">{deleteState.error}</p>}
      </form>
    </Section>
  );
}
