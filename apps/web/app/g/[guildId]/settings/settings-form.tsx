'use client';

// Where it answers, who it wakes, and what it may look up: three subjects,
// three panels, each saving on its own. Two of these can be got wrong quietly,
// so both are said in words rather than left to a toggle: what happens when it
// is not sure, and whether it answers anything outside this server at all.
//
// Settings has no single thing it is about, so nothing here is enlarged to
// pretend otherwise: the panel titles carry the page at 20px and every field
// label recedes to 13px, which is the right way round — a question should
// never compete with its answer.
//
// The two columns are filled to end at about the same place, and nothing
// full-width follows them: a band across the bottom would undo the column the
// eye has just learned. The danger zone never gets a Save that appears on its
// own; both of those are typed out in full first.
//
// Channels and roles are chips rather than a column of ticks. A server's
// channels are objects people already recognise, and picking three of twenty
// should be a glance, not a scan.

import {
  Button,
  Chip,
  Chips,
  Field,
  FormSection,
  Group,
  Input,
  Option,
  Panel,
  Section,
  Select,
  Split,
  Textarea,
} from '@kalvard/ui';
import { useActionState, useState } from 'react';
import { deleteEverything, removeBot, saveGuildSettings } from './actions';
import { SourcesPanel } from './sources-panel';
import type { SettingsState } from './actions';

type Named = { id: string; name: string };

