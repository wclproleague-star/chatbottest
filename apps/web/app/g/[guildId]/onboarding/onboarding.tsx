'use client';

// The setup, as one page with four steps: say what the bot is, try it, bring
// it to Discord, then say where it may answer.
//
// The two ways in write the same draft, so switching between them loses
// nothing. The bot card on the right fills as the draft does, which is the
// whole point of the screen: an owner sees the thing they are making.

import { BotCard, Button, ButtonLink, Field, Input, Panel, Textarea, cx } from '@kalvard/ui';
import type { DraftConfig } from '@kalvard/core';
import { useActionState, useEffect, useRef, useState } from 'react';
import { PageTitle } from '@/components/dashboard/page-title';
import { TestChat } from '../test/test-chat';
import { applyDraft, botArrived, finishSetup, saveDraft, say, startSession } from './actions';
import type { ChatState } from './actions';

const DEFAULT_FORBIDDEN = [
  'bans and appeals',
  'payments and refunds',
  'personal disputes',
  'staff-only info',
];

type Step = 'choose' | 'chat' | 'form' | 'try' | 'bring' | 'finish';
type Named = { id: string; name: string };

export function Onboarding({
  guildId,
  guildName,
  installed,
  completed,
  inviteUrl,
  channels,
  roles,
  preview = false,
}: {
  guildId: string;
  guildName: string;
  installed: boolean;
  completed: boolean;
  inviteUrl: string;
  channels: Named[];
  roles: Named[];
  /** The design preview at /dev/onboarding: no session, no server calls. */
  preview?: boolean;
}) {
  const [step, setStep] = useState<Step>(installed && !completed ? 'finish' : 'choose');
  const [sessionId, setSessionId] = useState('');
  const [config, setConfig] = useState<DraftConfig>({});
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

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
    const outcome = await applyDraft(guildId, sessionId, draft);
    if ('error' in outcome) {
      setError(outcome.error);
      return;
    }
    setWarning(outcome.warning ?? null);
    setStep('try');
  }

  return (
    <div className="max-w-[1120px]">
      <PageTitle
        title={step === 'finish' ? 'Where it may answer' : 'Set up your bot'}
        lede={
          step === 'finish'
            ? `It is in ${guildName}. Say where it may answer, who it wakes when it is not sure, and where it reports quietly.`
            : `Two ways in, the same result: tell Kalvard about ${guildName}, or fill it in yourself.`
        }
      />

      {error && (
        <p className="text-ui text-ink mb-6 max-w-[60ch]">
          {error} <button onClick={() => setError(null)}>Dismiss</button>
        </p>
      )}

      {step === 'choose' && (
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Button onClick={() => void begin('chat')}>Talk it through</Button>
          <button
            onClick={() => void begin('form')}
            className="text-ui text-ink hover:text-ink underline underline-offset-4"
          >
            Fill it in
          </button>
        </div>
      )}

      {(step === 'chat' || step === 'form') && (
        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_320px]">
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
              onConfig={setConfig}
              onDone={(draft) => void finishDraft(draft)}
            />
          )}
          <aside className="lg:sticky lg:top-10 lg:self-start">
            <BotCard values={cardValues(config)} filled />
            <button
              className="text-ui-sm text-ink-soft hover:text-ink mt-3 underline underline-offset-4"
              onClick={() => setStep(step === 'chat' ? 'form' : 'chat')}
            >
              {step === 'chat' ? 'Fill it in instead' : 'Talk it through instead'}
            </button>
          </aside>
        </div>
      )}

      {step === 'try' && (
        <div className="mt-10 max-w-[880px]">
          {warning && <p className="text-ui text-ink-soft mb-6 max-w-[60ch]">{warning}</p>}
          <p className="text-body text-ink-soft mb-6 max-w-[60ch]">
            This is your bot, answering from what it knows. Ask it what a member would.
          </p>
          <TestChat guildId={guildId} botName={config.botName ?? 'Kalvard'} />
          <div className="mt-10">
            <Button onClick={() => setStep('bring')}>Bring it to Discord</Button>
          </div>
        </div>
      )}

      {step === 'bring' && (
        <BringIt guildId={guildId} inviteUrl={inviteUrl} onArrived={() => setStep('finish')} />
      )}

      {step === 'finish' && <Finish guildId={guildId} channels={channels} roles={roles} />}
    </div>
  );
}

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
  /** The design preview: a stub conversation, so no session is needed. */
  preview?: boolean;
  onConfig: (config: DraftConfig) => void;
  onDone: (config: DraftConfig) => void;
}) {
  const [state, action, pending] = useActionState<ChatState | null, FormData>(say, null);
  const [turns, setTurns] = useState<{ role: 'user' | 'model'; text: string }[]>(
    preview ? PREVIEW_TURNS : [],
  );
  const [draft, setDraft] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const opened = useRef(false);
  const seen = useRef(0);

  // The first turn is Kalvard's, and it is asked for as soon as there is a session.
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
    if (state.message) setTurns((all) => [...all, { role: 'model', text: state.message! }]);
  }, [state, onConfig]);

  function send(text: string) {
    const said = text.trim();
    if (!said || pending || preview) return;
    setTurns((all) => [...all, { role: 'user', text: said }]);
    setDraft('');
    const data = new FormData();
    data.set('guild_id', guildId);
    data.set('session_id', sessionId);
    data.set('said', said);
    action(data);
  }

  return (
    <div>
      <div className="space-y-5">
        {turns.map((turn, i) =>
          turn.role === 'model' ? (
            <p key={i} className="text-thread text-ink border-green max-w-[60ch] border-l-2 pl-4">
              {turn.text}
            </p>
          ) : (
            <div key={i} className="flex justify-end">
              <Panel className="max-w-[60ch] shadow-none">
                <p className="text-thread text-ink">{turn.text}</p>
              </Panel>
            </div>
          ),
        )}
        {pending && <p className="text-ui text-ink-soft">Thinking</p>}
      </div>

      {(preview ? PREVIEW_REPLIES : (state?.quickReplies ?? [])).length > 0 && !pending && (
        <div className="mt-6 flex flex-wrap gap-2">
          {(preview ? PREVIEW_REPLIES : state!.quickReplies!).map((reply) => (
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
          ref={form}
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

/** What the preview shows instead of a real conversation. */
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
  {
    role: 'user',
    text: 'A competitive Wild Rift league, sixteen teams. Short and exact, no small talk.',
  },
  { role: 'model', text: 'Which of these sounds most like your server?' },
];
const PREVIEW_REPLIES = [
  'Sunday at 18:00 CET, and check-in closes an hour before.',
  'Sunday 18:00 CET. Check in by 17:00.',
  'Sunday, 18:00 CET. Set an alarm, check-in shuts at 17:00.',
];

/** The same thing, as a form, for an owner who would rather not chat. */
function Form({
  guildId,
  sessionId,
  config,
  onConfig,
  onDone,
}: {
  guildId: string;
  sessionId: string;
  config: DraftConfig;
  onConfig: (config: DraftConfig) => void;
  onDone: (config: DraftConfig) => void;
}) {
  const [saving, setSaving] = useState(false);

  function set(patch: Partial<DraftConfig>) {
    onConfig({ ...config, ...patch });
  }
  function toggle(topic: string) {
    const current = config.forbiddenTopics ?? [];
    set({
      forbiddenTopics: current.includes(topic)
        ? current.filter((t: string) => t !== topic)
        : [...current, topic],
    });
  }

  const ready = Boolean(config.botName?.trim() && config.personaPrompt?.trim());

  return (
    <form
      className="max-w-[60ch] space-y-6"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        await saveDraft(guildId, sessionId, config);
        setSaving(false);
        onDone(config);
      }}
    >
      <Field label="What is it called?">
        <Input
          value={config.botName ?? ''}
          onChange={(event) => set({ botName: event.target.value })}
          placeholder="Kalvard"
        />
      </Field>
      <Field
        label="What is this server for, and how should it talk?"
        help="Tone only. It answers from what your server knows, whatever you write here."
      >
        <Textarea
          rows={4}
          value={config.personaPrompt ?? ''}
          onChange={(event) => set({ personaPrompt: event.target.value })}
          placeholder="A competitive Wild Rift league. Short and exact, no small talk."
        />
      </Field>
      <Field label="What language should it reply in?">
        <Input
          value={config.language ?? ''}
          onChange={(event) => set({ language: event.target.value })}
          placeholder="The language each member writes in"
        />
      </Field>
      <Field label="One line in its voice" help="Used as the example it writes like.">
        <Input
          value={config.toneSample ?? ''}
          onChange={(event) => set({ toneSample: event.target.value })}
          placeholder="Sunday 18:00 CET, in #announcements. Check-in closes an hour before."
        />
      </Field>
      <Field label="What should it leave to people?">
        <div className="flex flex-wrap gap-2">
          {DEFAULT_FORBIDDEN.map((topic) => {
            const on = (config.forbiddenTopics ?? []).includes(topic);
            return (
              <button
                key={topic}
                type="button"
                onClick={() => toggle(topic)}
                aria-pressed={on}
                className={cx(
                  'text-ui h-9 rounded-full border px-4',
                  on ? 'border-ink bg-ink text-paper' : 'border-hairline text-ink hover:bg-ink/5',
                )}
              >
                {topic}
              </button>
            );
          })}
        </div>
      </Field>
      <Button type="submit" disabled={!ready || saving}>
        {saving ? 'Saving' : 'Save and try it'}
      </Button>
    </form>
  );
}

/** The invite, and the wait for the bot to turn up. */
function BringIt({
  guildId,
  inviteUrl,
  onArrived,
}: {
  guildId: string;
  inviteUrl: string;
  onArrived: () => void;
}) {
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (!waiting) return;
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
  }, [waiting, guildId, onArrived]);

  const url = inviteUrl
    ? `${inviteUrl}${inviteUrl.includes('?') ? '&' : '?'}guild_id=${guildId}`
    : '';

  return (
    <div className="mt-10 max-w-[60ch]">
      <p className="text-body text-ink-soft mb-6">
        Add it to your server, then come back here. This page notices when it arrives.
      </p>
      {url ? (
        <ButtonLink href={url} target="_blank" rel="noreferrer" onClick={() => setWaiting(true)}>
          Bring it to Discord
        </ButtonLink>
      ) : (
        <p className="text-ui text-ink">
          No invite link is configured. Set DISCORD_BOT_INVITE_URL and reload.
        </p>
      )}
      {waiting && <p className="text-ui text-ink-soft mt-4">Waiting for it to appear</p>}
    </div>
  );
}

/** Where it may answer, who it wakes, and where it reports quietly. */
function Finish({
  guildId,
  channels,
  roles,
}: {
  guildId: string;
  channels: Named[];
  roles: Named[];
}) {
  const [state, action, pending] = useActionState(finishSetup, null);

  useEffect(() => {
    if (state?.ok) window.location.href = `/g/${guildId}/knowledge`;
  }, [state?.ok, guildId]);

  if (channels.length === 0 && roles.length === 0) {
    return (
      <p className="text-body text-ink-soft max-w-[60ch]">
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

/** The draft, as the bot card reads it. */
function cardValues(config: DraftConfig) {
  return {
    name: config.botName ?? '',
    tone: config.toneSample ?? config.personaPrompt ?? '',
    language: config.language ?? '',
    knows: (config.knowledge ?? []).map((k: { title: string }) => k.title).join(', '),
    wontTouch: (config.forbiddenTopics ?? []).join(', '),
    wakes: '',
  };
}
