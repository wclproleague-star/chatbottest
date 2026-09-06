'use client';

// Workflows: the routines this server runs.
//
// Writing one is describing it. The box takes plain language, what comes back
// is either the flow read out in sentences or the one question standing in the
// way, and nothing is stored until somebody has read it and said yes. The
// structured form exists behind a toggle for anyone who wants it; it is never
// what an owner is asked to check.

import { Button, GrowingInput, Panel, Section, Split, Switch } from '@kalvard/ui';
import { useActionState, useState } from 'react';
import { adoptTemplate, describeWorkflow, keepWorkflow, rehearse, toggleWorkflow } from './actions';
import type { DraftState } from './actions';

export type Listed = {
  id: string;
  name: string;
  trigger: string;
  steps: number;
  enabled: boolean;
  readBack: string[];
};

export type Run = {
  id: string;
  name: string;
  mode: 'live' | 'dry_run';
  status: string;
  when: string;
  lines: string[];
  stoppedBecause: string | null;
};

export function Workflows({
  guildId,
  workflows,
  runs,
  templates,
  noticed,
}: {
  guildId: string;
  workflows: Listed[];
  runs: Run[];
  /** A routine this server already keeps by hand, when there is one. */
  noticed?: string | null;
  /** The shipped routines this server has not taken yet. */
  templates: { name: string; what: string; steps: number }[];
}) {
  return (
    <div className="mt-10">
      <Split
        left={
          <>
            {noticed && (
              <Panel className="border-amber border-l-2 shadow-none">
                <p className="text-thread text-ink">{noticed}</p>
                <p className="text-ink-faint mt-2 text-[13px]">
                  Describe it below in your own words and Kalvard will read it back. Nothing is
                  created until you say so.
                </p>
              </Panel>
            )}
            <Write guildId={guildId} />
            <Kept guildId={guildId} workflows={workflows} />
          </>
        }
        right={
          <>
            {templates.length > 0 && <Adopt guildId={guildId} templates={templates} />}
            <Runs runs={runs} />
          </>
        }
      />
    </div>
  );
}

function Write({ guildId }: { guildId: string }) {
  const [draft, describe, thinking] = useActionState<DraftState, FormData>(describeWorkflow, null);
  const [kept, keep, keeping] = useActionState<DraftState, FormData>(keepWorkflow, null);
  const [description, setDescription] = useState('');
  const [details, setDetails] = useState(false);

  return (
    <Section
      heading="Describe a routine"
      lede="In your own words. Kalvard asks about anything it would otherwise have to guess."
    >
      <form action={describe}>
        <input type="hidden" name="guild_id" value={guildId} />
        <GrowingInput
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="On match day, announce both matches, ask each captain to confirm, flip a coin for sides, then wait for a screenshot after each game."
          aria-label="What does the routine do?"
        />
        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={thinking || !description.trim()}>
            {thinking ? 'Working it out' : 'Read it back'}
          </Button>
        </div>
      </form>

      {draft?.kind === 'error' && <p className="text-ui text-ink">{draft.error}</p>}
      {draft?.kind === 'refused' && <p className="text-ui text-ink">{draft.because}</p>}

      {draft?.kind === 'question' && (
        <div className="border-amber border-l-2 pl-4">
          <p className="text-ink-faint text-[13px]">{draft.because}</p>
          <p className="text-ui text-ink mt-1">{draft.question}</p>
          <p className="text-ink-faint mt-3 text-[13px]">
            Add the answer to what you wrote, and read it back again.
          </p>
        </div>
      )}

      {draft?.kind === 'workflow' && !kept && (
        <div>
          <p className="text-ink-faint text-[13px]">
            This is what it would do. Nothing is saved yet.
          </p>
          <p className="text-ui text-ink mt-3 font-medium">{draft.workflow.name}</p>
          <ol className="text-thread text-ink mt-3 space-y-1.5">
            {draft.readBack.map((line, i) => (
              <li key={i} className="whitespace-pre-wrap">
                {line}
              </li>
            ))}
          </ol>

          <button
            type="button"
            onClick={() => setDetails((d) => !d)}
            className="text-ink-faint hover:text-ink mt-4 text-[13px] underline underline-offset-[3px]"
          >
            {details ? 'Hide details' : 'Show details'}
          </button>
          {details && (
            <pre className="text-ink-faint bg-field border-field-line mt-3 max-h-72 overflow-auto rounded-lg border p-4 text-[12px]">
              {JSON.stringify(draft.workflow, null, 2)}
            </pre>
          )}

          <form action={keep} className="mt-5 flex justify-end">
            <input type="hidden" name="guild_id" value={guildId} />
            <input type="hidden" name="workflow" value={JSON.stringify(draft.workflow)} />
            <Button type="submit" disabled={keeping}>
              {keeping ? 'Keeping' : 'Keep it'}
            </Button>
          </form>
        </div>
      )}

      {kept?.kind === 'saved' && <p className="text-ui text-ink-soft">{kept.note}</p>}
      {kept?.kind === 'error' && <p className="text-ui text-ink">{kept.error}</p>}
    </Section>
  );
}