type Values = {
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
  values: Values;
  sources: { id: string; name: string; answers: string; kind: string; address: string }[];
  issues: { setting: string; id: string }[];
}) {
  const [state, act, pending] = useActionState<SettingsState, FormData>(saveGuildSettings, null);
  const [allowed, setAllowed] = useState<string[]>(values.allowedChannelIds);

  const note = state?.error ? (
    <p className="text-ui text-ink mr-auto">{state.error}</p>
  ) : state?.ok ? (
    <p className="text-ui text-ink-soft mr-auto">{state.ok}</p>
  ) : null;

  return (
    <div className="mt-10">
      {issues.length > 0 && (
        <Panel className="border-amber mb-6 border-l-2 shadow-none">
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

      <Split
        left={
          <>
            <FormSection
              heading="Where it answers"
              action={act}
              pending={pending}
              note={note}
              changed={allowed.join(',') !== values.allowedChannelIds.join(',')}
            >
              <Hidden guildId={guildId} basedOn={basedOn} />
              {/* Every panel posts the whole form, so a save from one never blanks
                what somebody set on another. */}
              <Elsewhere values={values} panel="where" />

              <Group heading="Channels">
                <Field
                  label="Which channels?"
                  help="Pick none and it answers anywhere it is mentioned."
                >
                  {channels.length === 0 ? (
                    <Empty>
                      Kalvard has not read your channels yet. Add it to the server first.
                    </Empty>
                  ) : (
                    <Chips>
                      {channels.map((c) => (
                        <Chip
                          key={c.id}
                          name="allowed_channel_ids"
                          value={c.id}
                          label={c.name}
                          prefix="#"
                          on={allowed.includes(c.id)}
                          onToggle={() =>
                            setAllowed((now) =>
                              now.includes(c.id) ? now.filter((id) => id !== c.id) : [...now, c.id],
                            )
                          }
                        />
                      ))}
                    </Chips>
                  )}
                </Field>
              </Group>

              <Group heading="Scope">
                <Field label="May it answer things that are not about this server?">
                  <Select name="scope" defaultValue={values.scope}>
                    <Option value="open">Yes, general questions too</Option>
                    <Option value="server_only">No, this server only</Option>
                  </Select>
                </Field>

                <Field
                  label="What time is it where the server lives?"
                  help="An IANA name, such as Europe/Paris."
                >
                  <Input
                    name="timezone"
                    defaultValue={values.timezone}
                    placeholder="Europe/Paris"
                  />
                </Field>
              </Group>

              <Group heading="Introduction">
                <Field label="Where should it introduce itself?">
                  <Select name="intro_channel_id" defaultValue={values.introChannelId || 'none'}>
                    <Option value="none">Nowhere</Option>
                    {channels.map((c) => (
                      <Option key={c.id} value={c.id}>
                        #{c.name}
                      </Option>
                    ))}
                  </Select>
                </Field>

                <Field label="What should it say when it arrives?">
                  <Textarea name="intro_message" rows={3} defaultValue={values.introMessage} />
                </Field>
              </Group>
            </FormSection>

            <FormSection heading="Who it wakes" action={act} pending={pending} note={note}>
              <Hidden guildId={guildId} basedOn={basedOn} />
              <Elsewhere values={values} panel="who" allowed={allowed} />

              <Field label="Who does it wake when it is not sure?">
                <Select name="mod_role_id" defaultValue={values.modRoleId || 'none'}>
                  <Option value="none">Nobody</Option>
                  {roles.map((r) => (
                    <Option key={r.id} value={r.id}>
                      {r.name}
                    </Option>
                  ))}
                </Select>
              </Field>

              <Field label="How should it wake them?">
                <Select name="fallback_mode" defaultValue={values.fallbackMode}>
                  <Option value="ping_role">Mention the role in the channel</Option>
                  <Option value="quiet_queue">Say nothing, just wait in the inbox</Option>
                </Select>
              </Field>

              <Field
                label="Where should it report quietly?"
                help="Harassment, slurs and scams are never answered in public. They go here."
              >
                <Select name="mod_channel_id" defaultValue={values.modChannelId || 'none'}>
                  <Option value="none">Nowhere, just record it</Option>
                  {channels.map((c) => (
                    <Option key={c.id} value={c.id}>
                      #{c.name}
                    </Option>
                  ))}
                </Select>
              </Field>
            </FormSection>

            <DangerZone guildId={guildId} guildName={guildName} />
          </>
        }
        right={
          <>
            <FormSection heading="What it may spend" action={act} pending={pending} note={note}>
              <Hidden guildId={guildId} basedOn={basedOn} />
              <Elsewhere values={values} panel="spend" allowed={allowed} />

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

            <SourcesPanel guildId={guildId} sources={sources} />
          </>
        }
      />
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-ui-sm text-ink-soft">{children}</p>;
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
 * The select menus post "none" for an empty choice, since a Radix select has no
 * empty value; the action reads that back as nothing.
 */
function Elsewhere({
  values,
  panel,
  allowed,
}: {
  values: Values;
  panel: 'where' | 'who' | 'spend';
  allowed?: string[];
}) {
  const channels = (allowed ?? values.allowedChannelIds).map((id) => (
    <input key={id} type="hidden" name="allowed_channel_ids" value={id} />
  ));
  const who = (
    <>
      <input type="hidden" name="mod_role_id" value={values.modRoleId} />
      <input type="hidden" name="mod_channel_id" value={values.modChannelId} />
      <input type="hidden" name="fallback_mode" value={values.fallbackMode} />
    </>
  );
  const where = (
    <>
      <input type="hidden" name="scope" value={values.scope} />
      <input type="hidden" name="timezone" value={values.timezone} />
      <input type="hidden" name="intro_channel_id" value={values.introChannelId} />
      <input type="hidden" name="intro_message" value={values.introMessage} />
    </>
  );
  const spend = (
    <>
      <input type="hidden" name="member_burst" value={values.memberBurst} />
      <input type="hidden" name="monthly_answers" value={values.monthlyAnswers} />
    </>
  );

  if (panel === 'where')
    return (
      <>
        {who}
        {spend}
      </>
    );
  if (panel === 'who')
    return (
      <>
        {channels}
        {where}
        {spend}
      </>
    );
  return (
    <>
      {channels}
      {where}
      {who}
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
          <Button type="submit" variant="secondary" disabled={removing}>
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
          <Button type="submit" variant="secondary" disabled={deleting}>
            {deleting ? 'Deleting' : 'Delete all data'}
          </Button>
        </div>
        {deleteState?.error && <p className="text-ui text-ink mt-2">{deleteState.error}</p>}
      </form>
    </Section>
  );
}
