'use client';

// Setting a bot up, on the headland, start to finish.
//
// One scene the whole way: the cliff, the coded sky, the beacon standing
// right of centre with its shadow on the ground, and it never moves. The slit
// is the progress. Dark at the door. One fifth in amber per thing decided —
// name, voice, language, knowledge, scope — from the bottom up. Full amber
// at the test. Green when the bot is live. Nothing else on the page says how
// far along you are: the object does.
//
// Each step lives on smoked glass on the left half of the scene: the
// conversation, the form, the test chat, the finish. What has been decided
// stands on a second, smaller glass to the right of the beacon, as a card of
// facts — only the fields that exist, never a greyed-out one. On a phone the
// glass is the bottom of the screen and the beacon is behind it.

import { Field, Input, Textarea, cx } from '@kalvard/ui';
import type { DraftConfig } from '@kalvard/core';
import type { ReactNode } from 'react';
import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import { SupportChoice } from '@/components/dashboard/support-choice';
import {
  GLASS,
  GLASS_LIGHT,
  Glass,
  LiveLine,
  SCENE_BUTTON,
  SCENE_LINK,
  SetupScene,
  TO_GREEN_MS,
} from './night-scene';
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

/** The five things setup decides, in the order it asks for them: one fifth of the slit each. */
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
  const [config, setConfig] = useState<DraftConfig>(
    preview && startAt && startAt !== 'entry' ? PREVIEW_CONFIG : {},
  );
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [green, setGreen] = useState(false);
  const turnGreen = useCallback(() => setGreen(true), []);

  const done = AREAS.filter((area) => filled(config, area.key)).length;

  // The light is the state of the whole thing.
  const light = green
    ? 'green'
    : step === 'entry'
      ? 'off'
      : step === 'chat' || step === 'form'
        ? done === 0
          ? 'off'
          : 'amber'
        : 'amber';
  const progress =
    step === 'entry' ? 0 : step === 'chat' || step === 'form' ? done / AREAS.length : 1;

  async function begin(mode: 'chat' | 'form') {
    if (preview) {
      setSessionId('preview');
      setStep(mode);
      return;
    }
    const started = await startSession(guildId, mode);
    if ('error' in started) {
      setError(started.error);
      return;
    }
    setSessionId(started.sessionId);
    setStep(mode);
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

  const decided = AREAS.filter((area) => filled(config, area.key));

  return (
    <main data-theme="dark" data-surface="night" className="bg-night text-star">
      <SetupScene light={light} progress={progress} changeMs={green ? TO_GREEN_MS : undefined}>
        {/* The door: one line, one button, in the free space above the headland. */}
        {step === 'entry' && (
          <Centred>
            <p className="text-star/85 text-center text-[22px] leading-snug">
              Kalvard isn&apos;t set up yet.
            </p>
            <div className="mt-8 flex justify-center">
              <button className={SCENE_BUTTON} onClick={() => void begin('chat')}>
                Set it up
              </button>
            </div>
            {error && <p className="text-ui text-star/80 mt-6 text-center">{error}</p>}
          </Centred>
        )}

        {(step === 'chat' || step === 'form') && (
          <>
            <Glass>
              {step === 'chat' ? (
                <Chat
                  guildId={guildId}
                  sessionId={sessionId}
                  preview={preview}
                  onConfig={setConfig}
                  onDone={(draft) => void finishDraft(draft)}
                  // The form is offered once, quietly, inside the first question.
                  aside={
                    done === 0 ? (
                      <button className={SCENE_LINK} onClick={() => setStep('form')}>
                        Rather fill in a form?
                      </button>
                    ) : null
                  }
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
            </Glass>
            {decided.length > 0 && <Card config={config} areas={decided} />}
          </>
        )}

        {step === 'try' && (
          <Glass wide>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <h1 className="text-star text-[22px] leading-snug">Try it</h1>
              <p className="text-body text-star/70 mt-2 max-w-[52ch]">
                This is your bot, answering from what it knows. Nothing it says here touches your
                server.
              </p>
              {warning && <p className="text-ui text-star/70 mt-3 max-w-[52ch]">{warning}</p>}
              <div className="mt-8">
                <TestChat guildId={guildId} botName={config.botName ?? 'Kalvard'} />
              </div>
            </div>
            <div className="mt-6 flex items-center gap-6">
              <button
                className={SCENE_BUTTON}
                onClick={() => setStep(installed ? 'finish' : 'bring')}
              >
                {installed ? 'Continue' : 'Bring it to Discord'}
              </button>
              {installed && (
                <p className="text-ui-sm text-star/60">
                  Already in your server; the invite is skipped.
                </p>
              )}
            </div>
          </Glass>
        )}

        {step === 'bring' && (
          <Glass>
            <BringIt
              guildId={guildId}
              inviteUrl={inviteUrl}
              preview={preview}
              onArrived={() => setStep('finish')}
            />
          </Glass>
        )}

        {step === 'finish' && (
          <Glass wide>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <h1 className="text-star text-[22px] leading-snug">Where it may answer</h1>
              <p className="text-body text-star/70 mt-2 max-w-[52ch]">
                It is in {guildName}. Say where it may answer, who it wakes, and where it reports
                quietly.
              </p>
              <Finish
                guildId={guildId}
                channels={channels}
                roles={roles}
                onDone={() => setStep('live')}
              />
            </div>
          </Glass>
        )}

        {step === 'live' && (
          <Centred>
            <LiveLine guildName={guildName} onGreen={turnGreen}>
              <a href={`/g/${guildId}/overview`} className={cx(SCENE_BUTTON, 'fade-in')}>
                Open the dashboard
              </a>
            </LiveLine>
          </Centred>
        )}
      </SetupScene>
    </main>
  );
}

/** Text and a button, centred in the sky above the headland. */
function Centred({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-x-0 top-[18vh] mx-auto max-w-[44ch] px-6 md:top-[22vh]">
      {children}
    </div>
  );
}

/**
 * What has been decided, on glass to the right of the beacon. Only fields
 * that exist: an empty one is not a row in grey, it is not there.
 */
function Card({
  config,
  areas,
}: {
  config: DraftConfig;
  areas: { key: keyof DraftConfig; label: string }[];
}) {
  return (
    <aside
      className="text-star absolute right-[4vw] top-[8vh] hidden w-[260px] rounded-2xl p-6 lg:block"
      style={GLASS}
      aria-label="Decided so far"
    >
      <dl className="space-y-4">
        {areas.map((area) => (
          <div key={String(area.key)}>
            <dt className="text-ui-sm text-star/55">{area.label}</dt>
            <dd className="text-ui text-star mt-0.5 [overflow-wrap:anywhere]">
              {valueOf(config, area.key)}
            </dd>
          </div>
        ))}
      </dl>
    </aside>
  );
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

/** The 52px input inside the glass: transparent, a hairline that turns amber on focus, Send inside it. */
function GlassInput({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder: string;
}) {
  return (
    <form
      className="border-star/25 focus-within:border-amber flex h-[52px] items-center rounded-xl border pl-4 pr-1.5 transition-colors"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="text-star placeholder:text-star/40 h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none"
      />
      <button
        type="submit"
        disabled={disabled}
        className="bg-star text-night h-10 shrink-0 rounded-lg px-4 text-[15px] font-medium transition-[filter,transform] hover:brightness-[1.06] active:scale-[0.98] disabled:opacity-40"
      >
        Send
      </button>
    </form>
  );
}

/** The conversation: Kalvard's question at 22px with the green rule, the owner's answers as smaller bubbles on lighter glass. */
function Chat({
  guildId,
  sessionId,
  preview,
  onConfig,
  onDone,
  aside,
}: {
  guildId: string;
  sessionId: string;
  preview?: boolean;
  onConfig: (config: DraftConfig) => void;
  onDone: (config: DraftConfig) => void;
  aside?: ReactNode;
}) {
  const [state, action, pending] = useActionState<ChatState | null, FormData>(say, null);
  const [turns, setTurns] = useState(preview ? PREVIEW_TURNS : []);
  const [draft, setDraft] = useState('');
  const opened = useRef(false);
  const seen = useRef(0);
  const end = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [turns.length, pending]);

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
    <>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
        {turns.map((turn, i) =>
          turn.role === 'model' ? (
            <p
              key={i}
              className={cx(
                'text-star border-green border-l-2 pl-4',
                // The last thing Kalvard said is the question you are answering.
                i === turns.length - 1 && !pending
                  ? 'text-[22px] leading-snug'
                  : 'text-thread text-star/70',
              )}
            >
              {turn.text}
            </p>
          ) : (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] rounded-xl px-4 py-2.5" style={GLASS_LIGHT}>
                <p className="text-thread text-star">{turn.text}</p>
              </div>
            </div>
          ),
        )}
        {pending && <p className="text-ui text-star/55">Thinking</p>}
        {replies.length > 0 && !pending && (
          <div className="flex flex-wrap gap-2">
            {replies.map((reply) => (
              <button
                key={reply}
                onClick={() => send(reply)}
                className="text-ui border-star/25 text-star hover:bg-star/10 h-9 rounded-full border px-4 transition-colors"
              >
                {reply}
              </button>
            ))}
          </div>
        )}
        <div ref={end} />
      </div>

      <div className="mt-6">
        {state?.done ? (
          <button className={SCENE_BUTTON} onClick={() => onDone(state.config ?? {})}>
            Save and try it
          </button>
        ) : (
          <GlassInput
            value={draft}
            onChange={setDraft}
            onSubmit={() => send(draft)}
            disabled={pending || !draft.trim()}
            placeholder="Your answer"
          />
        )}
        {aside && <div className="mt-4">{aside}</div>}
      </div>
    </>
  );
}