function Kept({ guildId, workflows }: { guildId: string; workflows: Listed[] }) {
  const [tried, tryIt, trying] = useActionState<DraftState, FormData>(rehearse, null);

  return (
    <Section heading="What this server runs">
      {workflows.length === 0 ? (
        <p className="text-ink-faint text-[13px]">
          Nothing yet. Describe a routine above and Kalvard will read it back before keeping it.
        </p>
      ) : (
        <ul className="divide-hairline -my-4 divide-y">
          {workflows.map((w) => (
            <li key={w.id} className="py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-ui text-ink">{w.name}</p>
                  <p className="text-ink-faint mt-1 text-[13px]">
                    {w.trigger} · {w.steps} step{w.steps === 1 ? '' : 's'}
                  </p>
                </div>
                <Switch
                  checked={w.enabled}
                  onCheckedChange={(on) => void toggleWorkflow(guildId, w.id, on)}
                  ariaLabel={w.name}
                />
              </div>
              <ol className="text-ink-soft mt-3 space-y-1 text-[13px]">
                {w.readBack.slice(0, 4).map((line, i) => (
                  <li key={i} className="truncate whitespace-pre">
                    {line}
                  </li>
                ))}
                {w.readBack.length > 4 && (
                  <li className="text-ink-faint">and {w.readBack.length - 4} more</li>
                )}
              </ol>
              <form action={tryIt} className="mt-3">
                <input type="hidden" name="guild_id" value={guildId} />
                <input type="hidden" name="workflow_id" value={w.id} />
                <button
                  type="submit"
                  disabled={trying}
                  className="text-ui-sm text-ink-soft hover:text-ink underline underline-offset-[3px] disabled:opacity-40"
                >
                  {trying ? 'Rehearsing' : 'Rehearse it'}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {tried?.kind === 'saved' && <p className="text-ui text-ink-soft">{tried.note}</p>}
      {tried?.kind === 'error' && <p className="text-ui text-ink">{tried.error}</p>}
    </Section>
  );
}

function Adopt({
  guildId,
  templates,
}: {
  guildId: string;
  templates: { name: string; what: string; steps: number }[];
}) {
  const [taken, adopt, adopting] = useActionState<DraftState, FormData>(adoptTemplate, null);
  return (
    <Section
      heading="Or take one that exists"
      lede="A starting point, not a product. Adopt it, read it back, and change the parts that are not how you do it."
    >
      <ul className="divide-hairline -my-4 divide-y">
        {templates.map((t) => (
          <li key={t.name} className="flex items-start justify-between gap-4 py-4">
            <div className="min-w-0">
              <p className="text-ui text-ink">{t.name}</p>
              <p className="text-ink-faint mt-1 text-[13px]">
                {t.what} · {t.steps} step{t.steps === 1 ? '' : 's'}
              </p>
            </div>
            <form action={adopt}>
              <input type="hidden" name="guild_id" value={guildId} />
              <input type="hidden" name="template" value={t.name} />
              <Button type="submit" variant="secondary" disabled={adopting}>
                Adopt
              </Button>
            </form>
          </li>
        ))}
      </ul>
      {taken?.kind === 'saved' && <p className="text-ui text-ink-soft">{taken.note}</p>}
      {taken?.kind === 'error' && <p className="text-ui text-ink">{taken.error}</p>}
    </Section>
  );
}

function Runs({ runs }: { runs: Run[] }) {
  return (
    <Section heading="What has run" lede="Every run, rehearsal or real, and what it did.">
      {runs.length === 0 ? (
        <p className="text-ink-faint text-[13px]">
          Nothing has run yet. A rehearsal shows up here too, so you can read what it would have
          done.
        </p>
      ) : (
        <ul className="divide-hairline -my-4 divide-y">
          {runs.map((run) => (
            <li key={run.id} className="py-4">
              <p className="text-ui text-ink">{run.name}</p>
              <p className="text-ink-faint mt-1 text-[13px]">
                {run.mode === 'dry_run' ? 'Rehearsal' : 'Live'} · {run.status} · {run.when}
              </p>
              {run.stoppedBecause && (
                <p className="text-ui-sm text-ink border-amber mt-2 border-l-2 pl-3">
                  {run.stoppedBecause}
                </p>
              )}
              <ul className="text-ink-soft mt-2 space-y-1 text-[13px]">
                {run.lines.slice(0, 6).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
