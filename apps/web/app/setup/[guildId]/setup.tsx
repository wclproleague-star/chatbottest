'use client';

// Setting a bot up, as one page with four moments.
//
// 1. Night. The beacon centred, its slit dark: nothing has been decided.
// 2. Paper. The conversation on the left, and on the right the beacon is the
//    card: each thing decided lights one fifth of the slit in amber, with the
//    value beside it in words.
// 3. The test chat, slit full amber: it is configured and answering.
// 4. Night again, the beacon large, the slit turning green: it is live.
//
// One decision on screen at a time, a thin bar along the top, and no dashboard
// chrome: this is the one place in the product that is not the dashboard.

import { Button, ButtonLink, Field, Input, Panel, Textarea, cx } from '@kalvard/ui';
import type { DraftConfig } from '@kalvard/core';
import { useActionState, useEffect, useRef, useState } from 'react';
import { Beacon } from '@/components/beacon/beacon';
import { Live, NightScene } from './night-scene';
import { Travel } from './travel';
import { TestChat } from '@/app/g/[guildId]/test/test-chat';
import {
  applyDraft,
  botArrived,
  finishSetup,
  saveDraft,
  say,
  startSession,
} from '@/app/g/[guildId]/onboarding/actions';
import type { ChatState } from '@/app/g/[guildId]/onboarding/actions';

type Step = 'entry' | 'chat' | 'form' | 'try' | 'bring' | 'finish' | 'live';
type Named = { id: string; name: string };

/** The five things setup decides, in the order it asks for them. */
const AREAS: { key: keyof DraftConfig; label: string }[] = [
  { key: 'botName', label: 'Name' },
  { key: 'personaPrompt', label: 'Voice' },
  { key: 'language', label: 'Language' },
  { key: 'knowledge', label: 'Knowledge' },
  { key: 'scope', label: 'Scope' },
];

