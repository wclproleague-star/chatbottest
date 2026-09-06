'use client';

// What this server can look up, and the form that adds one.
//
// Every source shows a Try box, because the only way to know a source works is
// to ask it something and read what comes back. A source that fails its test is
// not saved: a broken one is worse than none, since Kalvard would stop saying it
// cannot look things up and start saying nothing useful instead.

import { Button, Field, Input, Panel, Section, Select } from '@kalvard/ui';
import { useActionState, useState } from 'react';
import { addSource, removeSource, trySource } from './sources';
import type { SourceState } from './sources';

type Listed = { id: string; name: string; answers: string; kind: string; address: string };

const KINDS: { kind: string; label: string; needsAddress: boolean; hint: string }[] = [
  {
    kind: 'rift_legends',
    label: 'Rift Legends (matches and rosters)',
    needsAddress: true,
    hint: 'The base address of the JSON endpoint. Use fixture:rift-legends to try it against sample data.',
  },
  { kind: 'open_meteo', label: 'The weather, anywhere', needsAddress: false, hint: '' },
  {
    kind: 'http_json',
    label: 'Any JSON address',
    needsAddress: true,
    hint: 'The full address. Put {question} in it and Kalvard fills in what was asked.',
  },
];

export function SourcesPanel({ guildId, sources }: { guildId: string; sources: Listed[] }) {
  const [state, add, adding] = useActionState<SourceState, FormData>(addSource, null);
  const [kind, setKind] = useState(KINDS[0]!.kind);
  const chosen = KINDS.find((k) => k.kind === kind) ?? KINDS[0]!;

  return (
    <Section
      heading="What it may look up"
      lede="Anything no source covers, Kalvard says it cannot look up rather than guessing."
    >
      {sources.length > 0 && (
        <Panel className="divide-hairline divide-y p-0 shadow-none">
          {sources.map((source) => (
            <SourceRow key={source.id} guildId={guildId} source={source} />
          ))}
        </Panel>
      )}

      <form action={add} className="border-hairline space-y-4 border-t pt-5">
        <input type="hidden" name="guild_id" value={guildId} />
        <Field label="What kind is it?">
          <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="What do you call it?" help="Kalvard uses your words when it explains itself.">
          <Input name="name" placeholder="the league schedule" maxLength={60} />
        </Field>
        <Field label="What can it answer?">
          <Input
            name="answers"
            placeholder="fixtures, times, results and rosters"
            maxLength={120}
          />
        </Field>
        {chosen.needsAddress && (
          <>
            <Field label="Where does it live?" help={chosen.hint}>
              <Input name="base_url" placeholder="https://api.riftlegends.gg/v1" />
            </Field>
            <Field label="Key, if it needs one" help="Stored for the bot. Never shown again.">
              <Input name="api_key" type="password" autoComplete="off" />
            </Field>
          </>
        )}
        {state?.error && <p className="text-ui text-ink">{state.error}</p>}
        {state?.ok && (
          <div>
            <p className="text-ui text-ink-soft">{state.ok}</p>
            {state.sample && (
              <pre className="text-ui-sm text-ink-soft border-hairline mt-2 max-h-40 overflow-auto whitespace-pre-wrap border-l pl-3">
                {state.sample}
              </pre>
            )}
          </div>
        )}
        <div className="flex justify-end">
          <Button type="submit" disabled={adding}>
            {adding ? 'Testing it' : 'Add and test'}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function SourceRow({ guildId, source }: { guildId: string; source: Listed }) {
  const [tried, tryIt, trying] = useActionState<SourceState, FormData>(trySource, null);
  const [removed, remove, removing] = useActionState<SourceState, FormData>(removeSource, null);
  const [open, setOpen] = useState(false);

  if (removed?.ok) {
    return (
      <div className="p-5">
        <p className="text-ui-sm text-ink-soft">{removed.ok}</p>
      </div>
    );
  }

  return (
    <div className="p-5">
      <p className="text-thread text-ink">{source.name}</p>
      <p className="text-ui-sm text-ink-soft mt-1">
        {source.answers} · {source.kind}
        {source.address && ` · ${source.address}`}
      </p>

      <div className="mt-3 flex items-center gap-4">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-ui-sm text-ink-soft hover:text-ink underline underline-offset-[3px]"
        >
          {open ? 'Hide' : 'Try it'}
        </button>
        <form action={remove}>
          <input type="hidden" name="guild_id" value={guildId} />
          <input type="hidden" name="source_id" value={source.id} />
          <button
            type="submit"
            disabled={removing}
            className="text-ui-sm text-ink-soft hover:text-ink underline underline-offset-[3px]"
          >
            {removing ? 'Removing' : 'Remove'}
          </button>
        </form>
      </div>

      {open && (
        <form action={tryIt} className="mt-3">
          <input type="hidden" name="guild_id" value={guildId} />
          <input type="hidden" name="source_id" value={source.id} />
          <div className="flex gap-3">
            <Input
              name="question"
              width="full"
              placeholder="when do we play next?"
              aria-label="Ask it"
            />
            <Button type="submit" disabled={trying}>
              {trying ? 'Asking' : 'Ask it'}
            </Button>
          </div>
          {tried?.error && <p className="text-ui-sm text-ink mt-2">{tried.error}</p>}
          {tried?.sample && (
            <pre className="text-ui-sm text-ink-soft border-hairline mt-2 max-h-40 overflow-auto whitespace-pre-wrap border-l pl-3">
              {tried.sample}
            </pre>
          )}
        </form>
      )}
    </div>
  );
}