/** The same five things, as a form, on the glass. */
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
      className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1"
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
                'text-ui h-9 rounded-full border px-4 transition-colors',
                config.scope === value
                  ? 'border-star bg-star text-night'
                  : 'border-star/25 text-star hover:bg-star/10',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>
      <div className="pt-2">
        <button type="submit" className={SCENE_BUTTON} disabled={!ready || saving}>
          {saving ? 'Saving' : 'Save and try it'}
        </button>
      </div>
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
    <div>
      <h1 className="text-star text-[22px] leading-snug">Bring it to Discord</h1>
      <p className="text-body text-star/70 mt-2">
        Add it to your server, then come back. This page notices when it arrives.
      </p>
      <div className="mt-8">
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            onClick={() => setWaiting(true)}
            className={SCENE_BUTTON}
          >
            Bring it to Discord
          </a>
        ) : (
          <p className="text-ui text-star">
            No invite link is configured. Set DISCORD_BOT_INVITE_URL and reload.
          </p>
        )}
      </div>
      {waiting && <p className="text-ui text-star/60 mt-4">Waiting for it to appear</p>}
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
      <p className="text-body text-star/70 mt-10 max-w-[60ch]">
        Kalvard has not read your channels and roles yet. Give it a moment and reload.
      </p>
    );
  }

  const select =
    'border-star/25 text-star h-11 w-full rounded-lg border bg-transparent px-3 text-ui focus:border-amber outline-none';

  return (
    <>
      <form action={action} className="mt-8 space-y-6">
        <input type="hidden" name="guild_id" value={guildId} />
        <Field
          label="Where may it answer?"
          help="Leave all unticked and it answers wherever it is mentioned."
        >
          <div className="space-y-2">
            {channels.map((channel) => (
              <label key={channel.id} className="text-ui text-star flex items-center gap-2">
                <input type="checkbox" name="answer_in" value={channel.id} />#{channel.name}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Who does it wake when it is not sure?">
          <select name="mod_role" defaultValue="" className={select}>
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
          <select name="mod_channel" defaultValue="" className={select}>
            <option value="">Nowhere, just record it</option>
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                #{channel.name}
              </option>
            ))}
          </select>
        </Field>
        {state?.error && <p className="text-ui text-star">{state.error}</p>}
        <button type="submit" className={SCENE_BUTTON} disabled={pending}>
          {pending ? 'Saving' : 'Save changes'}
        </button>
      </form>
      <div className="mt-12">
        <h2 className="text-star text-[22px] leading-snug">Where members get help</h2>
        <p className="text-body text-star/70 mt-2">
          One of three. Kalvard asks what it needs, one thing at a time, shows the plan, and creates
          nothing until you say yes. You can change it later in Settings.
        </p>
        <div className="mt-6">
          <SupportChoice guildId={guildId} current={null} currentChannel={null} />
        </div>
      </div>
    </>
  );
}