export function Setup({
  guildId,
  guildName,
  installed,
  completed,
  inviteUrl,
  channels,
  roles,
  preview = false,
  startAt,
}: {
  guildId: string;
  guildName: string;
  installed: boolean;
  completed: boolean;
  inviteUrl: string;
  channels: Named[];
  roles: Named[];
  /** The design preview: no session, a stub conversation. */
  preview?: boolean;
  startAt?: Step;
}) {
  const [step, setStep] = useState<Step>(startAt ?? (installed && !completed ? 'finish' : 'entry'));
  const [sessionId, setSessionId] = useState('');
  const [config, setConfig] = useState<DraftConfig>(preview ? PREVIEW_CONFIG : {});
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  // The scene-to-console move, and where on the console the beacon lands.
  const [travel, setTravel] = useState<'in' | 'out' | null>(null);
  const slot = useRef<HTMLDivElement>(null);
  const [slotBox, setSlotBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const done = AREAS.filter((area) => filled(config, area.key)).length;
  const night = step === 'entry' || step === 'live';

  async function begin(mode: 'chat' | 'form') {
    if (preview) {
      setSessionId('preview');
      setStep(mode);
      startTravel('in');
      return;
    }
    const started = await startSession(guildId, mode);
    if ('error' in started) {
      setError(started.error);
      return;
    }
    setSessionId(started.sessionId);
    setStep(mode);
    startTravel('in');
  }

  /**
   * The console is put on screen first and the scene is laid over it, so what
   * the beacon travels to is a slot that exists and has been measured rather
   * than a guess at where it will end up.
   */
  function startTravel(direction: 'in' | 'out') {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    requestAnimationFrame(() => {
      const rect = slot.current?.getBoundingClientRect();
      setSlotBox(
        rect
          ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
          : {
              left: window.innerWidth / 2 - 48,
              top: window.innerHeight / 2 - 130,
              width: 96,
              height: 260,
            },
      );
      setTravel(direction);
    });
  }

  async function finishDraft(draft: DraftConfig) {
    if (preview) {
      setStep('try');
      return;
    }
    const outcome = await applyDraft(guildId, sessionId, draft);
    if ('error' in outcome) {
      setError(outcome.error);
      return;
    }
    setWarning(outcome.warning ?? null);
    setStep('try');
  }

  return (
    <main
      data-theme="dark"
      data-surface={night ? 'night' : 'paper'}
      className={cx(
        'min-h-screen transition-colors duration-700',
        night ? 'bg-night text-star' : 'bg-paper text-ink',
      )}
    >
      {/* One thin bar, and nothing else at the top. */}
      <div className={cx('h-0.5 w-full', night ? 'bg-star/10' : 'bg-ink/10')}>
        <div
          className="bg-amber h-0.5 transition-[width] duration-500"
          style={{ width: `${progressOf(step, done)}%` }}
        />
      </div>

      {step === 'entry' && (
        <NightScene light="off" label="Kalvard, unlit">
          <p className="text-body text-star/80 max-w-[40ch] text-center">
            Kalvard isn&apos;t set up yet.
          </p>
          <div className="mt-8">
            <Button onClick={() => void begin('chat')} className="bg-star text-night">
              Set it up
            </Button>
          </div>
          <button
            onClick={() => void begin('form')}
            className="text-ui text-star/60 hover:text-star mt-4 underline underline-offset-4"
          >
            Fill it in instead
          </button>
          {error && <p className="text-ui text-star/80 mt-6">{error}</p>}
        </NightScene>
      )}

      {(step === 'chat' || step === 'form') && (
        <div className="mx-auto grid max-w-[1120px] gap-16 px-6 py-16 lg:grid-cols-[1fr_320px] lg:px-12">
          <div className="min-w-0">
            <p className="text-ui-sm text-ink-soft">
              {AREAS[Math.min(done, AREAS.length - 1)]?.label} · {done} of {AREAS.length} decided ·
              nothing reaches your server until you say so
            </p>
            <div className="mt-6">
              {step === 'chat' ? (
                <Chat
                  guildId={guildId}
                  sessionId={sessionId}
                  preview={preview}
                  onConfig={setConfig}
                  onDone={(draft) => void finishDraft(draft)}
                />
              ) : (
                <Form
                  guildId={guildId}
                  sessionId={sessionId}
                  config={config}
                  preview={preview}
                  onConfig={setConfig}
                  onDone={(draft) => void finishDraft(draft)}
                />
              )}
            </div>
            <button
              className="text-ui-sm text-ink-soft hover:text-ink mt-8 underline underline-offset-4"
              onClick={() => setStep(step === 'chat' ? 'form' : 'chat')}
            >
              {step === 'chat' ? 'Fill it in instead' : 'Talk it through instead'}
            </button>
          </div>

          {/* The card is the beacon: what is decided is what is lit. */}
          <aside className="min-w-0 lg:sticky lg:top-16 lg:self-start">
            <div className="flex min-w-0 gap-6">
              <div ref={slot} className="h-[260px] w-[96px] shrink-0">
                <Beacon
                  light={done === 0 ? 'off' : 'amber'}
                  progress={done / AREAS.length}
                  className={cx('h-full w-full', travel === 'in' && 'opacity-0')}
                  label={`${done} of ${AREAS.length} decided`}
                />
              </div>
              <dl className="min-w-0 flex-1 space-y-4">
                {AREAS.map((area) => (
                  <div key={String(area.key)}>
                    <dt className="text-ui-sm text-ink-soft">{area.label}</dt>
                    <dd
                      className={cx(
                        'text-ui mt-0.5 [overflow-wrap:anywhere]',
                        filled(config, area.key) ? 'text-ink' : 'border-hairline border-b',
                      )}
                    >
                      {valueOf(config, area.key)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </aside>
        </div>
      )}

      {step === 'try' && (
        <div className="mx-auto max-w-[1120px] px-6 py-16 lg:px-12">
          <div className="flex items-start gap-6">
            <Beacon light="amber" className="h-[180px] w-[70px] shrink-0" label="Kalvard, ready" />
            <div>
              <h1 className="display text-ink" style={{ ['--display-size' as string]: '32px' }}>
                Try it
              </h1>
              <p className="text-body text-ink-soft mt-2 max-w-[52ch]">
                This is your bot, answering from what it knows. Nothing it says here touches your
                server.
              </p>
              {warning && <p className="text-ui text-ink-soft mt-3 max-w-[52ch]">{warning}</p>}
            </div>
          </div>
          <div className="mt-10">
            <TestChat guildId={guildId} botName={config.botName ?? 'Kalvard'} />
          </div>
          <div className="mt-12">
            <Button onClick={() => setStep('bring')}>Bring it to Discord</Button>
          </div>
        </div>
      )}

      {step === 'bring' && (
        <BringIt
          guildId={guildId}
          inviteUrl={inviteUrl}
          preview={preview}
          onArrived={() => setStep('finish')}
        />
      )}

      {step === 'finish' && (
        <div className="mx-auto max-w-[1120px] px-6 py-16 lg:px-12">
          <h1 className="display text-ink" style={{ ['--display-size' as string]: '32px' }}>
            Where it may answer
          </h1>
          <p className="text-body text-ink-soft mt-2 max-w-[52ch]">
            It is in {guildName}. Say where it may answer, who it wakes, and where it reports
            quietly.
          </p>
          <Finish
            guildId={guildId}
            channels={channels}
            roles={roles}
            onDone={() => {
              setStep('live');
              startTravel('out');
            }}
          />
        </div>
      )}

      {step === 'live' && travel !== 'out' && <Live guildId={guildId} guildName={guildName} />}

      {travel && (
        <Travel
          direction={travel}
          light={travel === 'in' ? (done === 0 ? 'off' : 'amber') : 'amber'}
          slot={slotBox}
          onDone={() => setTravel(null)}
        />
      )}
    </main>
  );
}

function progressOf(step: Step, done: number): number {
  if (step === 'entry') return 0;
  if (step === 'chat' || step === 'form') return 10 + (done / AREAS.length) * 50;
  if (step === 'try') return 70;
  if (step === 'bring') return 85;
  if (step === 'finish') return 95;
  return 100;
}

function filled(config: DraftConfig, key: keyof DraftConfig): boolean {
  const value = config[key];
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value && String(value).trim());
}

function valueOf(config: DraftConfig, key: keyof DraftConfig): string {
  if (key === 'knowledge') {
    const docs = config.knowledge ?? [];
    return docs.length > 0 ? docs.map((d) => d.title).join(', ') : '';
  }
  if (key === 'scope') {
    if (!config.scope) return '';
    return config.scope === 'open' ? 'Answers general questions too' : 'This server only';
  }
  const value = config[key];
  return Array.isArray(value) ? value.join(', ') : ((value as string) ?? '');
}

const PREVIEW_CONFIG: DraftConfig = {
  botName: 'Kalvard',
  personaPrompt: 'A competitive Wild Rift league. Short and exact, no small talk.',
  language: 'The language each member writes in',
};

const PREVIEW_TURNS: { role: 'user' | 'model'; text: string }[] = [
  {
    role: 'model',
    text: 'Let us set up your bot for Wild Champions League. What should it be called?',
  },
  { role: 'user', text: 'Kalvard' },
  {
    role: 'model',
    text: 'In a sentence or two: what is this server for, and how should the bot talk in it?',
  },
  { role: 'user', text: 'A competitive Wild Rift league, sixteen teams. Short and exact.' },
  {
    role: 'model',
    text: 'Paste something it should know: your rules, your schedule, anything members ask about.',
  },
];
const PREVIEW_REPLIES = ['Not yet, I will add it later'];

/** The conversation. Kalvard left with a green rule, the owner right on white. */
function Chat({
  guildId,
  sessionId,
  preview,
  onConfig,
  onDone,
}: {
  guildId: string;
  sessionId: string;
  preview?: boolean;
  onConfig: (config: DraftConfig) => void;
  onDone: (config: DraftConfig) => void;
}) {
  const [state, action, pending] = useActionState<ChatState | null, FormData>(say, null);
  const [turns, setTurns] = useState(preview ? PREVIEW_TURNS : []);
  const [draft, setDraft] = useState('');
  const opened = useRef(false);
  const seen = useRef(0);

  useEffect(() => {
    if (preview || !sessionId || opened.current) return;
    opened.current = true;
    const data = new FormData();
    data.set('guild_id', guildId);
    data.set('session_id', sessionId);
    data.set('said', '');
    action(data);
  }, [preview, sessionId, guildId, action]);

  useEffect(() => {
    if (!state || state.id === seen.current) return;
    seen.current = state.id;
    if (state.config) onConfig(state.config);
    if (state.message)
      setTurns((all) => [...all, { role: 'model' as const, text: state.message! }]);
  }, [state, onConfig]);

  function send(text: string) {
    const said = text.trim();
    if (!said || pending || preview) return;
    setTurns((all) => [...all, { role: 'user' as const, text: said }]);
    setDraft('');
    const data = new FormData();
    data.set('guild_id', guildId);
    data.set('session_id', sessionId);
    data.set('said', said);
    action(data);
  }

  const replies = preview ? PREVIEW_REPLIES : (state?.quickReplies ?? []);

  return (
    <div>
      <div className="space-y-5">
        {turns.map((turn, i) =>
          turn.role === 'model' ? (
            <p
              key={i}
              className={cx(
                'text-ink border-green max-w-full border-l-2 pl-4 lg:max-w-[60ch]',
                // The last thing Kalvard said is the question you are answering,
                // so it is the biggest thing on the screen.
                i === turns.length - 1 && !pending
                  ? 'display [--display-size:26px]'
                  : 'text-thread',
              )}
            >
              {turn.text}
            </p>
          ) : (
            <div key={i} className="flex justify-end">
              <Panel className="max-w-full shadow-none lg:max-w-[60ch]">
                <p className="text-thread text-ink">{turn.text}</p>
              </Panel>
            </div>
          ),
        )}
        {pending && <p className="text-ui text-ink-soft">Thinking</p>}
      </div>

      {replies.length > 0 && !pending && (
        <div className="mt-6 flex flex-wrap gap-2">
          {replies.map((reply) => (
            <button
              key={reply}
              onClick={() => send(reply)}
              className="text-ui border-hairline text-ink hover:bg-ink/5 h-9 rounded-full border px-4"
            >
              {reply}
            </button>
          ))}
        </div>
      )}

      {state?.done ? (
        <div className="mt-8">
          <Button onClick={() => onDone(state.config ?? {})}>Save and try it</Button>
        </div>
      ) : (
        <form
          className="mt-8 flex gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            send(draft);
          }}
        >
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Type your answer"
            aria-label="Your answer"
            className="flex-1"
          />
          <Button type="submit" disabled={pending || !draft.trim()}>
            Send
          </Button>
        </form>
      )}
    </div>
  );
}

/** The same five things, as a form. */
function Form({
  guildId,
  sessionId,
  config,
  preview,
  onConfig,
  onDone,
}: {
  guildId: string;
  sessionId: string;
  config: DraftConfig;
  preview?: boolean;
  onConfig: (config: DraftConfig) => void;
  onDone: (config: DraftConfig) => void;
}) {
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<DraftConfig>) => onConfig({ ...config, ...patch });
  const ready = Boolean(config.botName?.trim() && config.personaPrompt?.trim());

  return (
    <form
      className="max-w-[60ch] space-y-6"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        if (!preview) await saveDraft(guildId, sessionId, config);
        setSaving(false);
        onDone(config);
      }}
    >
      <Field label="What is it called?">
        <Input
          value={config.botName ?? ''}
          onChange={(e) => set({ botName: e.target.value })}
          placeholder="Kalvard"
        />
      </Field>
      <Field
        label="What is this server for, and how should it talk?"
        help="Tone only. It answers from what your server knows, whatever you write here."
      >
        <Textarea
          rows={3}
          value={config.personaPrompt ?? ''}
          onChange={(e) => set({ personaPrompt: e.target.value })}
        />
      </Field>
      <Field label="What language should it reply in?">
        <Input
          value={config.language ?? ''}
          onChange={(e) => set({ language: e.target.value })}
          placeholder="The language each member writes in"
        />
      </Field>
      <Field label="Paste something it should know" help="You can add more later.">
        <Textarea
          rows={4}
          value={config.knowledge?.[0]?.text ?? ''}
          onChange={(e) =>
            set({
              knowledge: e.target.value.trim()
                ? [
                    {
                      title: e.target.value.split('\n')[0]?.slice(0, 80) || 'What the server knows',
                      text: e.target.value,
                    },
                  ]
                : [],
            })
          }
        />
      </Field>
      <Field label="Should it answer questions that are not about this server?">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['open', 'Yes, general questions too'],
              ['server_only', 'This server only'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => set({ scope: value })}
              aria-pressed={config.scope === value}
              className={cx(
                'text-ui h-9 rounded-full border px-4',
                config.scope === value
                  ? 'border-ink bg-ink text-paper'
                  : 'border-hairline text-ink hover:bg-ink/5',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>
      <Button type="submit" disabled={!ready || saving}>
        {saving ? 'Saving' : 'Save and try it'}
      </Button>
    </form>
  );
}

function BringIt({
  guildId,
  inviteUrl,
  preview,
  onArrived,
}: {
  guildId: string;
  inviteUrl: string;
  preview?: boolean;
  onArrived: () => void;
}) {
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (!waiting || preview) return;
    let live = true;
    const timer = window.setInterval(async () => {
      if (await botArrived(guildId)) {
        if (live) onArrived();
      }
    }, 4000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [waiting, preview, guildId, onArrived]);

  const url = inviteUrl
    ? `${inviteUrl}${inviteUrl.includes('?') ? '&' : '?'}guild_id=${guildId}`
    : '';

  return (
    <div className="mx-auto max-w-[60ch] px-6 py-24">
      <h1 className="display text-ink" style={{ ['--display-size' as string]: '32px' }}>
        Bring it to Discord
      </h1>
      <p className="text-body text-ink-soft mt-2">
        Add it to your server, then come back. This page notices when it arrives.
      </p>
      <div className="mt-8">
        {url ? (
          <ButtonLink href={url} target="_blank" rel="noreferrer" onClick={() => setWaiting(true)}>
            Bring it to Discord
          </ButtonLink>
        ) : (
          <p className="text-ui text-ink">
            No invite link is configured. Set DISCORD_BOT_INVITE_URL and reload.
          </p>
        )}
      </div>
      {waiting && <p className="text-ui text-ink-soft mt-4">Waiting for it to appear</p>}
    </div>
  );
}

function Finish({
  guildId,
  channels,
  roles,
  onDone,
}: {
  guildId: string;
  channels: Named[];
  roles: Named[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(finishSetup, null);

  useEffect(() => {
    if (state?.ok) onDone();
  }, [state?.ok, onDone]);

  if (channels.length === 0 && roles.length === 0) {
    return (
      <p className="text-body text-ink-soft mt-10 max-w-[60ch]">
        Kalvard has not read your channels and roles yet. Give it a moment and reload.
      </p>
    );
  }

  return (
    <form action={action} className="mt-10 max-w-[60ch] space-y-6">
      <input type="hidden" name="guild_id" value={guildId} />
      <Field
        label="Where may it answer?"
        help="Leave all unticked and it answers wherever it is mentioned."
      >
        <div className="space-y-2">
          {channels.map((channel) => (
            <label key={channel.id} className="text-ui text-ink flex items-center gap-2">
              <input type="checkbox" name="answer_in" value={channel.id} />#{channel.name}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Who does it wake when it is not sure?">
        <select
          name="mod_role"
          defaultValue=""
          className="border-field-line text-ui text-ink bg-field h-11 w-full rounded-lg border px-3"
        >
          <option value="">Choose a role</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Where should it report quietly?"
        help="Harassment, slurs and scams are never answered in public. They go here instead."
      >
        <select
          name="mod_channel"
          defaultValue=""
          className="border-field-line text-ui text-ink bg-field h-11 w-full rounded-lg border px-3"
        >
          <option value="">Nowhere, just record it</option>
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              #{channel.name}
            </option>
          ))}
        </select>
      </Field>
      {state?.error && <p className="text-ui text-ink">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving' : 'Save changes'}
      </Button>
    </form>
  );
}
